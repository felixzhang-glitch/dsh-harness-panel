/**
 * The AGENTS.md page: the instruction chain the current session loads, in the
 * loader's own precedence order, with each candidate's dedupe/budget
 * disposition. Present files open an inline editor backed by the host's
 * mtime-checked write route; missing candidates can be created from their
 * directory group. The page follows the current session's working directory and
 * reloads when that session changes.
 *
 * @module dsh-harness-panel/client/AgentsPage
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import {
  Button,
  IconChevronDownOutlineRegular,
  MarkdownText,
  Pill,
  type MarkdownLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  MAX_AGENT_FILE_BYTES,
  type AgentFileContent,
  type AgentFileWriteResult,
  type AgentInstructionFileStatus,
  type AgentInstructionFileView,
  type AgentInstructionGroupView,
  type AgentInstructionReason,
  type AgentsSnapshot,
} from '../agents-contract.ts'
import type { HarnessPanelLocaleKey } from './locales.ts'
import {
  PanelHttpError,
  currentSessionCwd,
  currentSessionId,
  fetchJson,
  fill,
  formatBytes,
  postJson,
  type Translate,
} from './shared.ts'
import { CopyButton, RefreshButton } from './controls.tsx'
import { PanelToastView, usePanelToast } from './toast.tsx'
import { useResumeRefresh } from './use-resume-refresh.ts'

/** Services the page reads, bound by the plugin's apply closure. */
export interface AgentsPageDeps {
  /** The client sessions store (structural). */
  readonly sessions: unknown
}

/** One open editor's local draft and request state. */
interface EditorState {
  readonly path: string
  readonly exists: boolean
  readonly content: string
  readonly original: string
  readonly mtimeMs: number | null
  readonly loading: boolean
  readonly saving: boolean
  readonly readOnly: boolean
  /** Preview renders the draft as Markdown instead of the source textarea. */
  readonly preview: boolean
  readonly error: string | null
  readonly conflict: boolean
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: AgentsSnapshot }

/** Tag tone per file disposition. */
const STATUS_TONE: Record<AgentInstructionFileStatus, 'ok' | 'warn' | 'error' | 'muted'> = {
  loaded: 'ok',
  empty: 'muted',
  truncated: 'warn',
  omitted: 'warn',
  duplicate: 'muted',
  'over-source-limit': 'error',
  unreadable: 'error',
  missing: 'muted',
  'not-loaded': 'muted',
}

/** Status tag dictionary key per file disposition. */
const STATUS_KEY: Record<AgentInstructionFileStatus, HarnessPanelLocaleKey> = {
  loaded: 'agentsStatusLoaded',
  empty: 'agentsStatusEmpty',
  truncated: 'agentsStatusTruncated',
  omitted: 'agentsStatusOmitted',
  duplicate: 'agentsStatusDuplicate',
  'over-source-limit': 'agentsStatusOverSourceLimit',
  unreadable: 'agentsStatusUnreadable',
  missing: 'agentsStatusMissing',
  'not-loaded': 'agentsStatusNotLoaded',
}

/** Banner key per non-ok loader reason. */
const REASON_KEY: Record<AgentInstructionReason, HarnessPanelLocaleKey | null> = {
  ok: null,
  'row-missing': 'agentsReasonRowMissing',
  'row-disabled': 'agentsReasonRowDisabled',
  'row-invalid': 'agentsReasonRowInvalid',
  'fs-unavailable': 'agentsReasonFsUnavailable',
  'budget-disabled': 'agentsReasonBudgetDisabled',
}

/** UTF-8 byte length of one draft string. */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Whether one editor holds unsaved changes. */
function isDirty(editor: EditorState): boolean {
  return editor.content !== editor.original
}

/** The status tag text for one file. */
function statusLabel(file: AgentInstructionFileView, t: Translate): string {
  if (file.status === 'truncated') {
    return fill(t('agentsStatusTruncated'), { included: formatBytes(file.includedBytes ?? 0) })
  }
  return t(STATUS_KEY[file.status])
}

