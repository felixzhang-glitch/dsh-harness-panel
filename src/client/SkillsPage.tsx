/**
 * The Skills page: the current session's user-invocable skill catalog, read
 * through the shipped `skills` Remote namespace (the same seam the composer
 * "/" menu consumes), merged with the host's persisted disabled records so a
 * disabled skill stays visible with an off switch. The switch calls the
 * host's file-level toggle, which sets the provider's frontmatter invocation
 * keys (`user-invocable: false`, `disable-model-invocation: true`) — honored
 * in every registry scope layer — and records the original lines for restore.
 *
 * @module dsh-harness-panel/client/SkillsPage
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { currentSessionId, fetchJson, fill, postJson, type Translate } from './shared.ts'
import {
  filterSkillRows,
  mergeSkillRows,
  skillToggleBody,
  type DisabledSkillLike,
  type SkillRow,
} from './skills-model.ts'

/** One skill available to the session's human-facing composer (wire shape). */
export interface SkillEntryFace {
  readonly path?: string
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
}

/** Structural face of the shipped `remote.skills` namespace. */
export interface SkillsRemoteFace {
  list(
    request: { sessionId: string },
    signal?: AbortSignal,
  ): Promise<
    | { ok: true; value: { skills: readonly SkillEntryFace[] } }
    | { ok: false; error: { code: string; message: string } }
  >
}

/** Services the page reads, bound by the plugin's apply closure. */
export interface SkillsPageDeps {
  /** The shipped `remote.skills` namespace; `undefined` only when unmounted. */
  readonly skills: SkillsRemoteFace | undefined
  /** The client sessions store (structural). */
  readonly sessions: unknown
}

/** The host's disabled-skill snapshot (`GET /harness-panel/skills`). */
interface SkillsStateSnapshot {
  readonly fileControlAvailable: boolean
  readonly disabled: readonly DisabledSkillLike[]
  readonly collectedAt: number
}

/** The host's toggle response. */
interface SkillsToggleResponse {
  readonly disabled: readonly DisabledSkillLike[]
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready'
      readonly enabled: readonly SkillEntryFace[]
      readonly disabled: readonly DisabledSkillLike[]
      readonly fileControlAvailable: boolean
      readonly session: 'ok' | 'no-session' | 'unavailable'
    }

