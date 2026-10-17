import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  RequestBodyError,
  hasPanelHeader,
  headerValue,
  isJsonContentType,
  isSameOrigin,
  readJsonBody,
  sendJson,
  type RequestFace,
  type ResponseFace,
} from '../src/http.ts'

function request(
  chunks: readonly (Buffer | string)[],
  headers: Record<string, string | string[] | undefined> = {},
): RequestFace {
  return {
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function response(): ResponseFace & { status?: number; headers?: Record<string, string>; body?: string | undefined } {
  const state: ResponseFace & { status?: number; headers?: Record<string, string>; body?: string | undefined } = {
    writeHead(status, headers) {
      state.status = status
      state.headers = headers
    },
    end(body) {
      state.body = body
    },
  }
  return state
}

describe('headerValue', () => {
  it('unwraps arrays and passes strings through', () => {
    expect(headerValue('x')).toBe('x')
    expect(headerValue(['a', 'b'])).toBe('a')
    expect(headerValue(undefined)).toBeUndefined()
    expect(headerValue([])).toBeUndefined()
  })
})

describe('isSameOrigin', () => {
  it('accepts a matching origin and a missing origin', () => {
    expect(isSameOrigin(request([], { origin: 'http://127.0.0.1:1', host: '127.0.0.1:1' }))).toBe(true)
    expect(isSameOrigin(request([]))).toBe(true)
  })

  it('accepts the desktop shell scheme and an opaque origin', () => {
    expect(isSameOrigin(request([], { origin: 'dsh-app://app', host: '127.0.0.1:1' }))).toBe(true)
    expect(isSameOrigin(request([], { origin: 'null', host: '127.0.0.1:1' }))).toBe(true)
  })

  it('rejects a mismatched or unparseable origin', () => {
    expect(isSameOrigin(request([], { origin: 'https://evil.test', host: '127.0.0.1:1' }))).toBe(false)
    expect(isSameOrigin(request([], { origin: 'not a url', host: '127.0.0.1:1' }))).toBe(false)
    expect(isSameOrigin(request([], { origin: 'http://127.0.0.1:1' }))).toBe(false)
  })
})

describe('write-route markers', () => {
  it('requires the exact custom header', () => {
    expect(hasPanelHeader(request([], { 'x-harness-panel': '1' }))).toBe(true)
    expect(hasPanelHeader(request([], { 'x-harness-panel': 'yes' }))).toBe(false)
    expect(hasPanelHeader(request([]))).toBe(false)
  })

  it('accepts application/json with parameters', () => {
    expect(isJsonContentType(request([], { 'content-type': 'application/json; charset=utf-8' }))).toBe(true)
    expect(isJsonContentType(request([], { 'content-type': 'Application/JSON' }))).toBe(true)
    expect(isJsonContentType(request([], { 'content-type': 'text/plain' }))).toBe(false)
    expect(isJsonContentType(request([]))).toBe(false)
  })
})

describe('readJsonBody', () => {
  it('parses chunked JSON', async () => {
    await expect(readJsonBody(request(['{"name":', '"foo"}']))).resolves.toEqual({ name: 'foo' })
  })

  it('rejects empty and malformed bodies as 400', async () => {
    await expect(readJsonBody(request([]))).rejects.toMatchObject({ status: 400 })
    await expect(readJsonBody(request(['{nope']))).rejects.toMatchObject({ status: 400 })
    await expect(readJsonBody(request(['[]']))).resolves.toEqual([])
  })

  it('rejects oversized bodies as 413 before buffering past the limit', async () => {
    const oversized = 'x'.repeat(40)
    await expect(readJsonBody(request([oversized]), 16)).rejects.toBeInstanceOf(RequestBodyError)
    await expect(readJsonBody(request([oversized]), 16)).rejects.toMatchObject({ status: 413 })
  })
})

describe('sendJson', () => {
  it('writes no-store JSON', () => {
    const res = response()
    sendJson(res, 200, { ok: true })
    expect(res.status).toBe(200)
    expect(res.headers?.['content-type']).toContain('application/json')
    expect(res.headers?.['cache-control']).toBe('no-store')
    expect(res.body).toBe('{"ok":true}')
  })
})
