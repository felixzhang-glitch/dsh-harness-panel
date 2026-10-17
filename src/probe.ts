/**
 * One-shot connectivity probe of one configured MCP server (streamable-http
 * or stdio), executed inline by the host route handler with a deadline.
 * Results are panel-only.
 *
 * The stdio probe spawns the configured `command`/`args` with a scrubbed
 * parent environment (credential-shaped and `DSH_*` names never reach the
 * child implicitly) plus the row's explicit `env`/`cwd`, and completes one
 * MCP `initialize` handshake over stdin/stdout.
 *
 * @module dsh-harness-panel/probe
 */

import { spawn } from 'node:child_process'
import { bounded, sanitizeError, sanitizeText } from './sanitize.ts'

/** JSON-RPC MCP initialize protocol version (protocol constant). */
const INITIALIZE_PROTOCOL_VERSION = '2024-11-05'

/** MCP clientInfo facts; protocol constants, not configuration. */
const PROBE_CLIENT_INFO = { name: 'dsh-harness-panel', version: '0.2.0' }

/** Parent env names dropped before spawning a probe child. */
const SENSITIVE_ENV = /KEY|PASSWORD|SECRET|TOKEN/i

/** One settled probe: outcome status plus a sanitized one-line detail. */
export interface ProbeOutcome {
  readonly status: 'completed' | 'failed'
  /** Sanitized one-line detail (HTTP status, latency, server info, or error). */
  readonly detail: string
  /** Wall-clock latency of the attempt. */
  readonly latencyMs: number
}

/** One configured server's probe spec: an HTTP endpoint or a stdio launch. */
export type ProbeTarget =
  | { readonly kind: 'http'; readonly url: string; readonly headers: Readonly<Record<string, string>> }
  | {
      readonly kind: 'stdio'
      readonly command: string
      readonly args: readonly string[]
      readonly env: Readonly<Record<string, string>>
      readonly cwd?: string
    }

/**
 * The ambient parent environment minus credential-shaped names and minus all
 * `DSH_*` names — the same base the mcp-client bridge uses, so a probe child
 * starts exactly as a bridged server would.
 */
export function scrubbedParentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !SENSITIVE_ENV.test(key) && !key.toUpperCase().startsWith('DSH_')) {
      env[key] = value
    }
  }
  return env
}

/**
 * POST one MCP `initialize` request and describe the outcome in one
 * sanitized line. The configured headers are used for the request itself
 * (exactly as the bridge would) and never rendered.
 */
export async function probeEndpoint(
  url: string,
  headers: Readonly<Record<string, string>>,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, timeoutMs)
  timer.unref?.()
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: INITIALIZE_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: PROBE_CLIENT_INFO,
        },
      }),
      signal: controller.signal,
    })
    const ms = Date.now() - started
    if (!response.ok) {
      return { status: 'failed', detail: `HTTP ${response.status} ${response.statusText}`, latencyMs: ms }
    }
    let serverInfo: { name?: unknown; version?: unknown } = {}
    try {
      const body = (await response.json()) as { result?: { serverInfo?: { name?: unknown; version?: unknown } } }
      serverInfo = body?.result?.serverInfo ?? {}
    } catch {
      // A 2xx without a JSON body: connectivity itself succeeded.
    }
    const name = typeof serverInfo.name === 'string' && serverInfo.name !== ''
      ? bounded(sanitizeText(serverInfo.name), 80)
      : 'unnamed'
    const version = typeof serverInfo.version === 'string' && serverInfo.version !== ''
      ? bounded(sanitizeText(serverInfo.version), 80)
      : 'unknown version'
    return { status: 'completed', detail: `HTTP ${response.status}, MCP initialize ok (server ${name} ${version})`, latencyMs: ms }
  } catch (error) {
    const ms = Date.now() - started
    if (controller.signal.aborted) return { status: 'failed', detail: `timeout after ${timeoutMs}ms`, latencyMs: ms }
    return { status: 'failed', detail: sanitizeError(error), latencyMs: ms }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Complete one MCP `initialize` handshake over a spawned stdio server's
 * stdin/stdout and describe the outcome in one sanitized line. The child's
 * stderr is consumed and never rendered.
 */
export function probeStdio(
  target: Extract<ProbeTarget, { kind: 'stdio' }>,
  timeoutMs: number,
): Promise<ProbeOutcome> {
  const started = Date.now()
  return new Promise<ProbeOutcome>((resolve) => {
    let settled = false
    let child: ReturnType<typeof spawn> | undefined
    let buffer = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (outcome: Omit<ProbeOutcome, 'latencyMs'>): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      try { child?.kill() } catch { /* already gone */ }
      resolve({ ...outcome, latencyMs: Date.now() - started })
    }
    timer = setTimeout(() => {
      finish({ status: 'failed', detail: `timeout after ${timeoutMs}ms` })
    }, timeoutMs)
    timer.unref?.()
    try {
      child = spawn(target.command, [...target.args], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...scrubbedParentEnv(), ...target.env },
        ...(target.cwd !== undefined && target.cwd !== '' ? { cwd: target.cwd } : {}),
        windowsHide: true,
      })
    } catch (error) {
      finish({ status: 'failed', detail: sanitizeError(error) })
      return
    }
    child.on('error', (error) => finish({ status: 'failed', detail: sanitizeError(error) }))
    child.on('exit', (code, signalName) => {
      finish({
        status: 'failed',
        detail: `process exited before initialize response (code ${code ?? 'null'}${signalName ? `, signal ${signalName}` : ''})`,
      })
    })
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      let index: number
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line === '') continue
        let message: { id?: unknown; result?: { serverInfo?: { name?: unknown; version?: unknown } } } | undefined
        try {
          message = JSON.parse(line) as typeof message
        } catch {
          continue
        }
        if (message !== null && typeof message === 'object' && message?.id === 1 && message.result !== undefined) {
          const serverInfo = message.result.serverInfo ?? {}
          const name = typeof serverInfo.name === 'string' && serverInfo.name !== ''
            ? bounded(sanitizeText(serverInfo.name), 80)
            : 'unnamed'
          const version = typeof serverInfo.version === 'string' && serverInfo.version !== ''
            ? bounded(sanitizeText(serverInfo.version), 80)
            : 'unknown version'
          finish({ status: 'completed', detail: `MCP initialize ok over stdio (server ${name} ${version})` })
          return
        }
      }
    })
    child.stderr?.on('data', () => { /* consumed, never rendered */ })
    try {
      child.stdin?.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: INITIALIZE_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: PROBE_CLIENT_INFO,
        },
      })}\n`)
    } catch { /* the exit/error paths settle the outcome */ }
  })
}

/** Run one probe to settlement against a resolved target. */
export function runProbe(target: ProbeTarget, timeoutMs: number): Promise<ProbeOutcome> {
  return target.kind === 'http'
    ? probeEndpoint(target.url, target.headers, timeoutMs)
    : probeStdio(target, timeoutMs)
}
