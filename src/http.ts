/**
 * Small host HTTP helpers shared by the panel's routes: JSON responses, a
 * same-origin/header gate for the one write route, and a bounded JSON body
 * reader. These are structural faces over the shipped webserver request and
 * response; nothing here imports the webserver package.
 *
 * @module dsh-harness-panel/http
 */

import { Buffer } from 'node:buffer'

/** The webserver request leaves this module reads. */
export interface RequestFace {
  readonly method?: string
  readonly url?: string
  readonly headers?: Record<string, string | string[] | undefined>
  [Symbol.asyncIterator](): AsyncIterator<Buffer | string>
}

/** The webserver response leaves this module writes. */
export interface ResponseFace {
  writeHead(status: number, headers: Record<string, string>): void
  end(body?: string): void
}

/** A request-body failure carrying the HTTP status the route should answer. */
export class RequestBodyError extends Error {
  /**
   * @param status - 400 for malformed input, 413 for an oversized body.
   * @param message - human-readable reason.
   */
  constructor(readonly status: 400 | 413, message: string) {
    super(message)
    this.name = 'RequestBodyError'
  }
}

/** Write one JSON response with no-store caching. */
export function sendJson(res: ResponseFace, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

/** Read one header value, unwrapping Node's string[] form. */
export function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Whether a request may reach the write route. A browser sends `Origin` on a
 * same-origin POST, so a present http(s) origin must name the request's own
 * host. The desktop shell's custom scheme and an opaque `null` origin are
 * allowed through this check because the custom panel header — which a
 * cross-origin browser cannot set without a preflight the server does not
 * answer — remains mandatory.
 */
export function isSameOrigin(req: RequestFace): boolean {
  const origin = headerValue(req.headers?.['origin'])
  if (origin === undefined || origin === '' || origin === 'null') return true
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    return false
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true
  const host = headerValue(req.headers?.['host'])
  if (host === undefined || host === '') return false
  return parsed.host === host
}

/** Whether the request carries the panel's write-route marker. */
export function hasPanelHeader(req: RequestFace): boolean {
  return headerValue(req.headers?.['x-harness-panel']) === '1'
}

/** Whether the request declares a JSON body. */
export function isJsonContentType(req: RequestFace): boolean {
  const value = headerValue(req.headers?.['content-type'])
  if (value === undefined) return false
  return value.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

/**
 * Read a bounded JSON body. Empty and malformed bodies are 400; a body over
 * the limit is 413, checked as chunks arrive so a hostile client cannot make
 * the host buffer an unbounded payload.
 *
 * @param req - request with an async byte stream.
 * @param limit - maximum body bytes.
 * @returns the parsed JSON value.
 */
export async function readJsonBody(req: RequestFace, limit = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    size += buffer.length
    if (size > limit) throw new RequestBodyError(413, `request body exceeds ${limit} bytes`)
    chunks.push(buffer)
  }
  if (size === 0) throw new RequestBodyError(400, 'request body is empty')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new RequestBodyError(400, 'request body is not valid JSON')
  }
}
