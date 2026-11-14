import { describe, expect, it } from 'vitest'
import type { McpServerView } from '../src/mcp.ts'
import type { HookBridgeView } from '../src/hooks.ts'
import type { AgentsSnapshot } from '../src/agents-contract.ts'
import {
  buildOverview,
  type OverviewInput,
  type OverviewSkillsInput,
  type Settled,
} from '../src/client/overview-model.ts'

/** One MCP server view with overridable facts. */
function server(overrides: Partial<McpServerView> = {}): McpServerView {
  return {
    serverName: 'srv',
    entryId: 'mcp-srv',
    transport: 'stdio',
    target: 'cmd',
    enabled: true,
    available: true,
    fiberPhase: 'active',
    configuredNote: null,
    toolCount: 2,
    tools: [],
    phase: 'connected',
    attempt: 0,
    maxAttempts: -1,
    delayMs: null,
    reconnectCount: 0,
    lastError: null,
    connectedAt: null,
    observedAt: null,
    statusSource: 'upstream-event',
    envKeys: [],
    headerKeys: [],
    ...overrides,
  }
}

/** One mounted hook bridge with overridable facts. */
function bridge(overrides: Partial<HookBridgeView> = {}): HookBridgeView {
  return {
    entryId: 'hooks-claude',
    dialect: 'claude-code',
    configPath: '/tmp/hooks.json',
    disabled: false,
    events: [
      {
        event: 'PreToolUse',
        groups: [
          { matcher: null, hooks: [{ command: 'echo a', timeoutSec: null, disabled: false }] },
        ],
      },
    ],
    skipped: [],
    parseError: null,
    ...overrides,
  }
}

/** One AGENTS.md snapshot with overridable facts. */
function agents(overrides: Partial<AgentsSnapshot> = {}): AgentsSnapshot {
  return {
    cwd: '/tmp/project',
    cwdSource: 'session',
    projectRoot: '/tmp/project',
    sessionId: 's1',
    presetId: null,
    row: null,
    enabled: true,
    reason: 'ok',
    groups: [],
    budget: {
      maxBytes: 32768,
      maxSourceBytes: 16384,
      renderedBytes: 1024,
      loadedFileCount: 1,
      omitted: [],
      truncated: [],
    },
    preview: null,
    warnings: [],
    collectedAt: 0,
    ...overrides,
  }
}

/** One instruction file view inside a group. */
function fileView(status: string, displayPath: string) {
  return {
    path: `/tmp/project/${displayPath}`,
    realPath: null,
    displayPath,
    scope: 'project' as const,
    directory: '/tmp/project',
    displayDirectory: '.',
    name: displayPath,
    exists: true,
    symlink: false,
    sizeBytes: 100,
    mtimeMs: 0,
    status: status as AgentsSnapshot['groups'][number]['files'][number]['status'],
    includedBytes: null,
    duplicateOf: null,
    error: null,
  }
}

const skillsOk: OverviewSkillsInput = {
  session: 'ok',
  enabled: [
    { name: 'alpha', description: 'a', modelInvocable: true },
    { name: 'beta', description: 'b', modelInvocable: false },
  ],
  disabled: [{ name: 'gamma', description: 'g', modelInvocable: true, disabledAt: 0 }],
}

function input(overrides: Partial<OverviewInput> = {}): OverviewInput {
  return {
    mcp: { status: 'ready', value: { servers: [server()], collectedAt: 0 } },
    hooks: { status: 'ready', value: { mounted: [bridge()], discovered: [], collectedAt: 0 } },
    skills: { status: 'ready', value: skillsOk },
    agents: { status: 'ready', value: agents() },
    ...overrides,
  }
}

