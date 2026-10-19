import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AgentFileError,
  parseAgentWriteRequest,
  readAgentInstructionFile,
  writeAgentInstructionFile,
} from '../src/agent-file.ts'

let dir: string
let path: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-agent-file-'))
  path = join(dir, 'AGENTS.md')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('parseAgentWriteRequest', () => {
  it('accepts a create request', () => {
    expect(parseAgentWriteRequest({
      path,
      content: '# Hello\n',
      expectedMtimeMs: null,
      sessionId: 'session-1',
      cwd: dir,
    })).toEqual({
      path,
      content: '# Hello\n',
      expectedMtimeMs: null,
      sessionId: 'session-1',
      cwd: dir,
    })
  })

  it('accepts a session alias and an update request', () => {
    const parsed = parseAgentWriteRequest({
      path,
      content: 'x',
      expectedMtimeMs: 123,
      session: 'session-2',
    })
    expect(parsed).toMatchObject({ sessionId: 'session-2', expectedMtimeMs: 123 })
    expect(parsed?.cwd).toBeUndefined()
  })

  it('rejects malformed requests', () => {
    expect(parseAgentWriteRequest(null)).toBeUndefined()
    expect(parseAgentWriteRequest({ path: 'relative.md', content: '', expectedMtimeMs: null })).toBeUndefined()
    expect(parseAgentWriteRequest({ path, content: 1, expectedMtimeMs: null })).toBeUndefined()
    expect(parseAgentWriteRequest({ path, content: '', expectedMtimeMs: undefined })).toBeUndefined()
    expect(parseAgentWriteRequest({ path, content: '', expectedMtimeMs: -1 })).toBeUndefined()
    expect(parseAgentWriteRequest({ path, content: '', expectedMtimeMs: null, cwd: 'relative' })).toBeUndefined()
    expect(parseAgentWriteRequest({ path, content: '', expectedMtimeMs: null, sessionId: 3 })).toBeUndefined()
  })
})

describe('readAgentInstructionFile', () => {
  it('reads an existing file', async () => {
    await writeFile(path, '# Instructions\n', 'utf8')
    const file = await readAgentInstructionFile(path)
    expect(file.content).toBe('# Instructions\n')
    expect(file.symlink).toBe(false)
    expect(file.sizeBytes).toBe(Buffer.byteLength('# Instructions\n'))
  })

  it('answers 404 for a missing file and a dangling link', async () => {
    await expect(readAgentInstructionFile(path)).rejects.toMatchObject({ status: 404 })
    if (process.platform !== 'win32') {
      await symlink(join(dir, 'missing.md'), path)
      await expect(readAgentInstructionFile(path)).rejects.toMatchObject({ status: 404 })
    }
  })

  it('refuses directories and oversized files', async () => {
    await mkdir(path)
    await expect(readAgentInstructionFile(path)).rejects.toMatchObject({ status: 400 })
    await rm(path, { recursive: true, force: true })

    await writeFile(path, 'x'.repeat(1_048_577), 'utf8')
    await expect(readAgentInstructionFile(path)).rejects.toMatchObject({ status: 413 })
  })
})

describe('writeAgentInstructionFile', () => {
  it('creates a missing file with mode 0644', async () => {
    const result = await writeAgentInstructionFile({
      path,
      content: '# New\n',
      expectedMtimeMs: null,
    })
    expect(result).toMatchObject({ path, created: true, symlink: false })
    expect(await readFile(path, 'utf8')).toBe('# New\n')
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o644)
    }
  })

  it('overwrites at the expected mtime and preserves the mode', async () => {
    await writeFile(path, 'old\n', 'utf8')
    if (process.platform !== 'win32') await chmod(path, 0o640)
    const current = (await stat(path)).mtimeMs
    const result = await writeAgentInstructionFile({
      path,
      content: 'new\n',
      expectedMtimeMs: current,
    })
    expect(result.created).toBe(false)
    expect(await readFile(path, 'utf8')).toBe('new\n')
    if (process.platform !== 'win32') {
      expect((await stat(path)).mode & 0o777).toBe(0o640)
    }
  })

  it('refuses a stale mtime, an unexpected existing file, and an unexpected missing file', async () => {
    await writeFile(path, 'old\n', 'utf8')
    await expect(writeAgentInstructionFile({
      path,
      content: 'new\n',
      expectedMtimeMs: null,
    })).rejects.toMatchObject({ status: 409 })

    const current = (await stat(path)).mtimeMs
    await expect(writeAgentInstructionFile({
      path,
      content: 'new\n',
      expectedMtimeMs: current - 1,
    })).rejects.toMatchObject({ status: 409 })

    await rm(path)
    await expect(writeAgentInstructionFile({
      path,
      content: 'new\n',
      expectedMtimeMs: current,
    })).rejects.toMatchObject({ status: 409 })
  })

  it('writes through a symlink without replacing the link', async () => {
    if (process.platform === 'win32') return
    const target = join(dir, 'real.md')
    await writeFile(target, 'old\n', 'utf8')
    await symlink(target, path)
    const current = (await stat(target)).mtimeMs
    const result = await writeAgentInstructionFile({
      path,
      content: 'new\n',
      expectedMtimeMs: current,
    })
    expect(result.symlink).toBe(true)
    expect(result.realPath).toBe(await realpath(target))
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
    expect(await readFile(target, 'utf8')).toBe('new\n')
  })

  it('refuses a symlink target outside the allowed roots unless a root covers it', async () => {
    if (process.platform === 'win32') return
    const project = join(dir, 'project')
    const outside = join(dir, 'outside')
    await mkdir(project, { recursive: true })
    await mkdir(outside, { recursive: true })
    const target = join(outside, 'AGENTS.md')
    const link = join(project, 'AGENTS.md')
    await writeFile(target, 'outside\n', 'utf8')
    await symlink(target, link)
    const current = (await stat(target)).mtimeMs

    await expect(writeAgentInstructionFile({
      path: link,
      content: 'escaped\n',
      expectedMtimeMs: current,
      allowedRoots: [project],
    })).rejects.toMatchObject({ status: 400 })
    expect(await readFile(target, 'utf8')).toBe('outside\n')

    await writeAgentInstructionFile({
      path: link,
      content: 'allowed\n',
      expectedMtimeMs: current,
      allowedRoots: [project, outside],
    })
    expect(await readFile(target, 'utf8')).toBe('allowed\n')
  })

  it('allows creating a file under an allowed root that does not exist yet', async () => {
    const root = join(dir, 'new-home')
    const target = join(root, 'AGENTS.md')
    await writeAgentInstructionFile({
      path: target,
      content: '# Created\n',
      expectedMtimeMs: null,
      allowedRoots: [root],
    })
    expect(await readFile(target, 'utf8')).toBe('# Created\n')
  })

  it('rejects NUL content, oversized content, and non-file targets', async () => {
    await expect(writeAgentInstructionFile({
      path,
      content: 'a\u0000b',
      expectedMtimeMs: null,
    })).rejects.toBeInstanceOf(AgentFileError)

    await expect(writeAgentInstructionFile({
      path,
      content: 'x'.repeat(1_048_577),
      expectedMtimeMs: null,
    })).rejects.toMatchObject({ status: 413 })

    await mkdir(path)
    await expect(writeAgentInstructionFile({
      path,
      content: 'x',
      expectedMtimeMs: (await stat(path)).mtimeMs,
    })).rejects.toMatchObject({ status: 400 })
  })
})