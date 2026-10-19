/**
 * `dsh-harness-panel` — the Harness settings panel: a native-styled settings
 * section grouping MCP server status and start/stop, the session skill
 * catalog with enable/disable, and hook bridge configurations (mounted rows
 * plus conventional on-disk files).
 *
 * The host half serves GET routes for MCP (`/harness-panel/mcp`,
 * `/harness-panel/mcp/probe`), hooks (`/harness-panel/hooks`), the skill
 * toggle state (`/harness-panel/skills`), and the AGENTS.md loading chain
 * (`/harness-panel/agents`, `/harness-panel/agents/file`), plus write routes
 * for skill toggles (`POST /harness-panel/skills/toggle`), per-hook toggles
 * (`POST /harness-panel/hooks/toggle-hook` — one hook command's `type`
 * flipped to the sentinel the bridges skip, then the owning bridge row
 * reloaded through the shipped pluginManager), and AGENTS.md file writes
 * (`POST /harness-panel/agents/write` — candidate-path allowlist plus an
 * mtime precondition). MCP and hook bridge switches
 * do not write through this host: the browser calls the shipped
 * `pluginManager` Remote, exactly like the built-in Plugins page. A skill
 * toggle edits the skill file's frontmatter invocation keys — the
 * provider's own disable contract, honored in every scope layer — and the
 * state file under the DSH home records the original lines for restore.
 * Secret values never leave the host: env and header maps surface as key
 * lists, URLs and error text are redacted. Instruction-file content is
 * returned only to the same-origin panel and is never logged.
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
import {
  buildAgentsSnapshot,
  discoverAgentInstructionSlots,
  normalizeAbsolutePath,
  resolveAgentScope,
  type AgentPresetsFace,
  type AgentScope,
  type AgentSessionProjectionsFace,
  type AgentSessionsFace,
  type AgentScopeServices,
  type ResolveAgentScopeOptions,
} from './agents.ts'
import {
  AgentFileError,
  parseAgentWriteRequest,
  readAgentInstructionFile,
  writeAgentInstructionFile,
} from './agent-file.ts'
import { MAX_AGENT_WRITE_BODY_BYTES, type AgentFileWriteResult } from './agents-contract.ts'
import {
  hasPanelHeader,
  isJsonContentType,
  isSameOrigin,
  readJsonBody,
  RequestBodyError,
  sendJson,
  type RequestFace,
  type ResponseFace,
} from './http.ts'
import {
  HookFileError,
  disableHookFile,
  enableHookFile,
  parseHookToggleRequest,
  type HookToggleRequest,
} from './hook-file.ts'
import { sanitizeError } from './sanitize.ts'
import {
  SkillFileError,
  disableSkillFile,
  enableSkillFile,
  parseSkillToggleRequest,
  type SkillToggleRequest,
} from './skill-file.ts'
import {
  MAX_DISABLED_SKILLS,
  MAX_HOOK_TOGGLES,
  disabledSkillRecords,
  hookToggleKey,
  hookToggleRecords,
  loadPanelStateFile,
  resolvePanelStatePath,
  savePanelStateFile,
  type DisabledSkillRecord,
  type HookToggleRecord,
  type PanelState,
} from './panel-state.ts'

export const name = 'dsh-harness-panel'

/** Hard services: the facts the panel reads and the route registry it serves. Skill gating is optional. */
export const inject = ['loader', 'tools', 'webServer']

/** Plugin config (all optional). */
export interface Config {
  /** Per-probe timeout in milliseconds. */
  probeTimeoutMs?: number
  /** Skill gate state file override; defaults to `$DSH_HOME/harness-panel/state.json`. */
  statePath?: string
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
  /** The full loader entry id, parent-prefixed; what pluginManager switches by. */
  readonly id: string
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
    handler: (req: RequestFace, res: ResponseFace) => void | Promise<void>
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
 * Mount the panel: the nine routes and the upstream status observer. Skill
 * toggles edit the skill file's frontmatter directly (the provider's own
 * disable keys) and record the original lines in the state file. AGENTS.md
 * routes discover the same candidate chain the instruction loader uses and
 * write one allowlisted candidate at a time. Every registration is an effect
 * on this fiber, so unloading removes the endpoints and the listener.
 *
 * @param ctx - context carrying loader + tools + webServer.
 * @param config - raw loader config; defaults apply.
 */
