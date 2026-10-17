import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DISABLE_MODEL_KEY,
  USER_INVOCABLE_KEY,
  disableSkillFile,
  enableSkillFile,
  parseSkillToggleRequest,
} from '../src/skill-file.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-harness-panel-file-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

const PLAIN = `---
name: alpha
description: Alpha skill
---
Body line one.
Body line two.
`

const WITH_KEYS = `---
name: beta
description: Beta skill
user-invocable: true
disable-model-invocation: false
whenToUse: beta work
---
Body.
`

async function skillFile(name: string, text: string): Promise<string> {
  const path = join(dir, `${name}.md`)
  await writeFile(path, text, 'utf8')
  return path
}

describe('disableSkillFile', () => {
  it('appends both keys when absent and preserves the body', async () => {
    const path = await skillFile('alpha', PLAIN)
    const edit = await disableSkillFile(path, 'alpha')
    expect(edit.name).toBe('alpha')
    expect(edit.original).toEqual({})
    const text = await readFile(path, 'utf8')
    expect(text).toContain(`${USER_INVOCABLE_KEY}: false`)
    expect(text).toContain(`${DISABLE_MODEL_KEY}: true`)
    expect(text).toContain('Body line one.\nBody line two.')
    expect(text.startsWith('---\nname: alpha')).toBe(true)
  })

  it('replaces existing keys in place and records the original lines', async () => {
    const path = await skillFile('beta', WITH_KEYS)
    const edit = await disableSkillFile(path, 'beta')
    expect(edit.original.userInvocable).toBe('user-invocable: true')
    expect(edit.original.disableModelInvocation).toBe('disable-model-invocation: false')
    const text = await readFile(path, 'utf8')
    const lines = text.split('\n')
    const userIndex = lines.findIndex(line => line.startsWith('user-invocable:'))
    const disableIndex = lines.findIndex(line => line.startsWith('disable-model-invocation:'))
    expect(lines[userIndex]).toBe('user-invocable: false')
    expect(lines[disableIndex]).toBe('disable-model-invocation: true')
    // Surrounding frontmatter keeps its place.
    expect(lines[userIndex! - 1]).toBe('description: Beta skill')
    expect(lines[disableIndex! + 1]).toBe('whenToUse: beta work')
  })

  it('preserves indentation of a replaced key line', async () => {
    const text = `---\nname: ind\ndescription: d\n  ${USER_INVOCABLE_KEY}: true\n---\nBody\n`
    const path = await skillFile('ind', text)
    await disableSkillFile(path, 'ind')
    const body = await readFile(path, 'utf8')
    expect(body).toContain(`  ${USER_INVOCABLE_KEY}: false`)
  })

  it('rejects a name mismatch and a missing frontmatter block', async () => {
    const path = await skillFile('alpha', PLAIN)
    await expect(disableSkillFile(path, 'other')).rejects.toMatchObject({ status: 400 })
    const bare = await skillFile('bare', 'no frontmatter here\n')
    await expect(disableSkillFile(bare, 'bare')).rejects.toMatchObject({ status: 400 })
  })

  it('reports an unreadable file as a 500', async () => {
    await expect(disableSkillFile(join(dir, 'missing.md'), 'missing')).rejects.toMatchObject({ status: 500 })
  })
})

describe('enableSkillFile', () => {
  it('round-trips a disable with no original keys', async () => {
    const path = await skillFile('alpha', PLAIN)
    const edit = await disableSkillFile(path, 'alpha')
    await enableSkillFile(path, 'alpha', edit.original)
    expect(await readFile(path, 'utf8')).toBe(PLAIN)
  })

  it('round-trips a disable with existing keys', async () => {
    const path = await skillFile('beta', WITH_KEYS)
    const edit = await disableSkillFile(path, 'beta')
    await enableSkillFile(path, 'beta', edit.original)
    expect(await readFile(path, 'utf8')).toBe(WITH_KEYS)
  })

  it('removes a key the file gained while disabled', async () => {
    const path = await skillFile('alpha', PLAIN)
    const edit = await disableSkillFile(path, 'alpha')
    // The user re-edits the file and declares the key themselves.
    await writeFile(path, (await readFile(path, 'utf8')).replace(`${USER_INVOCABLE_KEY}: false`, `${USER_INVOCABLE_KEY}: true`), 'utf8')
    await enableSkillFile(path, 'alpha', edit.original)
    expect(await readFile(path, 'utf8')).toBe(PLAIN)
  })

  it('treats a deleted file as nothing to restore', async () => {
    const path = await skillFile('alpha', PLAIN)
    const edit = await disableSkillFile(path, 'alpha')
    await rm(path)
    await expect(enableSkillFile(path, 'alpha', edit.original)).resolves.toBeUndefined()
  })

  it('rejects a name mismatch', async () => {
    const path = await skillFile('alpha', PLAIN)
    const edit = await disableSkillFile(path, 'alpha')
    await expect(enableSkillFile(path, 'other', edit.original)).rejects.toMatchObject({ status: 400 })
  })
})

describe('parseSkillToggleRequest', () => {
  it('parses an enable request without metadata', () => {
    expect(parseSkillToggleRequest({ name: 'foo-bar', enabled: true })).toEqual({ name: 'foo-bar', enabled: true })
  })

  it('requires a path ending in .md for a disable', () => {
    expect(parseSkillToggleRequest({ name: 'foo-bar', enabled: false, path: '/skills/foo/SKILL.md', description: 'Foo' }))
      .toMatchObject({ name: 'foo-bar', enabled: false, disable: { path: '/skills/foo/SKILL.md', description: 'Foo' } })
    expect(parseSkillToggleRequest({ name: 'foo-bar', enabled: false })).toBeUndefined()
    expect(parseSkillToggleRequest({ name: 'foo-bar', enabled: false, path: '/etc/passwd' })).toBeUndefined()
  })

  it('rejects malformed requests', () => {
    expect(parseSkillToggleRequest(null)).toBeUndefined()
    expect(parseSkillToggleRequest({ name: 'foo', enabled: 'yes' })).toBeUndefined()
    expect(parseSkillToggleRequest({ name: 'Bad_Name', enabled: true })).toBeUndefined()
  })
})