describe('buildOverview settle states', () => {
  it('keeps every card loading before any source settles', () => {
    const loading: Settled<never> = { status: 'loading' }
    const model = buildOverview({ mcp: loading, hooks: loading, skills: loading, agents: loading })
    expect(model.allReady).toBe(false)
    expect(model.attention).toBe(0)
    for (const card of model.cards) {
      expect(card.status).toBe('loading')
      expect(card.tone).toBe('muted')
      expect(card.issues).toEqual([])
    }
  })

  it('isolates one failing source to its own card', () => {
    const model = buildOverview(input({ mcp: { status: 'error', message: 'boom' } }))
    const [mcp, skills, hooks, agentsCard] = model.cards
    expect(mcp.status).toBe('error')
    expect(mcp.message).toBe('boom')
    expect(mcp.tone).toBe('error')
    expect(skills.status).toBe('ready')
    expect(hooks.status).toBe('ready')
    expect(agentsCard.status).toBe('ready')
    expect(model.allReady).toBe(false)
    // A settle error is a card state, not an attention row.
    expect(model.attention).toBe(0)
  })
})

describe('buildOverview MCP card', () => {
  it('counts availability and tools across servers', () => {
    const model = buildOverview(input({
      mcp: {
        status: 'ready',
        value: {
          servers: [
            server({ serverName: 'ok', entryId: 'a' }),
            server({ serverName: 'off', entryId: 'b', enabled: false, available: false, phase: 'disposed', toolCount: 0 }),
          ],
          collectedAt: 0,
        },
      },
    }))
    const card = model.cards[0]
    expect(card.total).toBe(2)
    expect(card.enabled).toBe(1)
    expect(card.available).toBe(1)
    expect(card.tools).toBe(2)
    expect(card.tone).toBe('ok')
    expect(card.issues).toEqual([])
  })

  it('flags failed, unavailable, and connecting servers with severity order', () => {
    const model = buildOverview(input({
      mcp: {
        status: 'ready',
        value: {
          servers: [
            server({ serverName: 'connecting', entryId: 'c', available: false, phase: 'connecting' }),
            server({ serverName: 'failed', entryId: 'f', fiberPhase: 'failed', available: false }),
            server({ serverName: 'down', entryId: 'd', available: false, phase: 'exhausted' }),
          ],
          collectedAt: 0,
        },
      },
    }))
    const card = model.cards[0]
    expect(card.tone).toBe('error')
    expect(card.issues.map(issue => issue.kind)).toEqual(['mcp-failed', 'mcp-unavailable', 'mcp-connecting'])
    expect(card.issues.map(issue => issue.name)).toEqual(['failed', 'down', 'connecting'])
    expect(model.attention).toBe(3)
  })

  it('dims an empty or fully disabled fleet', () => {
    const empty = buildOverview(input({ mcp: { status: 'ready', value: { servers: [], collectedAt: 0 } } }))
    expect(empty.cards[0].tone).toBe('muted')
    const disabled = buildOverview(input({
      mcp: { status: 'ready', value: { servers: [server({ enabled: false, available: false })], collectedAt: 0 } },
    }))
    expect(disabled.cards[0].tone).toBe('muted')
    expect(disabled.cards[0].issues).toEqual([])
  })
})

describe('buildOverview skills card', () => {
  it('merges enabled and disabled rows and lists disabled as info', () => {
    const model = buildOverview(input())
    const card = model.cards[1]
    expect(card.total).toBe(3)
    expect(card.enabled).toBe(2)
    expect(card.disabled).toBe(1)
    expect(card.tone).toBe('ok')
    expect(card.issues).toEqual([
      { key: 'skill-disabled:gamma', kind: 'skill-disabled', severity: 'info', name: 'gamma' },
    ])
    // Intentional disables never raise the attention count.
    expect(model.attention).toBe(0)
  })

  it('dims without a session and keeps the disabled records visible', () => {
    const model = buildOverview(input({
      skills: { status: 'ready', value: { session: 'no-session', enabled: [], disabled: skillsOk.disabled } },
    }))
    const card = model.cards[1]
    expect(card.session).toBe('no-session')
    expect(card.tone).toBe('muted')
    expect(card.total).toBe(1)
    expect(card.disabled).toBe(1)
  })
})

