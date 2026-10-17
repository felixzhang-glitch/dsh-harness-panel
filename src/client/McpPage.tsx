/**
 * The MCP page: server cards (status badge, transport, target, tool count)
 * with expandable details, a one-shot probe, and a native start/stop switch
 * on every addressable loader row. The switch rides the shipped
 * `pluginManager` Remote, so disabling a server stops its mcp-client row and
 * its tools exactly as the built-in Plugins page would.
 *
 * @module dsh-harness-panel/client/McpPage
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { McpServerView, McpSnapshot } from '../mcp.ts'
import {
  MCP_CLIENT_MODULE,
  findPluginInfo,
  togglePluginRow,
  type PluginInfoFace,
  type PluginManagerRemoteFace,
} from './plugin-manager.ts'
import { usePluginRows } from './use-plugin-rows.ts'
import { fetchJson, fill, formatTime, type Translate } from './shared.ts'

/** One settled probe result, keyed by server name in page state. */
interface ProbeResult {
  readonly status: 'completed' | 'failed'
  readonly detail: string
  readonly latencyMs: number
}

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: McpSnapshot }

/** Services the page reads, bound by the plugin's apply closure. */
export interface McpPageDeps {
  /** `remote.pluginManager`; absent only when the namespace is not mounted. */
  readonly pluginManager: PluginManagerRemoteFace | undefined
}

/** The switch state one server card renders. */
interface ToggleView {
  readonly checked: boolean
  readonly disabled: boolean
  readonly title: string | undefined
  readonly onChange: (enabled: boolean) => void
}

/** Badge tone + label for one server's live state. */
function statusBadge(server: McpServerView, t: Translate): { tone: 'ok' | 'warn' | 'error' | 'muted'; label: string } {
  if (!server.enabled) return { tone: 'muted', label: t('statusDisabled') }
  if (server.fiberPhase === 'failed') return { tone: 'error', label: t('statusFailed') }
  switch (server.phase) {
    case 'connected': return { tone: 'ok', label: t('statusConnected') }
    case 'connecting': return { tone: 'warn', label: t('statusConnecting') }
    case 'waiting': return { tone: 'warn', label: t('statusWaiting') }
    case 'exhausted': return { tone: 'error', label: t('statusExhausted') }
    case 'disposed': return { tone: 'muted', label: t('statusDisposed') }
    default: return { tone: 'muted', label: t('statusUnknown') }
  }
}

/** Transport label for one server. */
function transportLabel(server: McpServerView, t: Translate): string {
  switch (server.transport) {
    case 'stdio': return t('transportStdio')
    case 'streamable-http': return t('transportHttp')
    default: return t('transportUnknown')
  }
}

/**
 * Why one server's switch is locked, or undefined when it is addressable.
 * The plugin inventory is the authority on whether the profile can write the
 * row: a protected row or one without a patch target must not look editable.
 */
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

