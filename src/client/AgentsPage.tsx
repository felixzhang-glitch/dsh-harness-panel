/**
 * The AGENTS.md page: the instruction chain the current session loads, in the
 * loader's own precedence order, with each candidate's dedupe/budget
 * disposition. Present files open an inline editor backed by the host's
 * mtime-checked write route; missing candidates can be created from their
 * directory card. The page follows the current session's working directory and
 * reloads when that session changes.
 *
 * @module dsh-harness-panel/client/AgentsPage
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { JSX } from 'react'
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
  readonly error: string | null
  readonly notice: string | null
  readonly conflict: boolean
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: AgentsSnapshot }

/** Status badge tone per file disposition. */
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

/** Status badge dictionary key per file disposition. */
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

/** The status badge text for one file. */
function statusLabel(file: AgentInstructionFileView, t: Translate): string {
  if (file.status === 'truncated') {
    return fill(t('agentsStatusTruncated'), {
      included: formatBytes(file.includedBytes ?? 0),
      original: formatBytes(file.sizeBytes ?? 0),
    })
  }
  if (file.status === 'duplicate') {
    return t('agentsStatusDuplicate')
  }
  return t(STATUS_KEY[file.status])
}

/** One file row with its optional inline editor. */
function FileRow({ file, t, editor, onToggle, onContentChange, onSave, onClose, onReload }: {
  readonly file: AgentInstructionFileView
  readonly t: Translate
  readonly editor: EditorState | null
  readonly onToggle: (file: AgentInstructionFileView) => void
  readonly onContentChange: (value: string) => void
  readonly onSave: () => void
  readonly onClose: () => void
  readonly onReload: () => void
}): JSX.Element {
  const open = editor !== null && editor.path === file.path
  const draftBytes = editor === null ? 0 : utf8Bytes(editor.content)
  const overLimit = draftBytes > MAX_AGENT_FILE_BYTES
  return (
    <div className="dhp-agent-file" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="dhp-agent-file-toggle"
        aria-expanded={open}
        onClick={() => { onToggle(file) }}
      >
        <span className="dhp-agent-file-name">{file.name}</span>
        <span className="dhp-card-sub dhp-code">{file.displayPath}</span>
        <span className="dhp-agent-file-meta">
          <span className="dhp-badge" data-tone={STATUS_TONE[file.status]}>{statusLabel(file, t)}</span>
          {file.symlink ? <span className="dhp-badge" data-tone="muted">{t('agentsSymlinkShort')}</span> : null}
          <span className="dhp-card-sub">{formatBytes(file.sizeBytes)}</span>
        </span>
      </button>
      {open && editor !== null ? (
        <div className="dhp-agent-editor">
          {editor.loading ? (
            <span className="dhp-skeleton-bar" />
          ) : editor.readOnly ? (
            <>
              <p className="dhp-hint">{fill(t('agentsReadOnly'), { max: formatBytes(MAX_AGENT_FILE_BYTES) })}</p>
              <div className="dhp-agent-actions">
                <span className="dhp-card-sub" />
                <span className="dhp-card-trailing">
                  <button type="button" className="dhp-btn" onClick={onClose}>{t('agentsCancel')}</button>
                </span>
              </div>
            </>
          ) : (
            <>
              {file.duplicateOf === null ? null : (
                <p className="dhp-hint">{fill(t('agentsDuplicate'), { path: file.duplicateOf })}</p>
              )}
              <textarea
                className="dhp-agent-textarea"
                aria-label={file.name}
                spellCheck={false}
                value={editor.content}
                disabled={editor.saving}
                onChange={(event) => { onContentChange(event.target.value) }}
              />
              <div className="dhp-agent-actions">
                <span className="dhp-card-sub">
                  {formatBytes(draftBytes)} / {formatBytes(MAX_AGENT_FILE_BYTES)}
                  {isDirty(editor) ? ` · ${t('agentsDirty')}` : ''}
                  {file.symlink && file.realPath !== null ? ` · ${fill(t('agentsSymlink'), { path: file.realPath })}` : ''}
                </span>
                <span className="dhp-card-trailing">
                  <button
                    type="button"
                    className="dhp-btn"
                    disabled={editor.saving || !isDirty(editor) || overLimit}
                    onClick={onSave}
                  >
                    {editor.saving ? t('agentsSaving') : t('agentsSave')}
                  </button>
                  <button type="button" className="dhp-btn" disabled={editor.saving} onClick={onClose}>
                    {t('agentsCancel')}
                  </button>
                </span>
              </div>
              {overLimit ? <p className="dhp-hint">{fill(t('agentsDraftTooLarge'), { max: formatBytes(MAX_AGENT_FILE_BYTES) })}</p> : null}
            </>
          )}
          {editor.error !== null ? <p className="dhp-error" role="alert">{editor.error}</p> : null}
          {editor.notice !== null ? <p className="dhp-hint" role="status">{editor.notice}</p> : null}
          {editor.conflict ? (
            <div>
              <button type="button" className="dhp-btn" onClick={onReload}>{t('agentsReload')}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
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
export function AgentsPage({ t, deps }: { readonly t: Translate; readonly deps: AgentsPageDeps }): JSX.Element {
  const scope = splitScopeKey(useSessionScopeKey(deps.sessions))
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const mounted = useRef(true)
  const fileAbort = useRef<AbortController | null>(null)

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
      error: null,
      notice: null,
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
      ? { ...previous, saving: true, error: null, notice: null, conflict: false }
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
            notice: t('agentsSaved'),
          }
        : previous)
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
  }, [editor, snapshot, t, loadSnapshot])

  const onContentChange = useCallback((value: string): void => {
    setEditor(previous => previous === null
      ? previous
      : { ...previous, content: value, notice: null, error: null, conflict: false })
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
      : `${fill(t('agentsBudget'), { max: formatBytes(snapshot.budget.maxBytes) })} · ${fill(t('agentsRendered'), {
          files: snapshot.budget.loadedFileCount,
          bytes: formatBytes(snapshot.budget.renderedBytes),
        })}`

  const renderGroup = (group: AgentInstructionGroupView): JSX.Element => {
    const existing = group.files.filter(file => file.exists)
    const missing = group.files.filter(file => !file.exists)
    return (
      <li key={group.key} className="dhp-card">
        <div className="dhp-card-head dhp-agent-group-head">
          <span className="dhp-agent-group-title dhp-code">{group.displayDirectory}</span>
          <span className="dhp-card-trailing">
            {group.isProjectRoot ? <span className="dhp-badge" data-tone="accent">{t('agentsProjectRoot')}</span> : null}
            {group.isCwd ? <span className="dhp-badge" data-tone="accent">{t('agentsCwdBadge')}</span> : null}
            <span className="dhp-card-sub">{fill(t('agentsGroupCount'), { count: existing.length })}</span>
          </span>
        </div>
        <div className="dhp-agent-files">
          {existing.map(file => (
            <FileRow
              key={file.path}
              file={file}
              t={t}
              editor={editor}
              onToggle={onToggleFile}
              onContentChange={onContentChange}
              onSave={saveEditor}
              onClose={closeEditor}
              onReload={reloadEditor}
            />
          ))}
          {missing.length > 0 ? (
            <details className="dhp-agent-missing">
              <summary>{fill(t('agentsCreateMissing'), { count: missing.length })}</summary>
              <div className="dhp-agent-chips">
                {missing.map(file => (
                  <button
                    key={file.path}
                    type="button"
                    className="dhp-btn"
                    aria-label={fill(t('agentsCreate'), { name: file.name })}
                    onClick={() => { openEditor(file) }}
                  >
                    {file.name}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      </li>
    )
  }

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-sub">{summary}</p>
        <button type="button" className="dhp-btn" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>
      <p className="dhp-hint">{t('agentsIntro')}</p>
      <p className="dhp-hint">{t('agentsOrderHint')}</p>
      {state.status === 'loading' ? (
        <div className="dhp-skeleton" aria-label={t('loading')}>
          <span className="dhp-skeleton-bar" />
          <span className="dhp-skeleton-bar" />
        </div>
      ) : state.status === 'error' ? (
        <>
          <p className="dhp-error" role="alert">{t('error')} · {state.message}</p>
          <div><button type="button" className="dhp-btn" onClick={onRefresh}>{t('retry')}</button></div>
        </>
      ) : snapshot === null ? null : (
        <>
          <p className="dhp-hint">
            {t(cwdLabelKey)}: <span className="dhp-code">{snapshot.cwd}</span>
            {' · '}
            {snapshot.presetId === null ? t('agentsPresetUnknown') : fill(t('agentsPreset'), { id: snapshot.presetId })}
            {' · '}
            {t('agentsRowLabel')}: {snapshot.row === null
              ? t('agentsRowMissingShort')
              : `${t(snapshot.row.source === 'preset' ? 'agentsRowPreset' : 'agentsRowRoot')} · ${snapshot.row.entryId}`}
          </p>
          {reasonKey !== null ? <p className="dhp-warn">{t(reasonKey)}</p> : null}
          {snapshot.warnings.length > 0 ? (
            <div>
              <p className="dhp-hint">{t('agentsWarnings')}</p>
              {snapshot.warnings.map((warning, index) => (
                <p key={index} className="dhp-hint">{warning}</p>
              ))}
            </div>
          ) : null}
          <p className="dhp-group-title">{t('agentsGlobalRoots')}</p>
          <ul className="dhp-cards">
            {snapshot.groups.filter(group => group.scope !== 'project').map(renderGroup)}
          </ul>
          <p className="dhp-group-title">{t('agentsProjectChain')}</p>
          <p className="dhp-hint dhp-code">{snapshot.projectRoot} → {snapshot.cwd}</p>
          <ul className="dhp-cards">
            {snapshot.groups.filter(group => group.scope === 'project').map(renderGroup)}
          </ul>
          {snapshot.groups.every(group => group.files.every(file => !file.exists)) ? (
            <>
              <p className="dhp-state">{t('agentsNoFiles')}</p>
              <p className="dhp-hint">{t('agentsNoFilesHint')}</p>
            </>
          ) : null}
          {snapshot.preview === null ? null : (
            <details className="dhp-agent-preview">
              <summary>{t('agentsPreview')}</summary>
              <pre>{snapshot.preview}</pre>
            </details>
          )}
        </>
      )}
    </>
  )
}