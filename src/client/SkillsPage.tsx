/**
 * The Skills page: the current session's user-invocable skill catalog, read
 * through the shipped `skills` Remote namespace (the same seam the composer
 * "/" menu consumes), with a name/description filter.
 *
 * @module dsh-harness-panel/client/SkillsPage
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { currentSessionId, fill, type Translate } from './shared.ts'

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

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'no-session' }
  | { readonly status: 'ready'; readonly skills: readonly SkillEntryFace[] }

/** The Skills page body. */
export function SkillsPage({ t, deps }: { readonly t: Translate; readonly deps: SkillsPageDeps }): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    const skills = deps.skills
    if (skills === undefined) throw new Error('skills-unavailable')
    const sessionId = currentSessionId(deps.sessions)
    if (sessionId === undefined) {
      setState({ status: 'no-session' })
      return
    }
    const result = await skills.list({ sessionId }, signal)
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
    setState({ status: 'ready', skills: result.value.skills })
  }, [deps])

  const run = useCallback((manual: boolean) => {
    if (manual) setRefreshing(true)
    const controller = new AbortController()
    load(controller.signal)
      .catch((error: unknown) => {
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => { if (manual) setRefreshing(false) })
    return controller
  }, [load])

  useEffect(() => {
    const controller = run(false)
    return () => { controller.abort() }
  }, [run])

  const filtered = useMemo(() => {
    if (state.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    if (needle === '') return [...state.skills]
    return state.skills.filter(skill =>
      skill.name.toLowerCase().includes(needle)
      || skill.description.toLowerCase().includes(needle)
      || (skill.whenToUse ?? '').toLowerCase().includes(needle),
    )
  }, [state, query])

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-sub">
          {state.status === 'ready' ? fill(t('skillCount'), { count: filtered.length }) : ''}
        </p>
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
      ) : state.status === 'no-session' ? (
        <p className="dhp-state">{t('skillsNoSession')}</p>
      ) : filtered.length === 0 ? (
        <p className="dhp-state">{t('skillsEmpty')}</p>
      ) : (
        <div className="dhp-card">
          {filtered.map(skill => (
            <div key={skill.name} className="dhp-skill">
              <div className="dhp-skill-row">
                <span className="dhp-skill-name">{skill.name}</span>
                {skill.modelInvocable ? (
                  <span className="dhp-badge" data-tone="accent">{t('skillModel')}</span>
                ) : null}
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
