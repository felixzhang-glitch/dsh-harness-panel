import { describe, expect, it } from 'vitest'
import {
  McpStatusObserver,
  buildMcpSnapshot,
  configuredNote,
  deriveTarget,
  groupMcpTools,
  serverNameOf,
  type McpLoaderRow,
} from '../src/mcp.ts'

describe('serverNameOf', () => {
  it('reads the configured namespace', () => {
    expect(serverNameOf({ serverName: 'iqs-search' }, 'entry:x')).toBe('iqs-search')
  })

  it('falls back on missing or non-string names', () => {
    expect(serverNameOf({}, 'entry:x')).toBe('entry:x')
    expect(serverNameOf(null, 'entry:x')).toBe('entry:x')
    expect(serverNameOf({ serverName: 42 }, 'entry:x')).toBe('entry:x')
  })
})

describe('deriveTarget', () => {
  it('renders a stdio command line', () => {
    expect(deriveTarget({ transport: 'stdio', command: 'npx', args: ['-y', 'server'] }))
      .toEqual({ transport: 'stdio', target: 'npx -y server' })
  })

  it('sanitizes an http url', () => {
    const { target } = deriveTarget({ transport: 'streamable-http', url: 'https://example.com/mcp?api_key=sekret' })
    expect(target).toContain('api_key=***')
    expect(target).not.toContain('sekret')
  })

  it('marks malformed rows unknown', () => {
    expect(deriveTarget({ transport: 'bogus' }).transport).toBe('unknown')
    expect(deriveTarget({ transport: 'stdio' }).target).toBe('(unconfigured)')
  })
})

describe('configuredNote', () => {
  it('reads only booleans and numbers', () => {
    expect(configuredNote({ reconnect: { enabled: false } })).toBe('reconnect off')
    expect(configuredNote({ reconnect: { maxAttempts: 5 } })).toBe('reconnect max 5')
    expect(configuredNote({ failOnStartupError: true, toolCallTimeoutMs: 60000 }))
      .toBe('fail on startup error; tool timeout 60s')
    expect(configuredNote({})).toBeNull()
    // String fields never leak, even innocuous ones.
    expect(configuredNote({ serverName: 'x', note: 'hello' })).toBeNull()
  })
})

describe('groupMcpTools', () => {
  const schemas = [
    { name: 'mcp__iqs-search__common_search', description: 'search' },
    { name: 'mcp__iqs-readpage__readpage_basic' },
    { name: 'mcp__foreign__other', description: 'not configured' },
    { name: 'bash', description: 'not mcp' },
  ]

  it('buckets tools under their configured server', () => {
    const groups = groupMcpTools(schemas, ['iqs-search', 'iqs-readpage'])
    expect(groups.get('iqs-search')).toHaveLength(1)
    expect(groups.get('iqs-readpage')).toHaveLength(1)
    // Foreign mcp__ tools and non-mcp tools are not attributed.
    expect(groups.has('foreign')).toBe(false)
  })

  it('keeps configured servers with zero tools', () => {
    const groups = groupMcpTools([], ['iqs-search'])
    expect(groups.get('iqs-search')).toEqual([])
  })
})

describe('McpStatusObserver', () => {
  it('ignores malformed payloads', () => {
    const observer = new McpStatusObserver()
    observer.observe(null)
    observer.observe({ serverName: 'x', phase: 'bogus', attempt: 1, maxAttempts: 3, toolCount: 2 })
    observer.observe({ serverName: '', phase: 'connected', attempt: 0, maxAttempts: 3, toolCount: 2 })
    expect(observer.statusOf('x')).toBeUndefined()
  })

  it('counts each reconnect attempt once', () => {
    const observer = new McpStatusObserver()
    const base = { serverName: 's', maxAttempts: 3, toolCount: 1 }
    observer.observe({ ...base, phase: 'connecting', attempt: 1 })
    observer.observe({ ...base, phase: 'connecting', attempt: 1 }) // re-observed (event + seed)
    observer.observe({ ...base, phase: 'connecting', attempt: 2 })
    expect(observer.reconnectCountOf('s')).toBe(2)
    observer.observe({ ...base, phase: 'connected', attempt: 0 })
    observer.observe({ ...base, phase: 'connecting', attempt: 1 })
    expect(observer.reconnectCountOf('s')).toBe(3)
  })

  it('reports -1 for never-observed servers', () => {
    expect(new McpStatusObserver().reconnectCountOf('nope')).toBe(-1)
  })
})

describe('buildMcpSnapshot', () => {
  const rows: McpLoaderRow[] = [
    {
      entryId: 'mcp-iqs-search',
      disabled: false,
      fiberPhase: 'active',
      config: {
        serverName: 'iqs-search',
        transport: 'streamable-http',
        url: 'https://example.com/mcp?token=sekret',
        headers: { 'X-API-Key': 'never-shown' },
      },
    },
    {
      entryId: 'mcp-local',
      disabled: true,
      fiberPhase: null,
      config: { serverName: 'local', transport: 'stdio', command: 'uvx', args: ['srv'], env: { API_KEY: 'x' } },
    },
  ]
  const schemas = [
    { name: 'mcp__iqs-search__common_search', description: 'search' },
    { name: 'mcp__local__do_thing' },
  ]

  it('assembles the sanitized per-server view', () => {
    const snapshot = buildMcpSnapshot(rows, schemas, new McpStatusObserver())
    expect(snapshot.servers).toHaveLength(2)
    const search = snapshot.servers[0]!
    expect(search.serverName).toBe('iqs-search')
    expect(search.target).toContain('token=***')
    expect(search.target).not.toContain('sekret')
    expect(search.headerKeys).toEqual(['X-API-Key'])
    expect(search.toolCount).toBe(1)
    expect(search.phase).toBe('unknown')
    expect(search.statusSource).toBe('derived')
    const local = snapshot.servers[1]!
    expect(local.enabled).toBe(false)
    expect(local.envKeys).toEqual(['API_KEY'])
    expect(JSON.stringify(snapshot)).not.toContain('never-shown')
  })

  it('projects observed upstream status', () => {
    const observer = new McpStatusObserver()
    observer.observe({ serverName: 'iqs-search', phase: 'connected', attempt: 0, maxAttempts: 3, toolCount: 1, connectedAt: 1234 })
    const snapshot = buildMcpSnapshot(rows, schemas, observer)
    const search = snapshot.servers[0]!
    expect(search.phase).toBe('connected')
    expect(search.connectedAt).toBe(1234)
    expect(search.statusSource).toBe('upstream-event')
    expect(search.observedAt).not.toBeNull()
  })
})
