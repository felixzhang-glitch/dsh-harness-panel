/**
 * The Hooks page: hook bridge rows mounted in the profile (parsed from each
 * row's configPath file) plus conventional on-disk config locations that
 * exist but are NOT mounted into DSH. Each mounted bridge carries a native
 * start/stop switch over the shipped `pluginManager` Remote; individual
 * command entries stay read-only because the bridge reads its file once at
 * load and a command is not a loader row.
 *
 * @module dsh-harness-panel/client/HooksPage
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HookBridgeView, HooksSnapshot } from '../hooks.ts'
import {
  findPluginInfo,
  moduleNameForDialect,
  togglePluginRow,
  type PluginInfoFace,
  type PluginManagerRemoteFace,
} from './plugin-manager.ts'
import { usePluginRows } from './use-plugin-rows.ts'
import { fetchJson, fill, type Translate } from './shared.ts'

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: HooksSnapshot }

/** Services the page reads, bound by the plugin's apply closure. */
export interface HooksPageDeps {
  /** `remote.pluginManager`; absent only when the namespace is not mounted. */
  readonly pluginManager: PluginManagerRemoteFace | undefined
}

/** The switch state one bridge card renders. */
interface ToggleView {
  readonly checked: boolean
  readonly disabled: boolean
  readonly title: string | undefined
  readonly onChange: (enabled: boolean) => void
}

/** Why one bridge's switch is locked, or undefined when it is addressable. */
function switchLock(
  rowsStatus: 'loading' | 'ready' | 'error',
  info: PluginInfoFace | undefined,
  t: Translate,
): string | undefined {
  if (rowsStatus === 'error') return t('toggleUnavailable')
  if (rowsStatus === 'loading') return t('loading')
  if (info === undefined) return t('toggleReadOnlyUnaddressable')
  if (info.readOnlyReason === 'management-required') return t('toggleReadOnlyManagement')
  if (info.readOnlyReason === 'unaddressable') return t('toggleReadOnlyUnaddressable')
  if (info.patchId === undefined) return t('toggleReadOnlyUnaddressable')
  return undefined
}

/** One mounted bridge card. */
function BridgeCard({ bridge, t, toggle }: {
  readonly bridge: HookBridgeView
  readonly t: Translate
  readonly toggle: ToggleView
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const eventCount = bridge.events.length
  const hookCount = bridge.events.reduce(
    (sum, event) => sum + event.groups.reduce((inner, group) => inner + group.hooks.length, 0),
    0,
  )
  return (
    <li className="dhp-card" data-open={open ? 'true' : undefined}>
      <div className="dhp-card-head">
        <button
          type="button"
          className="dhp-card-toggle"
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
        <span className="dhp-card-switch">
          <Switch
            checked={toggle.checked}
            label={fill(t('hookToggle'), { name: bridge.entryId })}
            disabled={toggle.disabled}
            {...toggle.title === undefined ? {} : { title: toggle.title }}
            onChange={toggle.onChange}
          />
        </span>
      </div>
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
export function HooksPage({ t, deps }: { readonly t: Translate; readonly deps: HooksPageDeps }): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [busyEntry, setBusyEntry] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const { state: rowsState, reload: reloadRows } = usePluginRows(deps.pluginManager)
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
    reloadRows()
  }, [loadSnapshot, reloadRows])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    setNotice(null)
    setToggleError(null)
    const controller = new AbortController()
    loadSnapshot(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted || !mounted.current) return
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => { if (mounted.current) setRefreshing(false) })
    reloadRows()
  }, [loadSnapshot, reloadRows])

  const onToggle = useCallback((bridge: HookBridgeView, next: boolean) => {
    const pm = deps.pluginManager
    if (pm === undefined || busyEntry !== null) return
    const info = findPluginInfo(rowsState.rows, bridge.entryId, moduleNameForDialect(bridge.dialect))
    if (info === undefined || info.readOnlyReason !== undefined || info.patchId === undefined) return
    setBusyEntry(bridge.entryId)
    setNotice(null)
    setToggleError(null)
    void togglePluginRow(pm, info, next).then(async (outcome) => {
      if (!mounted.current) return
      if (outcome.kind === 'failed') {
        setToggleError(fill(t('toggleFailed'), { message: outcome.message }))
        setBusyEntry(null)
        return
      }
      if (outcome.kind === 'restart-required') setNotice(t('toggleRestartRequired'))
      else if (outcome.kind === 'overridden') setNotice(t('toggleOverridden'))
      await reloadAll()
      if (!mounted.current) return
      setBusyEntry(null)
    }).catch((error: unknown) => {
      if (!mounted.current) return
      setToggleError(fill(t('toggleFailed'), { message: error instanceof Error ? error.message : String(error) }))
      setBusyEntry(null)
    })
  }, [busyEntry, deps.pluginManager, reloadAll, rowsState.rows, t])

  const toggleFor = (bridge: HookBridgeView): ToggleView => {
    const info = findPluginInfo(rowsState.rows, bridge.entryId, moduleNameForDialect(bridge.dialect))
    const lock = switchLock(rowsState.status, info, t)
    return {
      checked: !bridge.disabled,
      disabled: busyEntry !== null || rowsState.status !== 'ready' || lock !== undefined,
      title: lock,
      onChange: (next) => { onToggle(bridge, next) },
    }
  }

  const discovered = state.status === 'ready' ? state.snapshot.discovered.filter(row => row.exists) : []

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-sub" />
        <button type="button" className="dhp-btn" disabled={refreshing} onClick={onRefresh}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>
      {rowsState.status === 'error' ? <p className="dhp-hint">{t('toggleUnavailable')}</p> : null}
      {notice !== null ? <p className="dhp-hint" role="status">{notice}</p> : null}
      {toggleError !== null ? <p className="dhp-error" role="alert">{toggleError}</p> : null}
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
                <BridgeCard key={bridge.entryId} bridge={bridge} t={t} toggle={toggleFor(bridge)} />
              ))}
            </ul>
          )}
          <p className="dhp-group-title">{t('hooksDiscovered')}</p>
          {discovered.length === 0 ? (
            <p className="dhp-state">{t('hooksDiscoveredEmpty')}</p>
          ) : (
            <>
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
              <p className="dhp-hint">{t('hooksNotMountedHint')}</p>
            </>
          )}
        </>
      )}
    </>
  )
}
