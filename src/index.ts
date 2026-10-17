/**
 * `dsh-harness-panel` — the Harness settings panel: a native-styled settings
 * section grouping MCP server status (read-only + one-shot probes), the
 * session skill catalog (client-side, over the shipped `skills` Remote), and
 * hook bridge configurations (mounted rows + conventional on-disk files).
 *
 * The host half is READ-ONLY: it registers three HTTP GET routes on the
 * webserver (`/harness-panel/mcp`, `/harness-panel/mcp/probe`,
 * `/harness-panel/hooks`), observes the upstream `mcp/status` seam, and never
 * writes a configuration file. Secret values never leave the host: env and
 * header maps surface as key lists, URLs and error text are redacted.
 *
 * Function plugin — no default export (the Loader unwraps
 * `exports.default ?? exports`).
 *
 * @module dsh-harness-panel
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  MCP_CLIENT_MODULE,
  MCP_STATUS_EVENT,
  McpStatusObserver,
  buildMcpSnapshot,
  serverNameOf,
  type McpLoaderRow,
  type McpSnapshot,
  type McpStatusPayload,
  type ToolSchemaFace,
} from './mcp.ts'
import { runProbe, type ProbeTarget } from './probe.ts'
import {
  bridgeViewOf,
  conventionalHookPaths,
  dialectOf,
  scanHookPath,
  type HooksSnapshot,
} from './hooks.ts'

export const name = 'dsh-harness-panel'

/** Hard services: the facts the panel reads and the route registry it serves. */
export const inject = ['loader', 'tools', 'webServer']

/** Plugin config (all optional). */
export interface Config {
  /** Per-probe timeout in milliseconds. */
  probeTimeoutMs?: number
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One MCP client supervisor state transition (the shipped upstream
     * observability seam). App-level: no agent or session scope.
     * @param payload - post-transition status facts.
     * @mode emit
     */
    'mcp/status'(payload: McpStatusPayload): void
  }
  interface Context {
    /** The shipped upstream status query service; absent when unmounted. */
    mcpStatus?: { list(): readonly McpStatusPayload[] }
  }
}

/** The loader entry shape this plugin reads (structural; no loader import). */
interface LoaderEntryFace {
  readonly options: {
    readonly id: string
    readonly name: string
    readonly config?: unknown
  }
  readonly disabled: boolean
  readonly fiber?: { readonly state: number }
}

/** The webserver route registry face (host webserver package, structural). */
interface WebServerFace {
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: {
      method?: string
      url?: string
    }, res: {
      writeHead(status: number, headers: Record<string, string>): void
      end(body?: string): void
    }) => void | Promise<void>
  }): () => void
}

/** Structural read face of the injected services (inject guarantees presence). */
interface HostFace {
  readonly loader: { entries(): Iterable<LoaderEntryFace> }
  readonly tools: { schemas(): readonly ToolSchemaFace[] }
  readonly webServer: WebServerFace
}

/** Cordis fiber phases projected for display (mirrors the FiberState enum). */
const FIBER_PHASE = {
  0: 'pending',
  1: 'loading',
  2: 'active',
  3: 'failed',
  4: null,
  5: 'unloading',
} as const

