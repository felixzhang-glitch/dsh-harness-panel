import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  emptyPanelState,
  parsePanelState,
  serializePanelState,
  loadPanelStateFile,
  resolvePanelStatePath,
  savePanelStateFile,
  type DisabledSkillRecord,
  type PanelState,
} from '../src/panel-state.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-harness-panel-state-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function record(name: string, extra: Partial<DisabledSkillRecord> = {}): DisabledSkillRecord {
  return {
    name,
    description: `desc ${name}`,
    path: `/skills/${name}/SKILL.md`,
    modelInvocable: true,
    disabledAt: 1,
    original: { userInvocable: 'user-invocable: true' },
    ...extra,
  }
}

describe('resolvePanelStatePath', () => {
  it('uses the DSH home by default', () => {
    expect(resolvePanelStatePath('/tmp/dsh-home')).toBe('/tmp/dsh-home/harness-panel/state.json')
  })
})

describe('parsePanelState', () => {
  it('parses valid records and skips malformed ones', () => {
    const state = parsePanelState({
      version: 3,
      disabledSkills: [
        record('zeta'),
        { name: 'Bad_Name' },
        null,
        // A record without restore information cannot be undone.
        { name: 'stale', description: 's', path: '/s/SKILL.md', modelInvocable: true, disabledAt: 2 },
        record('alpha'),
      ],
    })
    expect([...state.disabledSkills.keys()]).toEqual(['zeta', 'alpha'])
    expect(state.version).toBe(3)
  })

  it('drops version 1 gate records: their skills were never disabled', () => {
    const state = parsePanelState({
      version: 1,
      disabledSkills: [
        { name: 'ghost', description: 'g', path: '/g/SKILL.md', modelInvocable: true, disabledAt: 3 },
      ],
    })
    expect(state.disabledSkills.size).toBe(0)
  })

  it('returns an empty state for malformed documents', () => {
    expect(parsePanelState(null).disabledSkills.size).toBe(0)
    expect(parsePanelState([]).disabledSkills.size).toBe(0)
    expect(parsePanelState({ disabledSkills: 'nope' }).disabledSkills.size).toBe(0)
    expect(emptyPanelState().disabledSkills.size).toBe(0)
  })
})

describe('serializePanelState', () => {
  it('sorts records by name and round-trips', () => {
    const state: PanelState = {
      version: 3,
      hookToggles: new Map(), disabledSkills: new Map([
        ['zeta', record('zeta')],
        ['alpha', record('alpha')],
      ]),
    }
    const text = serializePanelState(state)
    expect(text.endsWith('\n')).toBe(true)
    expect(text.indexOf('"alpha"')).toBeLessThan(text.indexOf('"zeta"'))
    const parsed = parsePanelState(JSON.parse(text))
    expect([...parsed.disabledSkills.keys()]).toEqual(['alpha', 'zeta'])
  })
})

describe('hook toggles', () => {
  it('round-trips a toggle with the original type', () => {
    const state = parsePanelState({
      version: 3,
      hookToggles: [
        { bridge: 'hooks-claude-code', configPath: '/h/hooks.json', event: 'UserPromptSubmit', matcher: '*', command: '/x.sh', disabledAt: 2 },
        { bridge: 'b', configPath: '/h.json', event: 'e', matcher: null, command: 'c', originalType: 'command', disabledAt: 1 },
        { bridge: 'bad' },
      ],
    })
    expect(state.hookToggles.size).toBe(2)
    const key = JSON.stringify(['hooks-claude-code', 'UserPromptSubmit', '*', '/x.sh'])
    expect(state.hookToggles.get(key)?.originalType).toBeUndefined()
    const second = [...state.hookToggles.values()].find(r => r.bridge === 'b')
    expect(second?.originalType).toBe('command')
    const text = serializePanelState(state)
    expect(text).toContain('"hookToggles"')
    expect(parsePanelState(JSON.parse(text)).hookToggles.size).toBe(2)
  })
})

describe('state file', () => {
  it('starts empty for a missing file', () => {
    const loaded = loadPanelStateFile(join(dir, 'missing.json'))
    expect(loaded.warning).toBeNull()
    expect(loaded.state.disabledSkills.size).toBe(0)
  })

  it('starts empty and warns for invalid JSON', async () => {
    const path = join(dir, 'state.json')
    await writeFile(path, '{not json', 'utf8')
    const loaded = loadPanelStateFile(path)
    expect(loaded.state.disabledSkills.size).toBe(0)
    expect(loaded.warning).toContain('could not parse')
  })

  it('round-trips the state with private permissions', async () => {
    const path = join(dir, 'state.json')
    const state: PanelState = {
      version: 3,
      hookToggles: new Map(), disabledSkills: new Map([['alpha', record('alpha')]]),
    }
    await savePanelStateFile(path, state)
    const loaded = loadPanelStateFile(path)
    expect(loaded.warning).toBeNull()
    expect([...loaded.state.disabledSkills.keys()]).toEqual(['alpha'])
    const text = await readFile(path, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text).toContain('"original"')
  })
})
