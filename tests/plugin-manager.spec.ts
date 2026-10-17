import { describe, expect, it, vi } from 'vitest'
import {
  HOOKS_CLAUDE_CODE_MODULE,
  HOOKS_CODEX_MODULE,
  MCP_CLIENT_MODULE,
  findPluginInfo,
  moduleNameForDialect,
  togglePluginRow,
  type ChangeResultFace,
  type PluginInfoFace,
  type PluginManagerRemoteFace,
  type RemoteResultFace,
} from '../src/client/plugin-manager.ts'

function row(overrides: Partial<PluginInfoFace> = {}): PluginInfoFace {
  return {
    entryId: 'include:profile:mcp-iqs-search',
    patchId: 'mcp-iqs-search',
    moduleName: MCP_CLIENT_MODULE,
    enabled: true,
    fiberPhase: 'active',
    ...overrides,
  }
}

function fakeManager(
  result: RemoteResultFace<ChangeResultFace> | Error,
): PluginManagerRemoteFace {
  return {
    listPlugins: vi.fn(async () => ({ ok: true as const, value: [] })),
    setPluginEnabled: vi.fn(async () => {
      if (result instanceof Error) throw result
      return result
    }),
  }
}

function change(application: ChangeResultFace['application'], error?: ChangeResultFace['error']): ChangeResultFace {
  return { changed: true, application, ...(error === undefined ? {} : { error }) }
}

describe('moduleNameForDialect', () => {
  it('maps both bridge dialects', () => {
    expect(moduleNameForDialect('claude-code')).toBe(HOOKS_CLAUDE_CODE_MODULE)
    expect(moduleNameForDialect('codex')).toBe(HOOKS_CODEX_MODULE)
  })
})

describe('findPluginInfo', () => {
  it('matches the short patch id exactly', () => {
    const info = row()
    expect(findPluginInfo([info], 'mcp-iqs-search', MCP_CLIENT_MODULE)).toBe(info)
  })

  it('falls back to an entry-id suffix for a read-only row', () => {
    const info: PluginInfoFace = {
      entryId: 'include:profile:mcp-iqs-search',
      moduleName: MCP_CLIENT_MODULE,
      enabled: true,
      fiberPhase: 'active',
      readOnlyReason: 'unaddressable',
    }
    expect(findPluginInfo([info], 'mcp-iqs-search', MCP_CLIENT_MODULE)).toBe(info)
  })

  it('requires the expected module', () => {
    expect(findPluginInfo([row({ moduleName: '@deepseek-ai/other' })], 'mcp-iqs-search', MCP_CLIENT_MODULE))
      .toBeUndefined()
  })

  it('rejects ambiguous matches', () => {
    const first = row()
    const second = row({ entryId: 'include:other:mcp-iqs-search' })
    expect(findPluginInfo([first, second], 'mcp-iqs-search', MCP_CLIENT_MODULE)).toBeUndefined()
  })

  it('rejects an empty id', () => {
    expect(findPluginInfo([row()], '', MCP_CLIENT_MODULE)).toBeUndefined()
  })
})

describe('togglePluginRow', () => {
  const info = row()

  it('maps applied', async () => {
    await expect(togglePluginRow(fakeManager({ ok: true, value: change('applied') }), info, false))
      .resolves.toEqual({ kind: 'applied' })
  })

  it('maps restart-required and overridden', async () => {
    await expect(togglePluginRow(fakeManager({ ok: true, value: change('restart-required') }), info, false))
      .resolves.toEqual({ kind: 'restart-required' })
    await expect(togglePluginRow(fakeManager({ ok: true, value: change('overridden') }), info, false))
      .resolves.toEqual({ kind: 'overridden' })
  })

  it('maps a host refusal and a failed application', async () => {
    await expect(togglePluginRow(fakeManager({
      ok: false,
      error: { code: 'readOnly', message: 'not writable' },
    }), info, false)).resolves.toEqual({ kind: 'failed', message: 'not writable' })
    await expect(togglePluginRow(fakeManager({
      ok: true,
      value: change('failed', { code: 'bad', diagnostic: 'broken row' }),
    }), info, false)).resolves.toEqual({ kind: 'failed', message: 'broken row' })
  })

  it('maps transport throws and cancellations', async () => {
    await expect(togglePluginRow(fakeManager(new Error('offline')), info, false))
      .resolves.toEqual({ kind: 'failed', message: 'offline' })
    await expect(togglePluginRow(fakeManager({ ok: true, value: change('cancelled') }), info, false))
      .resolves.toEqual({ kind: 'failed', message: 'cancelled' })
  })

  it('passes the full entry id and the desired state', async () => {
    const pm = fakeManager({ ok: true, value: change('applied') })
    await togglePluginRow(pm, info, false)
    expect(pm.setPluginEnabled).toHaveBeenCalledWith('include:profile:mcp-iqs-search', false)
  })
})
