import { describe, expect, it } from 'vitest'
import { sanitizeError, sanitizeText, sanitizeUrl } from '../src/sanitize.ts'

describe('sanitizeUrl', () => {
  it('redacts the userinfo password', () => {
    expect(sanitizeUrl('https://user:hunter2@example.com/mcp')).toBe('https://user:***@example.com/mcp')
  })

  it('redacts credential query values and keeps benign ones', () => {
    const out = sanitizeUrl('https://example.com/mcp?api_key=sekret&region=sg&token=abc')
    expect(out).toContain('api_key=***')
    expect(out).toContain('region=sg')
    expect(out).toContain('token=***')
    expect(out).not.toContain('sekret')
    expect(out).not.toContain('abc')
  })

  it('falls back to pattern redaction on unparseable input', () => {
    const out = sanitizeUrl('not a url ?key=sekret')
    expect(out).not.toContain('sekret')
  })

  it('leaves a clean URL untouched', () => {
    const url = 'https://iqs-mcp.aliyuncs.com/mcp-servers/iqs-mcp-server-search'
    expect(sanitizeUrl(url)).toBe(url)
  })
})

describe('sanitizeText', () => {
  it('redacts bearer tokens', () => {
    const out = sanitizeText('Authorization: Bearer abc.def.ghi')
    expect(out).not.toContain('abc.def.ghi')
    expect(out).toContain('***')
  })

  it('redacts env-shaped credentials', () => {
    const out = sanitizeText('spawn failed: GITHUB_TOKEN=ghp_secretvalue123 not found')
    expect(out).toContain('GITHUB_TOKEN=***')
    expect(out).not.toContain('ghp_secretvalue123')
  })

  it('redacts raw JWTs', () => {
    const jwt = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c`
    expect(sanitizeText(`token: ${jwt}`)).not.toContain('SflKxw')
  })
})

describe('sanitizeError', () => {
  it('never throws on hostile input', () => {
    const hostile = { toString: () => { throw new Error('boom') } }
    expect(sanitizeError(hostile)).toBe('<unrenderable error>')
  })
})