/** JSON response helper: status + utf8 JSON body. */
function sendJson(res: { writeHead(s: number, h: Record<string, string>): void; end(b?: string): void }, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Collect the mcp-client loader rows. */
function mcpRows(loader: HostFace['loader']): McpLoaderRow[] {
  const rows: McpLoaderRow[] = []
  for (const entry of loader.entries()) {
    if (entry.options.name !== MCP_CLIENT_MODULE) continue
    rows.push({
      entryId: entry.options.id,
      disabled: entry.disabled,
      fiberPhase: entry.fiber === undefined ? null : (FIBER_PHASE[entry.fiber.state as keyof typeof FIBER_PHASE] ?? null),
      config: entry.options.config,
    })
  }
  return rows
}

/**
 * Resolve one configured server's probe spec. Credentials stay inside the
 * returned value and are used for the probe only — they never reach a
 * snapshot, a log, or a display.
 */
function probeSpec(loader: HostFace['loader'], serverName: string): ProbeTarget | undefined {
  for (const entry of loader.entries()) {
    if (entry.options.name !== MCP_CLIENT_MODULE) continue
    const config = entry.options.config
    if (serverNameOf(config, `entry:${entry.options.id}`) !== serverName) continue
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return undefined
    const row = config as Record<string, unknown>
    if (row['transport'] === 'streamable-http') {
      const url = row['url']
      if (typeof url !== 'string' || url === '') return undefined
      const headersValue = row['headers']
      const headers: Record<string, string> = {}
      if (typeof headersValue === 'object' && headersValue !== null && !Array.isArray(headersValue)) {
        for (const [key, value] of Object.entries(headersValue as Record<string, unknown>)) {
          if (typeof value === 'string') headers[key] = value
        }
      }
      return { kind: 'http', url, headers }
    }
    if (row['transport'] === 'stdio') {
      const command = row['command']
      if (typeof command !== 'string' || command === '') return undefined
      const argsValue = row['args']
      const args: string[] = []
      if (Array.isArray(argsValue)) {
        for (const value of argsValue) {
          if (typeof value !== 'string') return undefined
          args.push(value)
        }
      } else if (argsValue !== undefined) return undefined
      const envValue = row['env']
      const env: Record<string, string> = {}
      if (typeof envValue === 'object' && envValue !== null && !Array.isArray(envValue)) {
        for (const [key, value] of Object.entries(envValue as Record<string, unknown>)) {
          if (typeof value === 'string') env[key] = value
        }
      } else if (envValue !== undefined) return undefined
      const cwd = row['cwd']
      if (cwd !== undefined && (typeof cwd !== 'string' || cwd === '')) return undefined
      return { kind: 'stdio', command, args, env, ...(typeof cwd === 'string' ? { cwd } : {}) }
    }
    return undefined
  }
  return undefined
}

/**
 * Mount the panel: the three GET routes plus the upstream status observer.
 * Every registration is an effect on this fiber, so unloading removes the
 * endpoints and the listener.
 *
 * @param ctx - context carrying loader + tools + webServer.
 * @param config - raw loader config; defaults apply.
 */
export function apply(ctx: Context, config?: Config): void {
  const host = ctx as unknown as HostFace
  const probeTimeoutMs = typeof config?.probeTimeoutMs === 'number' && Number.isFinite(config.probeTimeoutMs)
    ? Math.max(1000, Math.floor(config.probeTimeoutMs))
    : 10_000

  // Consume the shipped upstream seam (live events + one-shot query seed).
  const observer = new McpStatusObserver()
  ctx.on(MCP_STATUS_EVENT, (payload) => { observer.observe(payload) })
  const query = ctx.get('mcpStatus')
  if (query !== undefined) {
    for (const status of query.list()) observer.observe(status)
  }

  const snapshot = (): McpSnapshot => buildMcpSnapshot(mcpRows(host.loader), [...host.tools.schemas()], observer)

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/mcp',
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        sendJson(res, 200, snapshot())
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'harness-panel: mcp route')

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/mcp/probe',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const serverName = url.searchParams.get('server') ?? ''
        const target = serverName === '' ? undefined : probeSpec(host.loader, serverName)
        if (target === undefined) {
          sendJson(res, 404, { error: `"${serverName}" is not a configured MCP server (streamable-http or stdio)` })
          return
        }
        const outcome = await runProbe(target, probeTimeoutMs)
        sendJson(res, 200, { server: serverName, ...outcome })
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'harness-panel: probe route')

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/hooks',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        const mounted = []
        for (const entry of host.loader.entries()) {
          if (dialectOf(entry.options.name) === undefined) continue
          const view = await bridgeViewOf({
            entryId: entry.options.id,
            moduleName: entry.options.name,
            disabled: entry.disabled,
            config: entry.options.config,
          })
          if (view !== undefined) mounted.push(view)
        }
        const discovered = []
        for (const path of conventionalHookPaths(process.cwd())) {
          discovered.push(await scanHookPath(path))
        }
        const body: HooksSnapshot = { mounted, discovered, collectedAt: Date.now() }
        sendJson(res, 200, body)
      } catch (error) {
        sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'harness-panel: hooks route')
}

export { MCP_CLIENT_MODULE, MCP_STATUS_EVENT, McpStatusObserver, buildMcpSnapshot } from './mcp.ts'
export type { McpSnapshot, McpServerView, McpToolView } from './mcp.ts'
export { parseHookFile, conventionalHookPaths } from './hooks.ts'
export type { HooksSnapshot, HookBridgeView, HookDiscoveryView } from './hooks.ts'
export { runProbe, scrubbedParentEnv } from './probe.ts'
export { sanitizeUrl, sanitizeText, sanitizeError } from './sanitize.ts'
