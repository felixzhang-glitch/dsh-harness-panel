/**
 * The Hooks page: hook bridge rows mounted in the profile (parsed from each
 * row's configPath file) plus conventional on-disk config locations that
 * exist but are NOT mounted into DSH. Read-only.
 *
 * @module dsh-harness-panel/client/HooksPage
 */

import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { HookBridgeView, HooksSnapshot } from '../hooks.ts'
import { fetchJson, fill, type Translate } from './shared.ts'

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: HooksSnapshot }

/** One mounted bridge card. */
function BridgeCard({ bridge, t }: { readonly bridge: HookBridgeView; readonly t: Translate }): JSX.Element {
  const [open, setOpen] = useState(false)
  const eventCount = bridge.events.length
  const hookCount = bridge.events.reduce(
    (sum, event) => sum + event.groups.reduce((inner, group) => inner + group.hooks.length, 0),
    0,
  )
  return (
    <li className="dhp-card" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="dhp-card-head"
        aria-expanded={open}
        onClick={() => { setOpen(value => !value) }}
      >
        <span className="dhp-card-row">
          <span className="dhp-card-title">{bridge.entryId}</span>
          <span className="dhp-card-trailing">
            <span className="dhp-badge" data-tone={bridge.disabled ? 'muted' : bridge.parseError !== null ? 'error' : 'ok'}>
              <span className="dhp-dot" />
              {bridge.disabled
                ? t('statusDisabled')
                : bridge.parseError !== null
                  ? t('error')
                  : `${t(bridge.dialect === 'codex' ? 'dialectCodex' : 'dialectClaude')} · ${fill(t('hookCount'), { count: hookCount })}`}
            </span>
          </span>
        </span>
        <span className="dhp-card-row">
          <span className="dhp-card-sub dhp-code">{bridge.configPath}</span>
        </span>
      </button>
      {open ? (
        <div className="dhp-card-details">
          {bridge.parseError !== null ? <p className="dhp-error">{bridge.parseError}</p> : null}
          {bridge.events.map(event => (
            <div key={event.event}>
              <p className="dhp-group-title">{event.event}</p>
              {event.groups.map((group, index) => (
                <div key={index} className="dhp-hook-group">
                  <span className="dhp-hint">
                    {t('matcherLabel')}: {group.matcher ?? t('matcherAll')}
                  </span>
                  {group.hooks.map((hook, hookIndex) => (
                    <span key={hookIndex} className="dhp-hook-cmd">
                      {hook.command}
                      {hook.timeoutSec !== null ? ` (${fill(t('timeout'), { sec: hook.timeoutSec })})` : ''}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {bridge.skipped.map((skipped, index) => (
            <p key={index} className="dhp-hint">
              {skipped.event}: {fill(t('skippedType'), { type: skipped.type })}
            </p>
          ))}
          {eventCount === 0 && bridge.parseError === null ? (
            <p className="dhp-hint">{t('empty')}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** The Hooks page body. */
export function HooksPage({ t }: { readonly t: Translate }): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    const snapshot = await fetchJson<HooksSnapshot>('/harness-panel/hooks', signal)
    setState({ status: 'ready', snapshot })
  }, [])

  const run = useCallback((manual: boolean) => {
    if (manual) setRefreshing(true)
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

  const discovered = state.status === 'ready' ? state.snapshot.discovered.filter(row => row.exists) : []

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-sub" />
        <button type="button" className="dhp-btn" disabled={refreshing} onClick={() => { run(true) }}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>
      {state.status === 'loading' ? (
        <div className="dhp-skeleton" aria-label={t('loading')}>
          <span className="dhp-skeleton-bar" />
          <span className="dhp-skeleton-bar" />
        </div>
      ) : state.status === 'error' ? (
        <>
          <p className="dhp-error" role="alert">{t('error')} · {state.message}</p>
          <div><button type="button" className="dhp-btn" onClick={() => { run(true) }}>{t('retry')}</button></div>
        </>
      ) : (
        <>
          <p className="dhp-group-title">{t('hooksMounted')}</p>
          {state.snapshot.mounted.length === 0 ? (
            <>
              <p className="dhp-state">{t('hooksMountedEmpty')}</p>
              <p className="dhp-hint">{t('hooksMountedHint')}</p>
            </>
          ) : (
            <ul className="dhp-cards">
              {state.snapshot.mounted.map(bridge => (
                <BridgeCard key={bridge.entryId} bridge={bridge} t={t} />
              ))}
            </ul>
          )}
          <p className="dhp-group-title">{t('hooksDiscovered')}</p>
          {discovered.length === 0 ? (
            <p className="dhp-state">{t('hooksDiscoveredEmpty')}</p>
          ) : (
            <div className="dhp-card">
              {discovered.map(row => (
                <div key={row.path} className="dhp-skill">
                  <div className="dhp-skill-row">
                    <span className="dhp-skill-name dhp-code">{row.path}</span>
                    <span className="dhp-badge" data-tone="muted">{t('hooksNotMounted')}</span>
                  </div>
                  <span className="dhp-card-sub">
                    {row.parseError !== null
                      ? row.parseError
                      : `${fill(t('eventCount'), { count: row.eventCount })} · ${fill(t('hookCount'), { count: row.hookCount })}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
