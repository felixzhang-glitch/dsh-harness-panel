/**
 * MCP snapshot assembly: pure, host-side aggregation of the loader's
 * mcp-client rows, the tool registry's `mcp__*` schemas, and observed
 * `mcp/status` supervisor events. Snapshot assembly is read-only — it touches
 * no configuration file and mutates no registry. The panel's server switch is
 * a separate browser action over the shipped `pluginManager` Remote. Secret
 * values never enter the snapshot: env and header maps surface as key lists,
 * URLs are credential-redacted.
 *
 * @module dsh-harness-panel/mcp
 */

import { sanitizeUrl } from './sanitize.ts'

/** The official MCP client bridge module name on loader rows. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** The `mcp__` namespace prefix every bridged MCP tool name starts with. */
export const MCP_TOOL_PREFIX = 'mcp__'

/** Exact event name of the upstream supervisor seam. */
export const MCP_STATUS_EVENT = 'mcp/status'

/** Transport recorded for one configured mcp-client row. */
export type McpTransport = 'stdio' | 'streamable-http' | 'unknown'

/** Cordis fiber phases projected for display; `null` = no fiber observed. */
export type McpFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Connection phase from the upstream seam, plus `unknown`. */
export type McpConnectionPhase = 'connecting' | 'connected' | 'waiting' | 'exhausted' | 'disposed' | 'unknown'

/** Provenance of the connection fields: upstream events or derived facts only. */
export type McpStatusSource = 'upstream-event' | 'derived'

/** Supervisor phases the panel understands; anything else is dropped at observe time. */
const KNOWN_PHASES: ReadonlySet<string> = new Set(['connecting', 'connected', 'waiting', 'exhausted', 'disposed'])

/** One MCP tool's model-facing view (public name + one-line description). */
export interface McpToolView {
  readonly name: string
  readonly description: string
}

/** The schema face this module reads; the tool registry snapshot satisfies it. */
export interface ToolSchemaFace {
  readonly name: string
  readonly description?: string
}

/** One loader row carrying an mcp-client plugin instance. */
export interface McpLoaderRow {
  /** `options.id` — the user-written patch id. */
  readonly entryId: string
  /** Effective disabled state (parent groups included). */
  readonly disabled: boolean
  /** Cordis fiber phase of the row; `null` when no fiber exists. */
  readonly fiberPhase: McpFiberPhase
  /** The row's raw serialized config (never displayed verbatim). */
  readonly config: unknown
}

/** Supervisor status payload consumed from the `mcp/status` seam. */
export interface McpStatusPayload {
  readonly serverName: string
  readonly phase: string
  readonly attempt: number
  readonly maxAttempts: number
  readonly delayMs?: number
  readonly error?: string
  readonly toolCount: number
  readonly connectedAt?: number
}

/** One MCP server's status view (wire shape). */
export interface McpServerView {
  readonly serverName: string
  readonly entryId: string
  readonly transport: McpTransport
  /** Display target: the command line (stdio) or the sanitized URL (http). */
  readonly target: string
  readonly enabled: boolean
  readonly fiberPhase: McpFiberPhase
  /** Config-declared policy facts (reconnect budget, fail-fast, tool timeout). */
  readonly configuredNote: string | null
  readonly toolCount: number
  readonly tools: readonly McpToolView[]
  readonly phase: McpConnectionPhase
  /** Failed attempts in the current outage; `-1` when unknown. */
  readonly attempt: number
  /** Resolved reconnect budget; `-1` when unknown. */
  readonly maxAttempts: number
  /** Scheduled backoff delay while `waiting`; `null` otherwise or unknown. */
  readonly delayMs: number | null
  /** Reconnect attempts observed this process; `-1` when unknown. */
  readonly reconnectCount: number
  /** Most recent error, sanitized for display; `null` when none or unknown. */
  readonly lastError: string | null
  /** Epoch ms of the last successful connect (upstream); `null` otherwise or unknown. */
  readonly connectedAt: number | null
  /** Epoch ms when this process last received an upstream status event; `null` without one. */
  readonly observedAt: number | null
  readonly statusSource: McpStatusSource
  /** env keys present on the raw row (values never leave the host). */
  readonly envKeys: readonly string[]
  /** header keys present on the raw row (values never leave the host). */
  readonly headerKeys: readonly string[]
}

/** The full MCP page snapshot (wire shape). */
export interface McpSnapshot {
  readonly servers: readonly McpServerView[]
  /** Epoch ms of assembly. */
  readonly collectedAt: number
}

