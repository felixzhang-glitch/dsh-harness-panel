/**
 * Shared client helpers: the translate face the slot renderer hands over, the
 * same-origin JSON readers/writer, and the current-session lookup.
 *
 * @module dsh-harness-panel/client/shared
 */

import type { HarnessPanelLocaleKey } from './locales.ts'

/** Namespace-bound translate function passed to slot components as `t`. */
export type Translate = (key: HarnessPanelLocaleKey) => string

/** Fill one `{placeholder}` in a dictionary entry. */
export function fill(template: string, values: Record<string, string | number>): string {
  let out = template
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{${key}}`).join(String(value))
  }
  return out
}

/** One failed panel route call, carrying the HTTP status for conflict handling. */
export class PanelHttpError extends Error {
  /**
   * @param status - HTTP status the host answered.
   * @param message - host error text.
   */
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'PanelHttpError'
  }
}

/** One JSON GET against the panel's host routes; throws on non-2xx. */
export async function fetchJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string' && body.error !== '') detail = body.error
    } catch { /* keep the status line */ }
    throw new PanelHttpError(response.status, detail)
  }
  return (await response.json()) as T
}

/**
 * One JSON POST against a panel write route. The custom header is required by
 * the host's same-origin gate; a cross-origin page cannot set it without a
 * preflight the server does not answer.
 */
export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    ...(signal === undefined ? {} : { signal }),
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-harness-panel': '1',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as { error?: unknown }
      if (typeof payload.error === 'string' && payload.error !== '') detail = payload.error
    } catch { /* keep the status line */ }
    throw new PanelHttpError(response.status, detail)
  }
  return (await response.json()) as T
}

/** Structural face of the client sessions store (read leaves only). */
interface SessionsFace {
  list?: {
    getSnapshot(): {
      current?: unknown
      byId?: Record<string, SessionRowFace | undefined>
    }
  }
}

/** One session catalog row's leaves. */
interface SessionRowFace {
  readonly cwd?: string
  readonly retainedBy?: { readonly mainView?: number }
}

/**
 * Read the current session id from the sessions store face (structural: the
 * store shape differs across harness lines, so only the leaves are read). A
 * host that publishes `current` wins; otherwise the session the main view
 * retains is derived from the per-session retention facts.
 */
export function currentSessionId(sessions: unknown): string | undefined {
  try {
    const list = (sessions as SessionsFace | null | undefined)?.list
    if (typeof list !== 'object' || list === null) return undefined
    const snapshot = list.getSnapshot()
    const current = snapshot.current
    if (typeof current === 'string' && current !== '') return current
    const byId = snapshot.byId
    if (byId === null || typeof byId !== 'object') return undefined
    for (const [id, entry] of Object.entries(byId)) {
      if ((entry?.retainedBy?.mainView ?? 0) > 0) return id
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Read a session's workspace directory from the catalog row. The catalog is
 * the same source the Session UI uses for file links, so a cold or resumed
 * session still answers when no live host session exists.
 */
export function currentSessionCwd(sessions: unknown, sessionId?: string): string | undefined {
  try {
    const list = (sessions as SessionsFace | null | undefined)?.list
    if (typeof list !== 'object' || list === null) return undefined
    const id = sessionId ?? currentSessionId(sessions)
    if (id === undefined) return undefined
    const row = list.getSnapshot().byId?.[id]
    const cwd = row?.cwd
    return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
  } catch {
    return undefined
  }
}

/** Format a byte count compactly; non-finite input renders an em dash. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

/** Format one epoch-ms timestamp for display; `null` renders the fallback. */
export function formatTime(epochMs: number | null): string | null {
  if (epochMs === null || !Number.isFinite(epochMs)) return null
  try {
    return new Date(epochMs).toLocaleString()
  } catch {
    return null
  }
}
