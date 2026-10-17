/**
 * The MCP page: read-only server cards (status badge, transport, target,
 * tool count) with expandable details (policy facts, env/header keys,
 * connection facts, tool list) and a one-shot probe action per server.
 *
 * @module dsh-harness-panel/client/McpPage
 */

import { useCallback, useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { McpServerView, McpSnapshot } from '../mcp.ts'
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

/** One server card. */
function ServerCard(props: {
  readonly server: McpServerView
  readonly t: Translate
  readonly probe: ProbeResult | undefined
  readonly probing: boolean
  readonly onProbe: (serverName: string) => void
}): JSX.Element {
  const { server, t, probe, probing, onProbe } = props
  const [open, setOpen] = useState(false)
  const badge = statusBadge(server, t)
  const lastConnected = formatTime(server.connectedAt)
  const observedAt = formatTime(server.observedAt)
  return (
    <li className="dhp-card" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="dhp-card-head"
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
export function McpPage({ t }: { readonly t: Translate }): JSX.Element {
  const [state, setState] = useState<ViewState>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [probes, setProbes] = useState<Readonly<Record<string, ProbeResult>>>({})
  const [probingName, setProbingName] = useState<string | null>(null)

  const load = useCallback(async (signal: AbortSignal): Promise<void> => {
    const snapshot = await fetchJson<McpSnapshot>('/harness-panel/mcp', signal)
    setState({ status: 'ready', snapshot })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    })
    return () => { controller.abort() }
  }, [load])

  const onRefresh = useCallback(() => {
    setRefreshing(true)
    const controller = new AbortController()
    load(controller.signal)
      .catch((error: unknown) => {
        setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      })
      .finally(() => { setRefreshing(false) })
  }, [load])

  const onProbe = useCallback((serverName: string) => {
    setProbingName(serverName)
    const controller = new AbortController()
    fetchJson<ProbeResult & { server: string }>(`/harness-panel/mcp/probe?server=${encodeURIComponent(serverName)}`, controller.signal)
      .then((outcome) => {
        setProbes(previous => ({
          ...previous,
          [serverName]: { status: outcome.status, detail: outcome.detail, latencyMs: outcome.latencyMs },
        }))
      })
      .catch((error: unknown) => {
        setProbes(previous => ({
          ...previous,
          [serverName]: {
            status: 'failed',
            detail: error instanceof Error ? error.message : String(error),
            latencyMs: 0,
          },
        }))
      })
      .finally(() => { setProbingName(null) })
  }, [])

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