/** Read one string field from an unknown config row. */
function stringField(config: unknown, key: string, fallback: string): string {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return fallback
  const value = (config as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : fallback
}

/** Read one untyped field from an unknown config row. */
function plainField(config: unknown, key: string): unknown {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined
  return (config as Record<string, unknown>)[key]
}

/** Read the server namespace from raw config; absent becomes a stable fallback. */
export function serverNameOf(config: unknown, fallback: string): string {
  const name = stringField(config, 'serverName', '')
  return name === '' ? fallback : name
}

/** One stdio argument in display form. */
function renderArg(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Transport and display target derived from one raw mcp-client config. */
export function deriveTarget(config: unknown): { transport: McpTransport; target: string } {
  const transport = stringField(config, 'transport', '')
  if (transport === 'stdio') {
    const command = stringField(config, 'command', '')
    if (command === '') return { transport: 'unknown', target: '(unconfigured)' }
    const argsValue = plainField(config, 'args')
    const args = Array.isArray(argsValue) ? argsValue.map(renderArg) : []
    const target = args.length === 0 ? command : `${command} ${args.join(' ')}`
    return { transport: 'stdio', target }
  }
  if (transport === 'streamable-http') {
    const url = stringField(config, 'url', '')
    if (url === '') return { transport: 'unknown', target: '(unconfigured)' }
    return { transport: 'streamable-http', target: sanitizeUrl(url) }
  }
  return { transport: 'unknown', target: '(unconfigured)' }
}

/**
 * Derive the config-declared policy facts in one display line. Reads only
 * boolean and number fields (never strings from raw config), so nothing
 * user-supplied or secret can leak; `null` = nothing noteworthy configured.
 */
export function configuredNote(config: unknown): string | null {
  const parts: string[] = []
  const reconnectValue = plainField(config, 'reconnect')
  if (typeof reconnectValue === 'object' && reconnectValue !== null && !Array.isArray(reconnectValue)) {
    const enabled = plainField(reconnectValue, 'enabled')
    const maxAttempts = plainField(reconnectValue, 'maxAttempts')
    if (typeof enabled === 'boolean' && !enabled) {
      parts.push('reconnect off')
    } else if (typeof maxAttempts === 'number' && Number.isFinite(maxAttempts)) {
      parts.push(`reconnect max ${maxAttempts}`)
    }
  }
  if (plainField(config, 'failOnStartupError') === true) parts.push('fail on startup error')
  const toolTimeout = plainField(config, 'toolCallTimeoutMs')
  if (typeof toolTimeout === 'number' && Number.isFinite(toolTimeout)) parts.push(`tool timeout ${Math.round(toolTimeout / 1000)}s`)
  return parts.length === 0 ? null : parts.join('; ')
}

/** Key list of one string-map config field; values never leave the host. */
function keysOf(config: unknown, key: string): string[] {
  const value = plainField(config, key)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return []
  return Object.keys(value as Record<string, unknown>)
}

/** Split one registered tool schema list into per-server tool buckets. */
export function groupMcpTools(
  schemas: readonly ToolSchemaFace[],
  configuredNames: readonly string[],
): Map<string, McpToolView[]> {
  const groups = new Map<string, McpToolView[]>()
  const configured = new Set(configuredNames)
  for (const serverName of configuredNames) {
    if (!groups.has(serverName)) groups.set(serverName, [])
  }
  for (const schema of schemas) {
    const name = typeof schema.name === 'string' ? schema.name : ''
    if (!name.startsWith(MCP_TOOL_PREFIX)) continue
    let server: string | undefined
    for (const serverName of configured) {
      if (name.startsWith(`${MCP_TOOL_PREFIX}${serverName}__`)) {
        server = serverName
        break
      }
    }
    if (server === undefined) continue
    const description = typeof schema.description === 'string' ? schema.description : ''
    groups.get(server)?.push({ name, description })
  }
  for (const [key, tools] of groups) {
    groups.set(key, [...tools].sort((left, right) => (left.name < right.name ? -1 : 1)))
  }
  return groups
}

/**
 * The panel's observation store for the upstream `mcp/status` seam. Payloads
 * are validated before storage — they are unvalidated runtime data and a
 * malformed one must never poison a snapshot. A `connecting` payload with a
 * strictly increasing attempt counts one reconnect; re-observing the same
 * payload never double counts.
 */
export class McpStatusObserver {
  /** Latest upstream payload per server namespace. */
  private readonly statuses = new Map<string, McpStatusPayload>()
  /** Cumulative reconnect attempts observed per server namespace. */
  private readonly reconnects = new Map<string, number>()
  /** Highest `attempt` already counted per server (event + seed dedup). */
  private readonly countedAttempts = new Map<string, number>()
  /** Epoch ms of the latest upstream event receipt per server namespace. */
  private readonly observedAt = new Map<string, number>()

  /** Record one upstream payload (event or query-seed). */
  observe(payload: unknown): void {
    if (typeof payload !== 'object' || payload === null) return
    const row = payload as Record<string, unknown>
    const serverName = row['serverName']
    const phase = row['phase']
    const attempt = row['attempt']
    const maxAttempts = row['maxAttempts']
    const toolCount = row['toolCount']
    if (typeof serverName !== 'string' || serverName === '') return
    if (typeof phase !== 'string' || !KNOWN_PHASES.has(phase)) return
    if (!Number.isFinite(attempt) || !Number.isFinite(maxAttempts) || !Number.isFinite(toolCount)) return
    const clean: McpStatusPayload = {
      serverName,
      phase,
      attempt: Math.floor(attempt as number),
      maxAttempts: Math.floor(maxAttempts as number),
      toolCount: Math.floor(toolCount as number),
      ...(Number.isFinite(row['delayMs']) ? { delayMs: Math.floor(row['delayMs'] as number) } : {}),
      ...(typeof row['error'] === 'string' ? { error: row['error'] } : {}),
      ...(Number.isFinite(row['connectedAt']) ? { connectedAt: Math.floor(row['connectedAt'] as number) } : {}),
    }
    this.statuses.set(serverName, clean)
    this.observedAt.set(serverName, Date.now())
    if (phase === 'connecting' && clean.attempt > 0) {
      const counted = this.countedAttempts.get(serverName) ?? 0
      if (clean.attempt > counted) {
        this.countedAttempts.set(serverName, clean.attempt)
        this.reconnects.set(serverName, (this.reconnects.get(serverName) ?? 0) + 1)
      }
    } else if (phase === 'connected' || phase === 'disposed') {
      // A recovery or teardown resets the counter so the next outage counts
      // from attempt 1 again.
      this.countedAttempts.set(serverName, 0)
    }
  }

  /** Latest observed status for one server, or undefined. */
  statusOf(serverName: string): McpStatusPayload | undefined {
    return this.statuses.get(serverName)
  }

  /** Reconnect count observed for one server; `-1` when never observed. */
  reconnectCountOf(serverName: string): number {
    return this.observedAt.has(serverName) ? (this.reconnects.get(serverName) ?? 0) : -1
  }

  /** Epoch ms of the latest observation for one server; `null` without one. */
  observedAtOf(serverName: string): number | null {
    return this.observedAt.get(serverName) ?? null
  }
}

/** Assemble the sanitized per-server view of one loader row. */
export function serverViewOf(row: McpLoaderRow, observer: McpStatusObserver, tools: readonly McpToolView[]): McpServerView {
  const serverName = serverNameOf(row.config, `entry:${row.entryId}`)
  const { transport, target } = deriveTarget(row.config)
  const status = observer.statusOf(serverName)
  return {
    serverName,
    entryId: row.entryId,
    transport,
    target,
    enabled: !row.disabled,
    fiberPhase: row.fiberPhase,
    configuredNote: configuredNote(row.config),
    toolCount: tools.length,
    tools,
    phase: status === undefined ? 'unknown' : (status.phase as McpConnectionPhase),
    attempt: status?.attempt ?? -1,
    maxAttempts: status?.maxAttempts ?? -1,
    delayMs: status?.delayMs ?? null,
    reconnectCount: observer.reconnectCountOf(serverName),
    lastError: typeof status?.error === 'string' ? status.error : null,
    connectedAt: status?.connectedAt ?? null,
    observedAt: observer.observedAtOf(serverName),
    statusSource: status === undefined ? 'derived' : 'upstream-event',
    envKeys: keysOf(row.config, 'env'),
    headerKeys: keysOf(row.config, 'headers'),
  }
}

/** Assemble the full MCP page snapshot. */
export function buildMcpSnapshot(
  rows: readonly McpLoaderRow[],
  schemas: readonly ToolSchemaFace[],
  observer: McpStatusObserver,
): McpSnapshot {
  const configuredNames = rows.map(row => serverNameOf(row.config, `entry:${row.entryId}`))
  const groups = groupMcpTools(schemas, configuredNames)
  const servers = rows.map((row, index) => {
    const serverName = configuredNames[index] ?? `entry:${row.entryId}`
    return serverViewOf(row, observer, groups.get(serverName) ?? [])
  })
  return { servers, collectedAt: Date.now() }
}
