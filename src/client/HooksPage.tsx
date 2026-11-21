/**
 * The Hooks page: hook bridge rows mounted in the profile (parsed from each
 * row's configPath file) plus conventional on-disk config locations that
 * exist but are NOT mounted into DSH. Every command hook carries its own
 * switch: turning one off flips the hook's `type` to the sentinel the
 * bridges skip (the provider's own contract) and reloads the bridge row so
 * it takes effect immediately. The bridge row itself carries no whole-row
 * switch — the loader's live re-enable of a row is unreliable, so the page
 * stays at the granularity the file edit serves.
 *
 * @module dsh-harness-panel/client/HooksPage
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Button, IconChevronDownOutlineRegular, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HookBridgeView, HooksSnapshot } from '../hooks.ts'
import { fetchJson, fill, postJson, type Translate } from './shared.ts'
import { CopyButton, RefreshButton } from './controls.tsx'
import { PanelToastView, usePanelToast } from './toast.tsx'
import { useResumeRefresh } from './use-resume-refresh.ts'

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: HooksSnapshot }

/** The host's per-hook toggle response. */
interface HookToggleResponse {
  readonly reloaded: 'applied' | 'restart-required' | 'failed' | 'skipped' | 'unavailable'
}

/** One mounted bridge row. */
function BridgeRow({ bridge, t, onToggleHook, hookBusyKey }: {
  readonly bridge: HookBridgeView
  readonly t: Translate
  readonly onToggleHook: (request: { event: string; matcher: string | null; command: string; enabled: boolean }) => void
  readonly hookBusyKey: string | null
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const eventCount = bridge.events.length
  const hooks = bridge.events.flatMap(event => event.groups.flatMap(group => group.hooks))
  const hookCount = hooks.length
  const enabledCount = hooks.filter(hook => !hook.disabled).length
  // A disabled bridge runs nothing, so it reports that instead of a hook ratio.
  const tone = bridge.parseError !== null ? 'error' : bridge.disabled ? 'warn' : 'ok'
  const stateLabel = bridge.parseError !== null
    ? t('issueHookParseError')
    : bridge.disabled
      ? t('issueHookInactive')
      : `${enabledCount}/${hookCount} ${t('overviewActiveHooks')}`
  return (
    <li className="dhp-row" data-open={open ? 'true' : undefined} data-off={bridge.disabled ? 'true' : undefined}>
      <div className="dhp-row-head">
        <button
          type="button"
          className="dhp-row-main dhp-row-toggle"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className="dhp-row-line">
            <span className="dhp-row-title" data-mono="true">{bridge.entryId}</span>
            <span className="dhp-state" data-tone={tone}>
              <span className="dhp-dot" />
              {stateLabel}
            </span>
          </span>
          <span className="dhp-row-line">
            <span className="dhp-row-sub dhp-code">{bridge.configPath}</span>
            <span className="dhp-row-meta">
              <span>{t(bridge.dialect === 'codex' ? 'dialectCodex' : 'dialectClaude')}</span>
            </span>
          </span>
        </button>
        <span className="dhp-row-end">
          <CopyButton text={bridge.configPath} label={t('copyPath')} />
          <IconChevronDownOutlineRegular className="dhp-chevron" />
        </span>
      </div>
      {open ? (
        <div className="dhp-row-details">
          {bridge.disabled ? <p className="dhp-note" data-tone="warn">{t('bridgeInactiveHint')}</p> : null}
          {bridge.parseError !== null ? <p className="dhp-error">{bridge.parseError}</p> : null}
          {bridge.events.map(event => (
            <div key={event.event} className="dhp-group">
              <p className="dhp-group-title">{event.event}</p>
              {event.groups.map((group, index) => (
                <div key={index} className="dhp-group">
                  <p className="dhp-group-sub">
                    {t('matcherLabel')}: {group.matcher ?? t('matcherAll')}
                  </p>
                  {group.hooks.map((hook, hookIndex) => {
                    const key = `${bridge.entryId} ${event.event} ${group.matcher ?? ''} ${hook.command}`
                    const busy = hookBusyKey === key
                    return (
                      <span key={hookIndex} className="dhp-hook-row">
                        <span className="dhp-hook-cmd" data-off={hook.disabled ? 'true' : undefined}>
                          {hook.command}
                          {hook.timeoutSec !== null ? ` (${fill(t('timeout'), { sec: hook.timeoutSec })})` : ''}
                        </span>
                        <CopyButton text={hook.command} label={t('copyCommand')} />
                        <Switch
                          checked={!hook.disabled}
                          label={fill(t('hookCommandToggle'), { name: hook.command })}
                          disabled={busy}
                          onChange={(next) => {
                            onToggleHook({ event: event.event, matcher: group.matcher, command: hook.command, enabled: next })
                          }}
                        />
                      </span>
                    )
                  })}
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
export function HooksPage({ t, active }: {
  readonly t: Translate
  /** Whether this panel is the selected tab; selecting it again re-reads. */
  readonly active: boolean
}): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [busyHookKey, setBusyHookKey] = useState<string | null>(null)
  const { toast, show, dismiss } = usePanelToast()
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const loadSnapshot = useCallback(async (signal: AbortSignal): Promise<void> => {
    const snapshot = await fetchJson<HooksSnapshot>('/harness-panel/hooks', signal)
    if (!mounted.current) return
    setState({ status: 'ready', snapshot })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadSnapshot(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted || !mounted.current) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { controller.abort() }
  }, [loadSnapshot])

  const reloadAll = useCallback(async (): Promise<void> => {
    const controller = new AbortController()
    await loadSnapshot(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted || !mounted.current) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
  }, [loadSnapshot])

  // Per-hook switches write config files; re-read on tab resume.
  useResumeRefresh(active, reloadAll)

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

  const onToggleHook = useCallback((bridge: HookBridgeView, request: {
    readonly event: string
    readonly matcher: string | null
    readonly command: string
    readonly enabled: boolean
  }) => {
    if (busyHookKey !== null) return
    const key = `${bridge.entryId} ${request.event} ${request.matcher ?? ''} ${request.command}`
    setBusyHookKey(key)
    void postJson<HookToggleResponse>('/harness-panel/hooks/toggle-hook', {
      bridge: bridge.entryId,
      event: request.event,
      matcher: request.matcher,
      command: request.command,
      enabled: request.enabled,
    }).then(async (response) => {
      if (!mounted.current) return
      if (response.reloaded === 'restart-required') show(t('toggleRestartRequired'))
      else if (response.reloaded === 'unavailable') show(t('toggleOverridden'))
      else if (response.reloaded === 'failed') show(t('toggleOverridden'))
      await reloadAll()
      if (!mounted.current) return
      setBusyHookKey(null)
    }).catch((error: unknown) => {
      if (!mounted.current) return
      show(fill(t('toggleFailed'), { message: error instanceof Error ? error.message : String(error) }), 'warn')
      setBusyHookKey(null)
    })
  }, [busyHookKey, reloadAll, show, t])

  const discovered = state.status === 'ready' ? state.snapshot.discovered.filter(row => row.exists) : []
  const mountedBridges = state.status === 'ready' ? state.snapshot.mounted : []

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-meta">
          {state.status === 'ready'
            ? fill(t('hooksSummary'), {
                bridges: state.snapshot.mounted.length,
                files: discovered.length,
              })
            : ''}
        </p>
        <RefreshButton t={t} busy={refreshing} onClick={onRefresh} />
      </div>
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
      ) : (
        <>
          <section className="dhp-block">
            <div className="dhp-block-head">
              <h3 className="dhp-block-title">{t('hooksMounted')}</h3>
            </div>
            {mountedBridges.length === 0 ? (
              <>
                <p className="dhp-empty">{t('hooksMountedEmpty')}</p>
                <p className="dhp-hint">{t('hooksMountedHint')}</p>
              </>
            ) : (
              <ul className="dhp-rows">
                {mountedBridges.map(bridge => (
                  <BridgeRow
                    key={bridge.entryId}
                    bridge={bridge}
                    t={t}
                    hookBusyKey={busyHookKey}
                    onToggleHook={(request) => { onToggleHook(bridge, request) }}
                  />
                ))}
              </ul>
            )}
          </section>
          <section className="dhp-block">
            <div className="dhp-block-head">
              <h3 className="dhp-block-title">{t('hooksDiscovered')}</h3>
            </div>
            {discovered.length === 0 ? (
              <p className="dhp-empty">{t('hooksDiscoveredEmpty')}</p>
            ) : (
              <>
                <ul className="dhp-rows">
                  {discovered.map(row => (
                    <li key={row.path} className="dhp-row">
                      <div className="dhp-row-head">
                        <div className="dhp-row-main">
                          <div className="dhp-row-line">
                            <span className="dhp-row-title" data-mono="true">{row.path}</span>
                            <span className="dhp-row-end">
                              <span className="dhp-tag">{t('hooksNotMounted')}</span>
                              <CopyButton text={row.path} label={t('copyPath')} />
                            </span>
                          </div>
                          <span className="dhp-row-sub">
                            {row.parseError !== null
                              ? row.parseError
                              : `${fill(t('eventCount'), { count: row.eventCount })} · ${fill(t('hookCount'), { count: row.hookCount })}`}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="dhp-hint">{t('hooksNotMountedHint')}</p>
              </>
            )}
          </section>
        </>
      )}
      <PanelToastView toast={toast} onDone={dismiss} />
    </>
  )
}
