import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  bridgeViewOf,
  dialectOf,
  parseHookFile,
  readHookFile,
  scanHookPath,
} from '../src/hooks.ts'

describe('parseHookFile', () => {
  it('parses a settings-shaped file (hooks key)', () => {
    const parsed = parseHookFile({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi', timeout: 30 }] },
        ],
      },
    })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]!.event).toBe('PreToolUse')
    expect(parsed.events[0]!.groups[0]!.matcher).toBe('Bash')
    expect(parsed.events[0]!.groups[0]!.hooks[0]).toEqual({ command: 'echo hi', timeoutSec: 30, disabled: false })
  })

  it('parses a bare event map', () => {
    const parsed = parseHookFile({
      Stop: [{ hooks: [{ command: 'notify-send done' }] }],
    })
    expect(parsed.events[0]!.event).toBe('Stop')
    expect(parsed.events[0]!.groups[0]!.matcher).toBeNull()
    expect(parsed.events[0]!.groups[0]!.hooks[0]!.timeoutSec).toBeNull()
  })

  it('keeps the panel-disabled sentinel as a turned-off command', () => {
    const parsed = parseHookFile({
      PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'disabled', command: '/x.sh' }] }],
    })
    expect(parsed.skipped).toEqual([])
    expect(parsed.events[0]!.groups[0]!.hooks[0]).toEqual({ command: '/x.sh', timeoutSec: null, disabled: true })
  })

  it('collects non-command hooks as skipped', () => {
    const parsed = parseHookFile({
      SessionStart: [{ hooks: [{ type: 'prompt', command: 'ignored' }, { command: 'echo ok' }] }],
    })
    expect(parsed.skipped).toEqual([{ event: 'SessionStart', type: 'prompt' }])
    expect(parsed.events[0]!.groups[0]!.hooks).toHaveLength(1)
  })

  it('normalizes match-all matchers to null', () => {
    const parsed = parseHookFile({
      PreToolUse: [{ matcher: '*', hooks: [{ command: 'x' }] }],
    })
    expect(parsed.events[0]!.groups[0]!.matcher).toBeNull()
  })

  it('ignores malformed groups instead of failing', () => {
    const parsed = parseHookFile({
      PreToolUse: [null, { nohooks: true }, { hooks: [{ command: 'ok' }] }],
      Empty: [],
      NotAnArray: 'nope',
    })
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]!.event).toBe('PreToolUse')
  })

  it('returns empty on garbage', () => {
    expect(parseHookFile(null).events).toEqual([])
    expect(parseHookFile('[]').events).toEqual([])
    expect(parseHookFile([]).events).toEqual([])
  })
})

describe('dialectOf', () => {
  it('maps the two bridge modules', () => {
    expect(dialectOf('@deepseek-ai/dsh-hooks-claude-code')).toBe('claude-code')
    expect(dialectOf('@deepseek-ai/dsh-hooks-codex')).toBe('codex')
    expect(dialectOf('@deepseek-ai/dsh-mcp-client')).toBeUndefined()
  })
})

describe('file reading', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-harness-panel-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('bridgeViewOf reads and parses the row configPath', async () => {
    const file = join(dir, 'hooks.json')
    await writeFile(file, JSON.stringify({ PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'echo hi' }] }] }))
    const view = await bridgeViewOf({
      entryId: 'hooks-cc',
      moduleName: '@deepseek-ai/dsh-hooks-claude-code',
      disabled: false,
      config: { configPath: file },
    })
    expect(view?.dialect).toBe('claude-code')
    expect(view?.parseError).toBeNull()
    expect(view?.events[0]?.event).toBe('PreToolUse')
  })

  it('bridgeViewOf surfaces a missing file as parseError, not a throw', async () => {
    const view = await bridgeViewOf({
      entryId: 'hooks-cc',
      moduleName: '@deepseek-ai/dsh-hooks-claude-code',
      disabled: false,
      config: { configPath: join(dir, 'missing.json') },
    })
    expect(view?.parseError).not.toBeNull()
    expect(view?.events).toEqual([])
  })

  it('bridgeViewOf flags a row without configPath', async () => {
    const view = await bridgeViewOf({
      entryId: 'hooks-cc',
      moduleName: '@deepseek-ai/dsh-hooks-claude-code',
      disabled: false,
      config: {},
    })
    expect(view?.parseError).toBe('row has no configPath')
  })

  it('readHookFile reports malformed JSON', async () => {
    const file = join(dir, 'bad.json')
    await writeFile(file, '{not json')
    const { parseError } = await readHookFile(file)
    expect(parseError).not.toBeNull()
  })

  it('scanHookPath reads exists + counts', async () => {
    const missing = await scanHookPath(join(dir, 'missing.json'))
    expect(missing.exists).toBe(false)

    const file = join(dir, 'settings.json')
    await writeFile(file, JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'a' }, { command: 'b' }] }],
        Stop: [{ hooks: [{ command: 'c' }] }],
      },
    }))
    const found = await scanHookPath(file)
    expect(found.exists).toBe(true)
    expect(found.eventCount).toBe(2)
    expect(found.hookCount).toBe(3)
  })
})