/** One file row with its optional inline editor. */
function FileRow({ file, t, editor, mdLabels, onToggle, onContentChange, onPreview, onSave, onClose, onReload }: {
  readonly file: AgentInstructionFileView
  readonly t: Translate
  readonly editor: EditorState | null
  readonly mdLabels: MarkdownLabels
  readonly onToggle: (file: AgentInstructionFileView) => void
  readonly onContentChange: (value: string) => void
  readonly onPreview: (preview: boolean) => void
  readonly onSave: () => void
  readonly onClose: () => void
  readonly onReload: () => void
}): JSX.Element {
  const open = editor !== null && editor.path === file.path
  const draftBytes = editor === null ? 0 : utf8Bytes(editor.content)
  const overLimit = draftBytes > MAX_AGENT_FILE_BYTES
  return (
    <li className="dhp-row" data-open={open ? 'true' : undefined}>
      <div className="dhp-row-head">
        <button
          type="button"
          className="dhp-row-main dhp-row-toggle"
          aria-expanded={open}
          onClick={() => { onToggle(file) }}
        >
          <span className="dhp-row-line">
            <span className="dhp-row-title">{file.name}</span>
            <span className="dhp-row-end">
              <span className="dhp-tag" data-tone={STATUS_TONE[file.status]}>{statusLabel(file, t)}</span>
              {file.symlink ? <span className="dhp-tag">{t('agentsSymlinkShort')}</span> : null}
            </span>
          </span>
          <span className="dhp-row-line">
            {/* The group head already names the directory; a path equal to the
                file name adds nothing. */}
            <span className="dhp-row-sub dhp-code">
              {file.displayPath === file.name ? file.directory : file.displayPath}
            </span>
            <span className="dhp-row-meta">{formatBytes(file.sizeBytes)}</span>
          </span>
        </button>
        <span className="dhp-row-end">
          <CopyButton text={file.path} label={t('copyPath')} />
          <IconChevronDownOutlineRegular className="dhp-chevron" />
        </span>
      </div>
      {open && editor !== null ? (
        <div className="dhp-editor">
          {editor.loading ? (
            <span className="dhp-skeleton-bar" />
          ) : editor.readOnly ? (
            <>
              <p className="dhp-hint">{fill(t('agentsReadOnly'), { max: formatBytes(MAX_AGENT_FILE_BYTES) })}</p>
              <div className="dhp-editor-bar">
                <span className="dhp-editor-meta" />
                <span className="dhp-actions">
                  <Button size="sm" onClick={onClose}>{t('agentsCancel')}</Button>
                </span>
              </div>
            </>
          ) : (
            <>
              {file.duplicateOf === null ? null : (
                <p className="dhp-hint">{fill(t('agentsDuplicate'), { path: file.duplicateOf })}</p>
              )}
              <div className="dhp-editor-bar">
                <span className="dhp-actions" role="group" aria-label={file.name}>
                  <Pill active={!editor.preview} onClick={() => { onPreview(false) }}>{t('mdEdit')}</Pill>
                  <Pill active={editor.preview} onClick={() => { onPreview(true) }}>{t('mdPreview')}</Pill>
                </span>
                <span className="dhp-editor-meta">
                  {formatBytes(draftBytes)} / {formatBytes(MAX_AGENT_FILE_BYTES)}
                  {isDirty(editor) ? ` · ${t('agentsDirty')}` : ''}
                </span>
              </div>
              {editor.preview ? (
                <div className="dhp-md">
                  <MarkdownText text={editor.content} labels={mdLabels} variant="compact" />
                </div>
              ) : (
                <textarea
                  className="dhp-textarea"
                  aria-label={file.name}
                  spellCheck={false}
                  value={editor.content}
                  disabled={editor.saving}
                  onChange={(event) => { onContentChange(event.target.value) }}
                />
              )}
              <div className="dhp-editor-bar">
                <span className="dhp-editor-meta">
                  {file.symlink && file.realPath !== null ? fill(t('agentsSymlink'), { path: file.realPath }) : ''}
                </span>
                <span className="dhp-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={editor.saving || !isDirty(editor) || overLimit}
                    onClick={onSave}
                  >
                    {editor.saving ? t('agentsSaving') : t('agentsSave')}
                  </Button>
                  <Button size="sm" disabled={editor.saving} onClick={onClose}>
                    {t('agentsCancel')}
                  </Button>
                </span>
              </div>
              {overLimit ? <p className="dhp-hint">{fill(t('agentsDraftTooLarge'), { max: formatBytes(MAX_AGENT_FILE_BYTES) })}</p> : null}
            </>
          )}
          {editor.error !== null ? <p className="dhp-error" role="alert">{editor.error}</p> : null}
          {editor.conflict ? (
            <div className="dhp-actions">
              <Button size="sm" onClick={onReload}>{t('agentsReload')}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** Structural face of the client sessions catalog store. */
interface SessionsCatalogFace {
  subscribe?(listener: () => void): () => void
}

/** The catalog store, when the sessions service exposes one. */
function sessionsCatalog(sessions: unknown): SessionsCatalogFace | undefined {
  const list = (sessions as { list?: SessionsCatalogFace } | null | undefined)?.list
  return typeof list === 'object' && list !== null ? list : undefined
}

/** Split the stable `sessionId\ncwd` scope key. */
function splitScopeKey(key: string): { readonly sessionId?: string; readonly cwd?: string } {
  if (key === '') return {}
  const newline = key.indexOf('\n')
  if (newline < 0) return { sessionId: key }
  const cwd = key.slice(newline + 1)
  return { sessionId: key.slice(0, newline), ...(cwd === '' ? {} : { cwd }) }
}

/** Follow the current session's id and catalog cwd without object snapshots. */
function useSessionScopeKey(sessions: unknown): string {
  const subscribe = useCallback((onChange: () => void) => {
    const catalog = sessionsCatalog(sessions)
    return catalog?.subscribe === undefined ? () => {} : catalog.subscribe(onChange)
  }, [sessions])
  const getSnapshot = useCallback(() => {
    const id = currentSessionId(sessions)
    if (id === undefined) return ''
    return `${id}\n${currentSessionCwd(sessions, id) ?? ''}`
  }, [sessions])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Find one file view in a snapshot. */
function findFile(snapshot: AgentsSnapshot | null, path: string): AgentInstructionFileView | undefined {
  if (snapshot === null) return undefined
  for (const group of snapshot.groups) {
    for (const file of group.files) {
      if (file.path === path) return file
    }
  }
  return undefined
}

/** The host query for one candidate file. */
function fileQuery(snapshot: AgentsSnapshot, path: string): string {
  const params = new URLSearchParams()
  if (snapshot.sessionId !== null) params.set('session', snapshot.sessionId)
  params.set('cwd', snapshot.cwd)
  params.set('path', path)
  return params.toString()
}

/** The AGENTS.md page body. */
export function AgentsPage({ t, deps, active }: {
  readonly t: Translate
  readonly deps: AgentsPageDeps
  /** Whether this panel is the selected tab; selecting it again re-reads. */
  readonly active: boolean
}): JSX.Element {
  const scope = splitScopeKey(useSessionScopeKey(deps.sessions))
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const { toast, show, dismiss } = usePanelToast()
  const mounted = useRef(true)
  const fileAbort = useRef<AbortController | null>(null)

  // Reference-stable Markdown chrome: a new identity would discard the
  // renderer's cache on every parent rerender.
  const mdLabels = useMemo<MarkdownLabels>(() => ({
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('mdFootnotes'),
  }), [t])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      fileAbort.current?.abort()
      fileAbort.current = null
    }
  }, [])

  const loadSnapshot = useCallback(async (signal: AbortSignal): Promise<AgentsSnapshot> => {
    const params = new URLSearchParams()
    if (scope.sessionId !== undefined) params.set('session', scope.sessionId)
    if (scope.cwd !== undefined) params.set('cwd', scope.cwd)
    const snapshot = await fetchJson<AgentsSnapshot>(`/harness-panel/agents?${params.toString()}`, signal)
    if (mounted.current) setState({ status: 'ready', snapshot })
    return snapshot
  }, [scope.sessionId, scope.cwd])

  useEffect(() => {
    const controller = new AbortController()
    setEditor(null)
    setState({ status: 'loading' })
    loadSnapshot(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted || !mounted.current) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => {
      controller.abort()
      fileAbort.current?.abort()
      fileAbort.current = null
    }
  }, [loadSnapshot])

  const refreshQuietly = useCallback((): void => {
    void loadSnapshot(new AbortController().signal).catch(() => {})
  }, [loadSnapshot])
  // Instruction files are edited in place; re-read dispositions on tab resume.
  useResumeRefresh(active, refreshQuietly)

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    const controller = new AbortController()
    loadSnapshot(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted || !mounted.current) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => { if (mounted.current) setRefreshing(false) })
  }, [loadSnapshot])

  const snapshot = state.status === 'ready' ? state.snapshot : null

  const loadEditorContent = useCallback(async (path: string): Promise<void> => {
    if (snapshot === null) return
    fileAbort.current?.abort()
    const controller = new AbortController()
    fileAbort.current = controller
    setEditor(previous => previous !== null && previous.path === path
      ? { ...previous, loading: true, error: null, readOnly: false, conflict: false }
      : previous)
    try {
      const file = await fetchJson<AgentFileContent>(`/harness-panel/agents/file?${fileQuery(snapshot, path)}`, controller.signal)
      if (!mounted.current || fileAbort.current !== controller) return
      setEditor(previous => previous !== null && previous.path === path
        ? {
            ...previous,
            loading: false,
            exists: true,
            content: file.content,
            original: file.content,
            mtimeMs: file.mtimeMs,
            readOnly: false,
          }
        : previous)
    } catch (error) {
      if (controller.signal.aborted || !mounted.current || fileAbort.current !== controller) return
      if (error instanceof PanelHttpError && error.status === 413) {
        setEditor(previous => previous !== null && previous.path === path
          ? { ...previous, loading: false, readOnly: true, error: null }
          : previous)
        return
      }
      if (error instanceof PanelHttpError && error.status === 404) {
        setEditor(previous => previous !== null && previous.path === path
          ? { ...previous, loading: false, exists: false, content: '', original: '', mtimeMs: null }
          : previous)
        return
      }
      setEditor(previous => previous !== null && previous.path === path
        ? {
            ...previous,
            loading: false,
            error: fill(t('agentsLoadFailed'), { message: error instanceof Error ? error.message : String(error) }),
          }
        : previous)
    }
  }, [snapshot, t])

  const openEditor = useCallback((file: AgentInstructionFileView): void => {
    if (editor !== null && editor.path !== file.path && isDirty(editor)) {
      if (!window.confirm(t('agentsDiscard'))) return
    }
    fileAbort.current?.abort()
    fileAbort.current = null
    setEditor({
      path: file.path,
      exists: file.exists,
      content: '',
      original: '',
      mtimeMs: file.mtimeMs,
      loading: file.exists,
      saving: false,
      readOnly: false,
      preview: false,
      error: null,
      conflict: false,
    })
    if (file.exists) void loadEditorContent(file.path)
  }, [editor, loadEditorContent, t])

  const closeEditor = useCallback((): void => {
    if (editor !== null && isDirty(editor) && !window.confirm(t('agentsDiscard'))) return
    fileAbort.current?.abort()
    fileAbort.current = null
    setEditor(null)
  }, [editor, t])

  const saveEditor = useCallback((): void => {
    if (editor === null || snapshot === null || editor.saving || editor.readOnly) return
    const path = editor.path
    const content = editor.content
    if (editor.exists && editor.mtimeMs === null) {
      setEditor(previous => previous !== null && previous.path === path
        ? { ...previous, error: t('agentsConflict'), conflict: true }
        : previous)
      return
    }
    const expectedMtimeMs = editor.exists ? editor.mtimeMs : null
    setEditor(previous => previous !== null && previous.path === path
      ? { ...previous, saving: true, error: null, conflict: false }
      : previous)
    void postJson<AgentFileWriteResult>('/harness-panel/agents/write', {
      ...(snapshot.sessionId === null ? {} : { sessionId: snapshot.sessionId }),
      cwd: snapshot.cwd,
      path,
      content,
      expectedMtimeMs,
    }).then((result) => {
      if (!mounted.current) return
      setEditor(previous => previous !== null && previous.path === path
        ? {
            ...previous,
            saving: false,
            exists: true,
            original: content,
            mtimeMs: result.mtimeMs,
          }
        : previous)
      show(t('agentsSaved'), 'success')
      void loadSnapshot(new AbortController().signal).catch(() => {})
    }).catch((error: unknown) => {
      if (!mounted.current) return
      if (error instanceof PanelHttpError && error.status === 409) {
        setEditor(previous => previous !== null && previous.path === path
          ? { ...previous, saving: false, error: t('agentsConflict'), conflict: true }
          : previous)
        return
      }
      setEditor(previous => previous !== null && previous.path === path
        ? {
            ...previous,
            saving: false,
            error: fill(t('agentsSaveFailed'), { message: error instanceof Error ? error.message : String(error) }),
          }
        : previous)
    })
  }, [editor, snapshot, show, t, loadSnapshot])

  const onContentChange = useCallback((value: string): void => {
    setEditor(previous => previous === null
      ? previous
      : { ...previous, content: value, error: null, conflict: false })
  }, [])

  const onPreview = useCallback((preview: boolean): void => {
    setEditor(previous => previous === null ? previous : { ...previous, preview })
  }, [])

  const reloadEditor = useCallback((): void => {
    if (editor === null) return
    const file = findFile(snapshot, editor.path)
    if (file === undefined || !file.exists) return
    void loadEditorContent(editor.path)
  }, [editor, snapshot, loadEditorContent])

  const onToggleFile = useCallback((file: AgentInstructionFileView): void => {
    if (editor !== null && editor.path === file.path) closeEditor()
    else openEditor(file)
  }, [editor, closeEditor, openEditor])

  const reasonKey = snapshot === null ? null : REASON_KEY[snapshot.reason]
  const cwdLabelKey: HarnessPanelLocaleKey = snapshot === null
    ? 'agentsCwdProcess'
    : snapshot.cwdSource === 'session'
      ? 'agentsCwdSession'
      : snapshot.cwdSource === 'request'
        ? 'agentsCwdRequest'
        : 'agentsCwdProcess'
  const summary = snapshot === null
    ? ''
    : snapshot.budget.maxBytes === null
      ? t('agentsStatusNotLoaded')
      : fill(t('agentsRendered'), {
          files: snapshot.budget.loadedFileCount,
          bytes: `${formatBytes(snapshot.budget.renderedBytes)} / ${formatBytes(snapshot.budget.maxBytes)}`,
        })

  const renderGroup = (group: AgentInstructionGroupView): JSX.Element | null => {
    const existing = group.files.filter(file => file.exists)
    const missing = group.files.filter(file => !file.exists)
    // A directory with no candidate at all has nothing to show or create.
    if (existing.length === 0 && missing.length === 0) return null
    return (
      <section key={group.key} className="dhp-block">
        <div className="dhp-block-head">
          <h3 className="dhp-block-title" data-mono="true">{group.displayDirectory}</h3>
          <p className="dhp-block-note">
            {group.isProjectRoot ? <span className="dhp-tag">{t('agentsProjectRoot')}</span> : null}
            {group.isCwd ? <span className="dhp-tag">{t('agentsCwdBadge')}</span> : null}
            <span>{fill(t('agentsGroupCount'), { count: existing.length })}</span>
          </p>
        </div>
        {existing.length > 0 ? (
          <ul className="dhp-rows">
            {existing.map(file => (
              <FileRow
                key={file.path}
                file={file}
                t={t}
                editor={editor}
                mdLabels={mdLabels}
                onToggle={onToggleFile}
                onContentChange={onContentChange}
                onPreview={onPreview}
                onSave={saveEditor}
                onClose={closeEditor}
                onReload={reloadEditor}
              />
            ))}
          </ul>
        ) : null}
        {missing.length > 0 ? (
          <details className="dhp-disclosure">
            <summary>{fill(t('agentsCreateMissing'), { count: missing.length })}</summary>
            <div className="dhp-chips">
              {missing.map(file => (
                <Button
                  key={file.path}
                  size="sm"
                  aria-label={fill(t('agentsCreate'), { name: file.name })}
                  onClick={() => { openEditor(file) }}
                >
                  {file.name}
                </Button>
              ))}
            </div>
          </details>
        ) : null}
      </section>
    )
  }

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-meta">{summary}</p>
        <RefreshButton t={t} busy={refreshing} onClick={onRefresh} />
      </div>
      <p className="dhp-hint">{t('agentsIntro')}</p>
      <details className="dhp-disclosure">
        <summary>{t('agentsHelp')}</summary>
        <p className="dhp-hint">{t('agentsOrderHint')}</p>
      </details>
      {state.status === 'loading' ? (
        <div className="dhp-skeleton" aria-label={t('loading')}>
          <span className="dhp-skeleton-bar" />
          <span className="dhp-skeleton-bar" />
          <span className="dhp-skeleton-bar" />
        </div>
      ) : state.status === 'error' ? (
        <>
          <p className="dhp-error" role="alert">{t('error')} · {state.message}</p>
          <div className="dhp-actions"><Button size="sm" onClick={onRefresh}>{t('retry')}</Button></div>
        </>
      ) : snapshot === null ? null : (
        <>
          <dl className="dhp-facts">
            <dt>{t(cwdLabelKey)}</dt>
            <dd className="dhp-code">{snapshot.cwd}</dd>
            <dt>{t('agentsPreset')}</dt>
            <dd>{snapshot.presetId === null ? t('agentsPresetUnknown') : snapshot.presetId}</dd>
            <dt>{t('agentsRowLabel')}</dt>
            <dd>
              {snapshot.row === null
                ? t('agentsRowMissingShort')
                : `${t(snapshot.row.source === 'preset' ? 'agentsRowPreset' : 'agentsRowRoot')} · ${snapshot.row.entryId}`}
            </dd>
          </dl>
          {reasonKey !== null ? <p className="dhp-note" data-tone="warn">{t(reasonKey)}</p> : null}
          {snapshot.warnings.length > 0 ? (
            <div className="dhp-block">
              <p className="dhp-block-title">{t('agentsWarnings')}</p>
              {snapshot.warnings.map((warning, index) => (
                <p key={index} className="dhp-hint">{warning}</p>
              ))}
            </div>
          ) : null}
          <section className="dhp-block">
            <div className="dhp-block-head">
              <h3 className="dhp-block-title">{t('agentsGlobalRoots')}</h3>
            </div>
          </section>
          {snapshot.groups.filter(group => group.scope !== 'project').map(renderGroup)}
          <section className="dhp-block">
            <div className="dhp-block-head">
              <h3 className="dhp-block-title">{t('agentsProjectChain')}</h3>
            </div>
            <p className="dhp-hint dhp-code">{snapshot.projectRoot} → {snapshot.cwd}</p>
          </section>
          {snapshot.groups.filter(group => group.scope === 'project').map(renderGroup)}
          {snapshot.groups.every(group => group.files.every(file => !file.exists)) ? (
            <>
              <p className="dhp-empty">{t('agentsNoFiles')}</p>
              <p className="dhp-hint">{t('agentsNoFilesHint')}</p>
            </>
          ) : null}
          {snapshot.preview === null ? null : (
            <details className="dhp-disclosure">
              <summary>{t('agentsPreview')}</summary>
              <pre className="dhp-pre">{snapshot.preview}</pre>
            </details>
          )}
        </>
      )}
      <PanelToastView toast={toast} onDone={dismiss} />
    </>
  )
}
