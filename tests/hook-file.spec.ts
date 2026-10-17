import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  HOOK_DISABLED_TYPE,
  disableHookFile,
  enableHookFile,
  parseHookToggleRequest,
  type HookToggleRequest,
} from '../src/hook-file.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-harness-panel-hook-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const SETTINGS = `{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "/Users/yunhao/.dsh/hooks/inject-time.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "command": "/Users/yunhao/.dsh/hooks/git-push-guard.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
`

async function config(name: string, text = SETTINGS): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, text, 'utf8')
  return path
}

function toggle(event: string, matcher: string | null, command: string, enabled = false): HookToggleRequest {
  return { bridge: 'hooks-claude-code', event, matcher, command, enabled }
}

describe('disableHookFile', () => {
  it('sets the sentinel type on the named hook only', async () => {
    const path = await config('hooks.json')
    const edit = await disableHookFile(path, toggle('PreToolUse', 'Bash', '/Users/yunhao/.dsh/hooks/git-push-guard.sh'))
    expect(edit.originalType).toBeUndefined()
    const text = await readFile(path, 'utf8')
    const parsed = JSON.parse(text) as { hooks: Record<string, Array<{ matcher: string; hooks: Array<Record<string, unknown>> }>> }
    const pre = parsed.hooks['PreToolUse']![0]!.hooks[0]!
    expect(pre['type']).toBe(HOOK_DISABLED_TYPE)
    expect(pre['command']).toBe('/Users/yunhao/.dsh/hooks/git-push-guard.sh')
    expect(pre['timeout']).toBe(10)
    // The other event's hook keeps its explicit command type.
    const user = parsed.hooks['UserPromptSubmit']![0]!.hooks[0]!
    expect(user['type']).toBe('command')
    expect(text.endsWith('\n')).toBe(true)
  })

  it('records the original type of an explicitly typed hook', async () => {
    const path = await config('typed.json', `{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "notify-send done" } ] }
    ]
  }
}
`)
    const edit = await disableHookFile(path, toggle('Stop', null, 'notify-send done'))
    expect(edit.originalType).toBe('command')
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> }
    expect(parsed.hooks['Stop']![0]!.hooks[0]!['type']).toBe(HOOK_DISABLED_TYPE)
  })

  it('is idempotent when the hook is already disabled', async () => {
    const path = await config('hooks.json')
    await disableHookFile(path, toggle('PreToolUse', 'Bash', '/Users/yunhao/.dsh/hooks/git-push-guard.sh'))
    const before = await readFile(path, 'utf8')
    await disableHookFile(path, toggle('PreToolUse', 'Bash', '/Users/yunhao/.dsh/hooks/git-push-guard.sh'))
    expect(await readFile(path, 'utf8')).toBe(before)
  })

  it('refuses an unknown hook with 400', async () => {
    const path = await config('hooks.json')
    await expect(disableHookFile(path, toggle('PreToolUse', 'Bash', 'nope.sh'))).rejects.toMatchObject({ status: 400 })
    await expect(disableHookFile(path, toggle('NoEvent', null, 'x.sh'))).rejects.toMatchObject({ status: 400 })
  })
})

describe('enableHookFile', () => {
  it('restores a hook that had no type field', async () => {
    const path = await config('hooks.json')
    await disableHookFile(path, toggle('PreToolUse', 'Bash', '/Users/yunhao/.dsh/hooks/git-push-guard.sh'))
    await enableHookFile(path, toggle('PreToolUse', 'Bash', '/Users/yunhao/.dsh/hooks/git-push-guard.sh', true), undefined)
    expect(await readFile(path, 'utf8')).toBe(SETTINGS)
  })

  it('restores an explicit original type', async () => {
    const path = await config('typed.json', `{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "notify-send done" } ] }
    ]
  }
}
`)
    const edit = await disableHookFile(path, toggle('Stop', null, 'notify-send done'))
    await enableHookFile(path, toggle('Stop', null, 'notify-send done', true), edit.originalType)
    const parsed = JSON.parse(await readFile(path, 'utf8')) as { hooks: Record<string, Array<{ hooks: Array<Record<string, unknown>> }>> }
    expect(parsed.hooks['Stop']![0]!.hooks[0]!['type']).toBe('command')
  })

  it('treats a deleted file as nothing to restore', async () => {
    const path = await config('hooks.json')
    await disableHookFile(path, toggle('PreToolUse', 'Bash', '/Users/yunhao/.dsh/hooks/git-push-guard.sh'))
    await rm(path)
    await expect(enableHookFile(path, toggle('PreToolUse', 'Bash', '/Users/yunhao/.dsh/hooks/git-push-guard.sh', true), undefined))
      .resolves.toBeUndefined()
  })
})

describe('parseHookToggleRequest', () => {
  it('parses a full request', () => {
    expect(parseHookToggleRequest({ bridge: 'hooks-claude-code', event: 'PreToolUse', matcher: 'Bash', command: '/x.sh', enabled: false }))
      .toEqual({ bridge: 'hooks-claude-code', event: 'PreToolUse', matcher: 'Bash', command: '/x.sh', enabled: false })
    expect(parseHookToggleRequest({ bridge: 'b', event: 'Stop', matcher: null, command: 'c', enabled: true }))
      .toEqual({ bridge: 'b', event: 'Stop', matcher: null, command: 'c', enabled: true })
  })

  it('rejects malformed requests', () => {
    expect(parseHookToggleRequest(null)).toBeUndefined()
    expect(parseHookToggleRequest({ bridge: '', event: 'e', matcher: null, command: 'c', enabled: true })).toBeUndefined()
    expect(parseHookToggleRequest({ bridge: 'b', event: 'e', matcher: 5, command: 'c', enabled: true })).toBeUndefined()
    expect(parseHookToggleRequest({ bridge: 'b', event: 'e', matcher: null, command: 'c', enabled: 'yes' })).toBeUndefined()
  })
})