describe('buildOverview hooks card', () => {
  it('counts active hooks only in active bridges', () => {
    const model = buildOverview(input({
      hooks: {
        status: 'ready',
        value: {
          mounted: [
            bridge(),
            bridge({
              entryId: 'hooks-off',
              disabled: true,
              events: [{ event: 'Stop', groups: [{ matcher: null, hooks: [{ command: 'echo b', timeoutSec: null, disabled: false }] }] }],
            }),
          ],
          discovered: [],
          collectedAt: 0,
        },
      },
    }))
    const card = model.cards[2]
    expect(card.bridges).toBe(2)
    expect(card.totalHooks).toBe(2)
    expect(card.activeHooks).toBe(1)
    expect(card.tone).toBe('warn')
    expect(card.issues).toEqual([
      { key: 'hook-inactive:hooks-off', kind: 'hook-inactive', severity: 'warn', name: 'hooks-off' },
    ])
  })

  it('raises parse errors above inactive warnings', () => {
    const model = buildOverview(input({
      hooks: {
        status: 'ready',
        value: {
          mounted: [
            bridge({ entryId: 'inactive', disabled: true }),
            bridge({ entryId: 'broken', parseError: 'bad json' }),
          ],
          discovered: [],
          collectedAt: 0,
        },
      },
    }))
    const card = model.cards[2]
    expect(card.tone).toBe('error')
    expect(card.issues.map(issue => issue.kind)).toEqual(['hook-parse-error', 'hook-inactive'])
    expect(model.attention).toBe(2)
  })

  it('counts per-hook disables without raising tone', () => {
    const model = buildOverview(input({
      hooks: {
        status: 'ready',
        value: {
          mounted: [bridge({
            events: [{ event: 'PreToolUse', groups: [{ matcher: null, hooks: [{ command: 'echo a', timeoutSec: null, disabled: true }] }] }],
          })],
          discovered: [],
          collectedAt: 0,
        },
      },
    }))
    const card = model.cards[2]
    expect(card.disabledHooks).toBe(1)
    expect(card.activeHooks).toBe(0)
    expect(card.tone).toBe('ok')
    expect(card.issues).toEqual([])
  })

  it('dims when no bridge is mounted', () => {
    const model = buildOverview(input({ hooks: { status: 'ready', value: { mounted: [], discovered: [], collectedAt: 0 } } }))
    expect(model.cards[2].tone).toBe('muted')
  })
})

describe('buildOverview agents card', () => {
  it('reports budget facts while injecting', () => {
    const model = buildOverview(input())
    const card = model.cards[3]
    expect(card.injecting).toBe(true)
    expect(card.loadedFiles).toBe(1)
    expect(card.renderedBytes).toBe(1024)
    expect(card.maxBytes).toBe(32768)
    expect(card.tone).toBe('ok')
  })

  it('flags a non-injecting loader as an error', () => {
    const model = buildOverview(input({
      agents: { status: 'ready', value: agents({ enabled: false, reason: 'row-disabled' }) },
    }))
    const card = model.cards[3]
    expect(card.injecting).toBe(false)
    expect(card.tone).toBe('error')
    expect(card.issues[0]?.kind).toBe('agents-not-injecting')
  })

  it('collects file dispositions with severity order', () => {
    const model = buildOverview(input({
      agents: {
        status: 'ready',
        value: agents({
          groups: [{
            key: 'g',
            scope: 'project',
            directory: '/tmp/project',
            displayDirectory: '.',
            isProjectRoot: true,
            isCwd: true,
            files: [
              fileView('truncated', 'AGENTS.md'),
              fileView('unreadable', 'CLAUDE.md'),
              fileView('omitted', 'AGENTS.local.md'),
              fileView('loaded', 'fine.md'),
            ],
          }],
        }),
      },
    }))
    const card = model.cards[3]
    expect(card.tone).toBe('error')
    expect(card.issues.map(issue => issue.kind)).toEqual(['agents-unreadable', 'agents-truncated', 'agents-omitted'])
    expect(card.issues.map(issue => issue.name)).toEqual(['CLAUDE.md', 'AGENTS.md', 'AGENTS.local.md'])
    expect(model.attention).toBe(3)
  })
})