/** One server card. */
function ServerCard(props: {
  readonly server: McpServerView
  readonly t: Translate
  readonly toggle: ToggleView
  readonly probe: ProbeResult | undefined
  readonly probing: boolean
  readonly onProbe: (serverName: string) => void
}): JSX.Element {
  const { server, t, toggle, probe, probing, onProbe } = props
  const [open, setOpen] = useState(false)
  const badge = statusBadge(server, t)
  const lastConnected = formatTime(server.connectedAt)
  const observedAt = formatTime(server.observedAt)
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
            <span className="dhp-card-title">{server.serverName}</span>
            <span className="dhp-card-trailing">
              <span className="dhp-badge" data-tone={badge.tone}>
                <span className="dhp-dot" />
                {badge.label}
              </span>
            </span>
          </span>
          <span className="dhp-card-row">
            <span className="dhp-card-sub">{server.target}</span>
            <span className="dhp-card-trailing">
              <span className="dhp-card-sub">{transportLabel(server, t)}</span>
              <span className="dhp-card-sub">{fill(t('toolCount'), { count: server.toolCount })}</span>
            </span>
          </span>
        </button>
        <span className="dhp-card-switch">
          <Switch
            checked={toggle.checked}
            label={fill(t('mcpToggle'), { name: server.serverName })}
            disabled={toggle.disabled}
            {...toggle.title === undefined ? {} : { title: toggle.title }}
            onChange={toggle.onChange}
          />
        </span>
      </div>
      {open ? (
        <div className="dhp-card-details">
          <dl className="dhp-details">
            {server.configuredNote !== null ? (
              <>
                <dt>{t('configuredNote')}</dt>
                <dd>{server.configuredNote}</dd>
              </>
            ) : null}
            {server.envKeys.length > 0 ? (
              <>
                <dt>{t('envKeys')}</dt>
                <dd>{server.envKeys.join(', ')}</dd>
              </>
            ) : null}
            {server.headerKeys.length > 0 ? (
              <>
                <dt>{t('headerKeys')}</dt>
                <dd>{server.headerKeys.join(', ')}</dd>
              </>
            ) : null}
            {server.attempt > 0 && server.maxAttempts > 0 ? (
              <>
                <dt>{t('statusConnecting')}</dt>
                <dd>{fill(t('attemptLine'), { attempt: server.attempt, maxAttempts: server.maxAttempts })}
                  {server.delayMs !== null ? ` · ${fill(t('backoff'), { ms: server.delayMs })}` : ''}</dd>
              </>
            ) : null}
            {server.reconnectCount > 0 ? (
              <>
                <dt>{t('reconnectsLabel')}</dt>
                <dd>{server.reconnectCount}</dd>
              </>
            ) : null}
            {lastConnected !== null ? (
              <>
                <dt>{t('lastConnected')}</dt>
                <dd>{lastConnected}</dd>
              </>
            ) : null}
            {observedAt !== null ? (
              <>
                <dt>{t('observedAt')}</dt>
                <dd>{observedAt}</dd>
              </>
            ) : null}
          </dl>
          {server.lastError !== null ? <p className="dhp-error">{server.lastError}</p> : null}
          {server.statusSource === 'derived' ? <p className="dhp-hint">{t('neverObserved')}</p> : null}
          <div>
            <button
              type="button"
              className="dhp-btn"
              disabled={probing || !server.enabled}
              onClick={() => { onProbe(server.serverName) }}
            >
              {probing ? t('probing') : t('probe')}
            </button>
          </div>
          {probe !== undefined ? (
            <p className={probe.status === 'completed' ? 'dhp-hint' : 'dhp-error'} role="status">
              {probe.status === 'completed' ? t('probeOk') : t('probeFailed')} · {probe.detail} · {probe.latencyMs}ms
            </p>
          ) : null}
          {server.tools.length > 0 ? (
            <ul className="dhp-tools">
              {server.tools.map(tool => (
                <li key={tool.name} className="dhp-tool">
                  <span className="dhp-tool-name">{tool.name}</span>
                  {tool.description !== '' ? <span className="dhp-tool-desc">{tool.description}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

/** The MCP page body. */
export function McpPage({ t, deps }: { readonly t: Translate; readonly deps: McpPageDeps }): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeResult>>>({})
  const [probingName, setProbingName] = useState<string | null>(null)
  const [busyEntry, setBusyEntry] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const { state: rowsState, reload: reloadRows } = usePluginRows(deps.pluginManager)
  const mounted = useRef(true)
  const delayedRefresh = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (delayedRefresh.current !== null) clearTimeout(delayedRefresh.current)
    }
  }, [])

  const loadSnapshot = useCallback(async (signal: AbortSignal): Promise<void> => {
    const snapshot = await fetchJson<McpSnapshot>('/harness-panel/mcp', signal)
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

  const onProbe = useCallback((serverName: string) => {
    setProbingName(serverName)
    const controller = new AbortController()
    fetchJson<ProbeResult & { server: string }>(`/harness-panel/mcp/probe?server=${encodeURIComponent(serverName)}`, controller.signal)
      .then((outcome) => {
        if (!mounted.current) return
        setProbes(previous => ({
          ...previous,
          [serverName]: { status: outcome.status, detail: outcome.detail, latencyMs: outcome.latencyMs },
        }))
      })
      .catch((error: unknown) => {
        if (!mounted.current) return
        setProbes(previous => ({
          ...previous,
          [serverName]: {
            status: 'failed',
            detail: error instanceof Error ? error.message : String(error),
            latencyMs: 0,
          },
        }))
      })
      .finally(() => { if (mounted.current) setProbingName(null) })
  }, [])

  const onToggle = useCallback((server: McpServerView, next: boolean) => {
    const pm = deps.pluginManager
    if (pm === undefined || busyEntry !== null) return
    const info = findPluginInfo(rowsState.rows, server.entryId, MCP_CLIENT_MODULE)
    if (info === undefined || info.readOnlyReason !== undefined || info.patchId === undefined) return
    setBusyEntry(server.entryId)
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
      if (next) {
        if (delayedRefresh.current !== null) clearTimeout(delayedRefresh.current)
        delayedRefresh.current = setTimeout(() => {
          if (!mounted.current) return
          const controller = new AbortController()
          void loadSnapshot(controller.signal).catch(() => {})
        }, 1200)
      }
    }).catch((error: unknown) => {
      if (!mounted.current) return
      setToggleError(fill(t('toggleFailed'), { message: error instanceof Error ? error.message : String(error) }))
      setBusyEntry(null)
    })
  }, [busyEntry, deps.pluginManager, loadSnapshot, reloadAll, rowsState.rows, t])

  const toggleFor = (server: McpServerView): ToggleView => {
    const info = findPluginInfo(rowsState.rows, server.entryId, MCP_CLIENT_MODULE)
    const lock = switchLock(rowsState.status, info, t)
    return {
      checked: server.enabled,
      disabled: busyEntry !== null || rowsState.status !== 'ready' || lock !== undefined,
      title: lock,
      onChange: (next) => { onToggle(server, next) },
    }
  }

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-sub">
          {state.status === 'ready' ? fill(t('mcpSummary'), {
            servers: state.snapshot.servers.length,
            tools: state.snapshot.servers.reduce((sum, server) => sum + server.toolCount, 0),
          }) : ''}
        </p>
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
      ) : state.snapshot.servers.length === 0 ? (
        <>
          <p className="dhp-state">{t('mcpEmpty')}</p>
          <p className="dhp-hint">{t('mcpEmptyHint')}</p>
        </>
      ) : (
        <ul className="dhp-cards">
          {state.snapshot.servers.map(server => (
            <ServerCard
              key={server.entryId}
              server={server}
              t={t}
              toggle={toggleFor(server)}
              probe={probes[server.serverName]}
              probing={probingName === server.serverName}
              onProbe={onProbe}
            />
          ))}
        </ul>
      )}
    </>
  )
}