export function apply(ctx: Context, config?: Config): void {
  const host = ctx as unknown as HostFace
  const probeTimeoutMs = typeof config?.probeTimeoutMs === 'number' && Number.isFinite(config.probeTimeoutMs)
    ? Math.max(1000, Math.floor(config.probeTimeoutMs))
    : 10_000
  const statePath = config?.statePath ?? resolvePanelStatePath()

  const loaded = loadPanelStateFile(statePath)
  if (loaded.warning !== null) ctx.logger.warn(`harness-panel: ${loaded.warning}`)
  let state: PanelState = loaded.state

  // Serialize the toggle writes so two requests cannot interleave a file edit
  // with a state write.
  let stateWrite: Promise<void> = Promise.resolve()

  // Serialize AGENTS.md writes for the same reason: discovery and the mtime
  // precondition are read outside the write, so concurrent saves must queue.
  let agentWrite: Promise<void> = Promise.resolve()

  /**
   * Build the scope options shared by the AGENTS.md routes. The services are
   * optional so the panel still mounts on a host without presets or sessions.
   */
  const agentScopeOptions = (sessionId?: string, cwd?: string): ResolveAgentScopeOptions => {
    const services: AgentScopeServices = {
      sessions: ctx.get('sessions') as AgentSessionsFace | undefined,
      projections: ctx.get('sessionProjections') as AgentSessionProjectionsFace | undefined,
      presets: ctx.get('agentPresets') as AgentPresetsFace | undefined,
    }
    return {
      entries: [...host.loader.entries()],
      ...(sessionId === undefined ? {} : { sessionId }),
      ...(cwd === undefined ? {} : { cwd }),
      fsAvailable: ctx.get('fs') !== undefined,
      services,
    }
  }

  /** One file request resolved to its candidate path and chain scope. */
  interface CandidateMatch {
    readonly scope: AgentScope
    readonly path: string
  }

  /** Resolve the candidate a file request names, or undefined when it is not in the chain. */
  const candidateMatch = async (sessionId?: string, cwd?: string, path?: string): Promise<CandidateMatch | undefined> => {
    const scope = await resolveAgentScope(agentScopeOptions(sessionId, cwd))
    const discovery = await discoverAgentInstructionSlots(scope)
    const requested = normalizeAbsolutePath(path)
    if (requested === undefined) return undefined
    for (const group of discovery.groups) {
      for (const slot of group.slots) {
        if (slot.path === requested) return { scope, path: slot.path }
      }
    }
    return undefined
  }

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

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/hooks/toggle-hook',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!hasPanelHeader(req) || !isSameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      if (!isJsonContentType(req)) {
        sendJson(res, 415, { error: 'content-type must be application/json' })
        return
      }
      let parsed: HookToggleRequest | undefined
      try {
        parsed = parseHookToggleRequest(await readJsonBody(req))
      } catch (error) {
        if (error instanceof RequestBodyError) {
          sendJson(res, error.status, { error: error.message })
          return
        }
        sendJson(res, 400, { error: sanitizeError(error) })
        return
      }
      if (parsed === undefined) {
        sendJson(res, 400, { error: 'invalid hook toggle request' })
        return
      }
      const request = parsed
      try {
        // Resolve the bridge's config file and full loader entry id. The
        // state's record keeps enable working even when the row is not
        // currently loaded.
        let configPath: string | undefined
        let loaderEntryId: string | undefined
        let rowEnabled = false
        for (const entry of host.loader.entries()) {
          if (dialectOf(entry.options.name) === undefined) continue
          if (entry.options.id !== request.bridge) continue
          const config = entry.options.config
          const candidate = typeof config === 'object' && config !== null && !Array.isArray(config)
            ? (config as Record<string, unknown>)['configPath']
            : undefined
          if (typeof candidate === 'string' && candidate !== '') configPath = candidate
          loaderEntryId = entry.id
          rowEnabled = !entry.disabled
          break
        }
        const existing = state.hookToggles.get(hookToggleKey(request))
        if (configPath === undefined) configPath = existing?.configPath
        if (configPath === undefined) {
          sendJson(res, 400, { error: `bridge "${request.bridge}" is not mounted and has no recorded config file` })
          return
        }
        let reloadOutcome: 'applied' | 'restart-required' | 'failed' | 'skipped' | 'unavailable' = 'skipped'
        const run = stateWrite.then(async () => {
          if (request.enabled) {
            const record = existing
            if (record !== undefined) {
              await enableHookFile(configPath!, request, record.originalType)
              const next = new Map(state.hookToggles)
              next.delete(hookToggleKey(request))
              const nextState: PanelState = { version: 3, disabledSkills: state.disabledSkills, hookToggles: next }
              await savePanelStateFile(statePath, nextState)
              state = nextState
            }
            return
          }
          if (existing !== undefined) return
          if (state.hookToggles.size >= MAX_HOOK_TOGGLES) {
            throw new HookFileError(500, `at most ${MAX_HOOK_TOGGLES} disabled hooks are supported`)
          }
          // The file carries the disable; the state records the original
          // `type` for restore.
          const edit = await disableHookFile(configPath!, request)
          const record: HookToggleRecord = {
            bridge: request.bridge,
            configPath,
            event: request.event,
            matcher: request.matcher,
            command: request.command,
            ...(edit.originalType === undefined ? {} : { originalType: edit.originalType }),
            disabledAt: Date.now(),
          }
          const next = new Map(state.hookToggles)
          next.set(hookToggleKey(request), record)
          const nextState: PanelState = { version: 3, disabledSkills: state.disabledSkills, hookToggles: next }
          await savePanelStateFile(statePath, nextState)
          state = nextState
        })
        stateWrite = run.catch(() => {})
        await run
        // The bridges parse their config once at load, so the row must reload
        // for the edit to reach the running process. A row that is currently
        // off reads the file when the user switches it back on.
        if (loaderEntryId !== undefined && rowEnabled) {
          const pluginManager = ctx.get('pluginManager') as {
            setPluginEnabled?(entryId: string, enabled: boolean): Promise<{ application: string }>
          } | undefined
          if (pluginManager?.setPluginEnabled === undefined) {
            reloadOutcome = 'unavailable'
          } else {
            try {
              await pluginManager.setPluginEnabled(loaderEntryId, false)
              const result = await pluginManager.setPluginEnabled(loaderEntryId, true)
              reloadOutcome = result.application === 'applied' || result.application === 'overridden'
                ? 'applied'
                : result.application === 'restart-required' ? 'restart-required' : 'failed'
            } catch {
              reloadOutcome = 'failed'
            }
          }
        }
        sendJson(res, 200, { hookToggles: hookToggleRecords(state), reloaded: reloadOutcome })
      } catch (error) {
        if (error instanceof HookFileError) {
          sendJson(res, error.status, { error: sanitizeError(error.message) })
          return
        }
        sendJson(res, 500, { error: sanitizeError(error) })
      }
    },
  }), 'harness-panel: hook toggle route')

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/skills',
    handler: (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        sendJson(res, 200, {
          fileControlAvailable: true,
          disabled: disabledSkillRecords(state),
          collectedAt: Date.now(),
        })
      } catch (error) {
        sendJson(res, 500, { error: sanitizeError(error) })
      }
    },
  }), 'harness-panel: skills route')

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/skills/toggle',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!hasPanelHeader(req) || !isSameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      if (!isJsonContentType(req)) {
        sendJson(res, 415, { error: 'content-type must be application/json' })
        return
      }
      let parsed: SkillToggleRequest | undefined
      try {
        parsed = parseSkillToggleRequest(await readJsonBody(req))
      } catch (error) {
        if (error instanceof RequestBodyError) {
          sendJson(res, error.status, { error: error.message })
          return
        }
        sendJson(res, 400, { error: sanitizeError(error) })
        return
      }
      if (parsed === undefined) {
        sendJson(res, 400, { error: 'invalid skill toggle request' })
        return
      }
      const request = parsed
      try {
        const run = stateWrite.then(async () => {
          if (request.enabled) {
            // A skill deleted while disabled leaves nothing to restore: the
            // file edit is a no-op and the record simply drops.
            const record = state.disabledSkills.get(request.name)
            if (record !== undefined) {
              await enableSkillFile(record.path, record.name, record.original)
              const next = new Map(state.disabledSkills)
              next.delete(request.name)
              const nextState: PanelState = { version: 3, disabledSkills: next, hookToggles: state.hookToggles }
              await savePanelStateFile(statePath, nextState)
              state = nextState
            }
            return
          }
          const disable = request.disable
          if (disable === undefined) throw new SkillFileError(400, 'disable request has no skill file path')
          if (state.disabledSkills.has(request.name)) return
          if (state.disabledSkills.size >= MAX_DISABLED_SKILLS) {
            throw new SkillFileError(500, `at most ${MAX_DISABLED_SKILLS} disabled skills are supported`)
          }
          // The file carries the disable for every scope layer; the recorded
          // original lines make the toggle reversible.
          const edit = await disableSkillFile(disable.path, disable.name)
          const record: DisabledSkillRecord = {
            name: disable.name,
            description: disable.description,
            path: disable.path,
            ...(disable.whenToUse === undefined ? {} : { whenToUse: disable.whenToUse }),
            modelInvocable: disable.modelInvocable,
            disabledAt: Date.now(),
            original: edit.original,
          }
          const next = new Map(state.disabledSkills)
          next.set(request.name, record)
          const nextState: PanelState = { version: 3, disabledSkills: next, hookToggles: state.hookToggles }
          await savePanelStateFile(statePath, nextState)
          state = nextState
        })
        stateWrite = run.catch(() => {})
        await run
        sendJson(res, 200, { disabled: disabledSkillRecords(state) })
      } catch (error) {
        if (error instanceof SkillFileError) {
          sendJson(res, error.status, { error: sanitizeError(error.message) })
          return
        }
        sendJson(res, 500, { error: sanitizeError(error) })
      }
    },
  }), 'harness-panel: skills toggle route')

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/agents',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const sessionId = url.searchParams.get('session') ?? undefined
        const cwd = url.searchParams.get('cwd') ?? undefined
        sendJson(res, 200, await buildAgentsSnapshot(agentScopeOptions(sessionId, cwd)))
      } catch (error) {
        sendJson(res, 500, { error: sanitizeError(error) })
      }
    },
  }), 'harness-panel: agents route')

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/agents/file',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      try {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const match = await candidateMatch(
          url.searchParams.get('session') ?? undefined,
          url.searchParams.get('cwd') ?? undefined,
          url.searchParams.get('path') ?? undefined,
        )
        if (match === undefined) {
          sendJson(res, 400, { error: 'path is not an instruction candidate for this working directory' })
          return
        }
        sendJson(res, 200, await readAgentInstructionFile(match.path))
      } catch (error) {
        if (error instanceof AgentFileError) {
          sendJson(res, error.status, { error: sanitizeError(error.message) })
          return
        }
        sendJson(res, 500, { error: sanitizeError(error) })
      }
    },
  }), 'harness-panel: agents file route')

  ctx.effect(() => host.webServer.register({
    kind: 'exact',
    path: '/harness-panel/agents/write',
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' })
        return
      }
      if (!hasPanelHeader(req) || !isSameOrigin(req)) {
        sendJson(res, 403, { error: 'forbidden' })
        return
      }
      if (!isJsonContentType(req)) {
        sendJson(res, 415, { error: 'content-type must be application/json' })
        return
      }
      let request
      try {
        request = parseAgentWriteRequest(await readJsonBody(req, MAX_AGENT_WRITE_BODY_BYTES))
      } catch (error) {
        if (error instanceof RequestBodyError) {
          sendJson(res, error.status, { error: error.message })
          return
        }
        sendJson(res, 400, { error: sanitizeError(error) })
        return
      }
      if (request === undefined) {
        sendJson(res, 400, { error: 'invalid instruction file write request' })
        return
      }
      const parsed = request
      try {
        const match = await candidateMatch(parsed.sessionId, parsed.cwd, parsed.path)
        if (match === undefined) {
          sendJson(res, 400, { error: 'path is not an instruction candidate for this working directory' })
          return
        }
        let result: AgentFileWriteResult | undefined
        const run = agentWrite.then(async () => {
          result = await writeAgentInstructionFile({
            path: match.path,
            content: parsed.content,
            expectedMtimeMs: parsed.expectedMtimeMs,
            allowedRoots: [match.scope.projectRoot, match.scope.dshHome, match.scope.agentsHome],
          })
        })
        agentWrite = run.catch(() => {})
        await run
        if (result === undefined) throw new Error('instruction file write produced no result')
        sendJson(res, 200, result)
      } catch (error) {
        if (error instanceof AgentFileError) {
          sendJson(res, error.status, { error: sanitizeError(error.message) })
          return
        }
        sendJson(res, 500, { error: sanitizeError(error) })
      }
    },
  }), 'harness-panel: agents write route')
}