/** Settle timer for one delayed catalog reload. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, ms) })
}

/** The Skills page body. */
export function SkillsPage({ t, deps }: { readonly t: Translate; readonly deps: SkillsPageDeps }): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const mounted = useRef(true)
  const delayedRefresh = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (delayedRefresh.current !== null) clearTimeout(delayedRefresh.current)
    }
  }, [])

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    // The disabled snapshot is independent of the session catalog. A missing
    // route (older host half) leaves the page read-only instead of failing.
    const hostPromise = fetchJson<SkillsStateSnapshot>('/harness-panel/skills', signal)
      .catch((): SkillsStateSnapshot => ({ fileControlAvailable: false, disabled: [], collectedAt: Date.now() }))
    const skills = deps.skills
    if (skills === undefined) {
      const hostState = await hostPromise
      if (signal.aborted) return
      setState({
        status: 'ready',
        enabled: [],
        disabled: hostState.disabled,
        fileControlAvailable: hostState.fileControlAvailable,
        session: 'unavailable',
      })
      return
    }
    const sessionId = currentSessionId(deps.sessions)
    if (sessionId === undefined) {
      const hostState = await hostPromise
      if (signal.aborted) return
      setState({
        status: 'ready',
        enabled: [],
        disabled: hostState.disabled,
        fileControlAvailable: hostState.fileControlAvailable,
        session: 'no-session',
      })
      return
    }
    const result = await skills.list({ sessionId }, signal)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    const hostState = await hostPromise
    if (signal.aborted) return
    setState({
      status: 'ready',
      enabled: result.value.skills,
      disabled: hostState.disabled,
      fileControlAvailable: hostState.fileControlAvailable,
      session: 'ok',
    })
  }, [deps])

  const run = useCallback((manual: boolean) => {
    if (manual) setRefreshing(true)
    setToggleError(null)
    const controller = new AbortController()
    load(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => { if (manual) setRefreshing(false) })
    return controller
  }, [load])

  useEffect(() => {
    const controller = run(false)
    return () => { controller.abort() }
  }, [run])

  const rows = useMemo(
    () => state.status === 'ready' ? mergeSkillRows(state.enabled, state.disabled) : [],
    [state],
  )
  const filtered = useMemo(() => filterSkillRows(rows, query), [rows, query])
  const disabledCount = useMemo(() => filtered.filter(row => !row.enabled).length, [filtered])

  const onToggle = useCallback((row: SkillRow, next: boolean) => {
    if (state.status !== 'ready' || !state.fileControlAvailable || busy !== null) return
    setBusy(row.name)
    setToggleError(null)
    void (async () => {
      let response: SkillsToggleResponse
      try {
        response = await postJson<SkillsToggleResponse>('/harness-panel/skills/toggle', skillToggleBody(row, next))
      } catch (error) {
        if (!mounted.current) return
        setToggleError(fill(t('skillsToggleFailed'), {
          message: error instanceof Error ? error.message : String(error),
        }))
        setBusy(null)
        return
      }
      if (!mounted.current) return
      // Reflect the host's response immediately; the catalog refetch below is
      // only the source of fresh descriptions and ordering.
      setState(previous => {
        if (previous.status !== 'ready') return previous
        const enabled = previous.enabled.filter(skill => skill.name !== row.name)
        const restored: SkillEntryFace | undefined = next
          ? {
              name: row.name,
              description: row.description,
              ...(row.path === undefined ? {} : { path: row.path }),
              ...(row.whenToUse === undefined ? {} : { whenToUse: row.whenToUse }),
              modelInvocable: row.modelInvocable,
            }
          : undefined
        return {
          ...previous,
          enabled: restored === undefined ? enabled : [...enabled, restored],
          disabled: response.disabled,
        }
      })
      // The toggle lands in the skill file; the provider's watcher needs its
      // stability window before the catalog republishes, so reload past it
      // instead of racing it and snapping the row back.
      try {
        await delay(400)
        if (!mounted.current) return
        await load(new AbortController().signal)
      } catch {
        // The write succeeded; keep the optimistic row and let refresh retry
        // the catalog read. A stale catalog must not look like a failed write.
      }
      if (!mounted.current) return
      setBusy(null)
      if (delayedRefresh.current !== null) clearTimeout(delayedRefresh.current)
      delayedRefresh.current = setTimeout(() => {
        if (!mounted.current) return
        const controller = new AbortController()
        void load(controller.signal).catch(() => {})
      }, 1200)
    })()
  }, [busy, load, state, t])

  const summary = state.status === 'ready'
    ? [
        fill(t('skillCount'), { count: filtered.length }),
        ...disabledCount > 0 ? [fill(t('skillDisabledCount'), { count: disabledCount })] : [],
      ].join(' · ')
    : ''

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-sub">{summary}</p>
        <button type="button" className="dhp-btn" disabled={refreshing} onClick={() => { run(true) }}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>
      <input
        type="search"
        className="dhp-search"
        placeholder={t('skillsSearch')}
        value={query}
        onChange={(event) => { setQuery(event.target.value) }}
      />
      {state.status === 'ready' && state.session === 'no-session' ? (
        <p className="dhp-hint">{t('skillsNoSession')}</p>
      ) : null}
      {state.status === 'ready' && state.session === 'unavailable' ? (
        <p className="dhp-hint">{t('skillsUnavailable')}</p>
      ) : null}
      {state.status === 'ready' && !state.fileControlAvailable ? (
        <p className="dhp-hint">{t('skillsFileControlUnavailable')}</p>
      ) : null}
      {state.status === 'ready' && disabledCount > 0 ? (
        <p className="dhp-hint">{t('skillsDisabledHint')}</p>
      ) : null}
      {toggleError !== null ? <p className="dhp-error" role="alert">{toggleError}</p> : null}
      {state.status === 'loading' ? (
        <div className="dhp-skeleton" aria-label={t('loading')}>
          <span className="dhp-skeleton-bar" />
          <span className="dhp-skeleton-bar" />
        </div>
      ) : state.status === 'error' ? (
        <>
          <p className="dhp-error" role="alert">
            {t('error')} · {state.message === 'skills-unavailable' ? t('skillsUnavailable') : state.message}
          </p>
          <div><button type="button" className="dhp-btn" onClick={() => { run(true) }}>{t('retry')}</button></div>
        </>
      ) : filtered.length === 0 ? (
        state.session === 'ok' ? <p className="dhp-state">{t('skillsEmpty')}</p> : null
      ) : (
        <div className="dhp-card">
          {filtered.map(skill => (
            <div key={skill.name} className="dhp-skill" data-disabled={skill.enabled ? undefined : 'true'}>
              <div className="dhp-skill-row">
                <span className="dhp-skill-name">{skill.name}</span>
                <span className="dhp-skill-trailing">
                  {skill.enabled && skill.modelInvocable ? (
                    <span className="dhp-badge" data-tone="accent">{t('skillModel')}</span>
                  ) : null}
                  {!skill.enabled ? (
                    <span className="dhp-badge" data-tone="muted">{t('statusDisabled')}</span>
                  ) : null}
                  <Switch
                    checked={skill.enabled}
                    label={fill(t('skillToggle'), { name: skill.name })}
                    disabled={!state.fileControlAvailable || busy !== null}
                    {...state.fileControlAvailable ? {} : { title: t('skillsFileControlUnavailable') }}
                    onChange={(next) => { onToggle(skill, next) }}
                  />
                </span>
              </div>
              {skill.description !== '' ? <span className="dhp-card-sub">{skill.description}</span> : null}
              {skill.path !== undefined && skill.path !== '' ? (
                <span className="dhp-card-sub dhp-code">{skill.path}</span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