export { MCP_CLIENT_MODULE, MCP_STATUS_EVENT, McpStatusObserver, buildMcpSnapshot } from './mcp.ts'
export type { McpSnapshot, McpServerView, McpToolView } from './mcp.ts'
export { parseHookFile, conventionalHookPaths } from './hooks.ts'
export type { HooksSnapshot, HookBridgeView, HookDiscoveryView } from './hooks.ts'
export { runProbe, scrubbedParentEnv } from './probe.ts'
export { sanitizeUrl, sanitizeText, sanitizeError } from './sanitize.ts'
export { writeFileAtomic } from './atomic.ts'
export {
  DISABLE_MODEL_KEY,
  SkillFileError,
  USER_INVOCABLE_KEY,
  disableSkillFile,
  enableSkillFile,
  isSkillName,
  parseSkillToggleRequest,
} from './skill-file.ts'
export type { OriginalInvocationLines, SkillFileEdit, SkillToggleRequest } from './skill-file.ts'
export {
  HOOK_COMMAND_TYPE,
  HOOK_DISABLED_TYPE,
  HookFileError,
  disableHookFile,
  enableHookFile,
  parseHookToggleRequest,
} from './hook-file.ts'
export type { HookEditResult, HookToggleRequest } from './hook-file.ts'
export {
  MAX_DISABLED_SKILLS,
  MAX_HOOK_TOGGLES,
  PANEL_STATE_VERSION,
  disabledSkillRecords,
  hookToggleKey,
  hookToggleRecords,
  loadPanelStateFile,
  normalizeDisabledSkill,
  normalizeHookToggle,
  parsePanelState,
  resolvePanelStatePath,
  savePanelStateFile,
  serializePanelState,
} from './panel-state.ts'
export type { DisabledSkillRecord, HookToggleRecord, PanelState } from './panel-state.ts'
export { hasPanelHeader, isJsonContentType, isSameOrigin, readJsonBody, RequestBodyError } from './http.ts'
export {
  DEFAULT_INSTRUCTION_FILE_CANDIDATES,
  DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES,
  DEFAULT_MAX_SOURCE_BYTES,
  DEFAULT_PROJECT_ROOT_MARKERS,
  agentsHomeDisplay,
  buildAgentsSnapshot,
  discoverAgentInstructionSlots,
  dshHomeDisplay,
  normalizeAbsolutePath,
  normalizeSessionId,
  parseAgentInstructionsConfig,
  renderInstructionBaseline,
  resolveAgentScope,
  resolveAgentsHome,
  resolveDshHome,
  resolveInstructionRow,
} from './agents.ts'
export type {
  AgentInstructionSlot,
  AgentInstructionSlotGroup,
  AgentInstructionsLoaderEntry,
  AgentScope,
  AgentScopeServices,
  ResolveAgentScopeOptions,
} from './agents.ts'
export {
  AGENT_INSTRUCTIONS_MODULE,
  AGENT_PRESET_MODULE,
  MAX_AGENT_FILE_BYTES,
  MAX_AGENT_PREVIEW_BYTES,
  MAX_AGENT_WRITE_BODY_BYTES,
} from './agents-contract.ts'
export type {
  AgentFileContent,
  AgentFileMetadata,
  AgentFileWriteResult,
  AgentInstructionFileStatus,
  AgentInstructionFileView,
  AgentInstructionGroupView,
  AgentInstructionReason,
  AgentInstructionRowView,
  AgentInstructionScope,
  AgentInstructionsConfig,
  AgentsBudgetView,
  AgentsSnapshot,
} from './agents-contract.ts'
export {
  AgentFileError,
  parseAgentWriteRequest,
  readAgentInstructionFile,
  writeAgentInstructionFile,
} from './agent-file.ts'
export type { AgentWriteRequest } from './agent-file.ts'
