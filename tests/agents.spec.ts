import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_INSTRUCTIONS_MODULE, AGENT_PRESET_MODULE } from '../src/agents-contract.ts'
import {
  buildAgentsSnapshot,
  parseAgentInstructionsConfig,
  renderInstructionBaseline,
  resolveInstructionRow,
  type AgentInstructionsLoaderEntry,
} from '../src/agents.ts'

interface Fixture {
  readonly dir: string
  readonly dshHome: string
  readonly agentsHome: string
  readonly project: string
  readonly cwd: string
}

const rootEntry: AgentInstructionsLoaderEntry = {
  id: 'agent-instructions',
  options: {
    id: 'agent-instructions',
    name: AGENT_INSTRUCTIONS_MODULE,
    config: { maxBytes: 65536 },
  },
  disabled: false,
}

const presetEntry = (instructionDisabled = false): AgentInstructionsLoaderEntry => ({
  id: 'preset-standard',
  options: {
    id: 'preset-standard',
    name: AGENT_PRESET_MODULE,
    config: {
      id: 'standard',
      plugins: [{
        id: 'agent-instructions',
        name: AGENT_INSTRUCTIONS_MODULE,
        config: { maxBytes: 65536 },
        ...(instructionDisabled ? { disabled: true } : {}),
      }],
    },
  },
  disabled: false,
})

async function setup(): Promise<Fixture> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-agents-')))
  const dshHome = join(dir, 'dsh-home')
  const agentsHome = join(dir, 'agents-home')
  const project = join(dir, 'project')
  const cwd = join(project, 'packages', 'app')
  await mkdir(dshHome, { recursive: true })
  await mkdir(agentsHome, { recursive: true })
  await mkdir(cwd, { recursive: true })
  await mkdir(join(project, '.git'), { recursive: true })
  return { dir, dshHome, agentsHome, project, cwd }
}

function env(fixture: Fixture): NodeJS.ProcessEnv {
  return { ...process.env, DSH_HOME: fixture.dshHome, DSH_AGENTS_HOME: fixture.agentsHome }
}

async function snapshotOf(fixture: Fixture, entries: AgentInstructionsLoaderEntry[], presetId: string | null = 'standard') {
  return buildAgentsSnapshot({
    entries,
    cwd: fixture.cwd,
    fsAvailable: true,
    env: env(fixture),
    services: { presets: presetId === null ? {} : { defaultId: presetId } },
  })
}

let fixture: Fixture

beforeEach(async () => {
  fixture = await setup()
})

afterEach(async () => {
  await rm(fixture.dir, { recursive: true, force: true })
})

describe('instruction config', () => {
  it('fills the loader defaults', () => {
    expect(parseAgentInstructionsConfig({ maxBytes: 4096 })).toEqual({
      maxBytes: 4096,
      maxSourceBytes: 1_048_576,
      projectRootMarkers: ['.git'],
      instructionFileCandidates: ['AGENTS.md', 'CLAUDE.md'],
      localInstructionFileCandidates: ['AGENTS.local.md', 'CLAUDE.local.md'],
    })
  })

  it('requires a finite maxBytes', () => {
    expect(parseAgentInstructionsConfig({})).toBeNull()
    expect(parseAgentInstructionsConfig({ maxBytes: 'large' })).toBeNull()
    expect(parseAgentInstructionsConfig({ maxBytes: Number.NaN })).toBeNull()
    expect(parseAgentInstructionsConfig(undefined)).toBeNull()
  })

  it('drops invalid candidate names and keeps an explicit empty marker list', () => {
    const config = parseAgentInstructionsConfig({
      maxBytes: 10,
      projectRootMarkers: [],
      instructionFileCandidates: ['AGENTS.md', '../escape', 'nested/AGENTS.md', '', '.'],
      localInstructionFileCandidates: ['AGENTS.local.md'],
    })
    expect(config?.projectRootMarkers).toEqual([])
    expect(config?.instructionFileCandidates).toEqual(['AGENTS.md'])
    expect(config?.localInstructionFileCandidates).toEqual(['AGENTS.local.md'])
  })
})

describe('loader row resolution', () => {
  it('prefers the active preset child', () => {
    const resolved = resolveInstructionRow([rootEntry, presetEntry()], 'standard')
    expect(resolved.row).toMatchObject({ source: 'preset', presetId: 'standard', disabled: false })
    expect(resolved.row?.config?.maxBytes).toBe(65536)
  })

  it('falls back to an enabled root row', () => {
    const resolved = resolveInstructionRow([rootEntry, presetEntry()], null)
    expect(resolved.row).toMatchObject({ source: 'root', entryId: 'agent-instructions', disabled: false })
  })

  it('keeps a disabled root row when the active preset has no instruction child', () => {
    const presetWithoutInstructions: AgentInstructionsLoaderEntry = {
      id: 'preset-empty',
      options: {
        id: 'preset-empty',
        name: AGENT_PRESET_MODULE,
        config: { id: 'empty', plugins: [] },
      },
      disabled: false,
    }
    const disabledRoot = { ...rootEntry, disabled: true }
    const resolved = resolveInstructionRow([disabledRoot, presetWithoutInstructions], 'empty')
    expect(resolved.row).toMatchObject({ source: 'root', disabled: true })
    expect(resolved.warnings.join(' ')).toContain('empty')
  })

  it('warns when the active preset is unknown and keeps the root fallback', () => {
    const resolved = resolveInstructionRow([rootEntry], 'missing')
    expect(resolved.row).toMatchObject({ source: 'root' })
    expect(resolved.warnings.join(' ')).toContain('missing')
  })

  it('reports an unreadable row config', () => {
    const broken = {
      ...rootEntry,
      options: { ...rootEntry.options, config: {} },
    }
    const resolved = resolveInstructionRow([broken], null)
    expect(resolved.row?.config).toBeNull()
  })

  it('reports a missing row when nothing mounts the loader', () => {
    expect(resolveInstructionRow([], null)).toMatchObject({ row: null })
  })
})

describe('baseline rendering', () => {
  const file = (path: string, content: string) => ({ absolutePath: path, displayPath: path, content })

  it('keeps every file when the full baseline fits', () => {
    const rendered = renderInstructionBaseline([file('A', 'a'), file('B', 'b')], 4096)
    expect(rendered.omitted).toEqual([])
    expect(rendered.truncated).toEqual([])
    expect(rendered.represented.map(item => item.absolutePath)).toEqual(['A', 'B'])
    expect(rendered.text).toContain('Instructions from: A')
    expect(rendered.text).toContain('Instructions from: B')
  })

  it('omits broader files before touching the most specific one', () => {
    const rendered = renderInstructionBaseline([file('A', 'a'.repeat(400)), file('B', 'b'.repeat(400))], 900)
    expect(rendered.omitted.map(item => item.absolutePath)).toEqual(['A'])
    expect(rendered.represented.map(item => item.absolutePath)).toEqual(['B'])
    expect(Buffer.byteLength(rendered.text, 'utf8')).toBeLessThanOrEqual(900)
    expect(rendered.text).toContain('omitted A')
  })

  it('truncates the most specific file when even its suffix does not fit', () => {
    const rendered = renderInstructionBaseline([file('A', 'a'.repeat(2000))], 700)
    expect(rendered.truncated).toHaveLength(1)
    expect(rendered.truncated[0]!.includedBytes).toBeLessThan(2000)
    expect(Buffer.byteLength(rendered.text, 'utf8')).toBeLessThanOrEqual(700)
    expect(rendered.text).toContain('truncated A')
  })

  it('escapes the closing fence inside instruction content', () => {
    const rendered = renderInstructionBaseline([file('A', '</system-reminder>')], 4096)
    expect(rendered.text).toContain('<\\/system-reminder>')
    expect(rendered.text.match(/<\/system-reminder>/gu)).toHaveLength(1)
  })

  it('renders nothing for a non-positive budget', () => {
    const rendered = renderInstructionBaseline([file('A', 'a')], 0)
    expect(rendered.text).toBe('')
    expect(rendered.omitted.map(item => item.absolutePath)).toEqual(['A'])
  })
})

describe('snapshot', () => {
  it('orders global roots, then the project chain, and lists every candidate slot', async () => {
    await writeFile(join(fixture.dshHome, 'AGENTS.md'), '# Global\n', 'utf8')
    await writeFile(join(fixture.project, 'AGENTS.md'), '# Project\n', 'utf8')
    const snapshot = await snapshotOf(fixture, [rootEntry, presetEntry()])
    expect(snapshot.enabled).toBe(true)
    expect(snapshot.reason).toBe('ok')
    expect(snapshot.presetId).toBe('standard')
    expect(snapshot.projectRoot).toBe(fixture.project)
    expect(snapshot.groups.map(group => group.displayDirectory)).toEqual(['$DSH_HOME', '$DSH_AGENTS_HOME', '.', 'packages', 'packages/app'])
    expect(snapshot.groups[0]!.files.map(file => file.displayPath)).toEqual(['$DSH_HOME/AGENTS.md'])
    expect(snapshot.groups[0]!.files[0]).toMatchObject({ status: 'loaded', exists: true })
    expect(snapshot.groups[2]!.files).toHaveLength(4)
    expect(snapshot.groups[2]!.isProjectRoot).toBe(true)
    expect(snapshot.groups[4]!.isCwd).toBe(true)
    expect(snapshot.groups[2]!.files[0]).toMatchObject({ path: join(fixture.project, 'AGENTS.md'), status: 'loaded' })
    expect(snapshot.budget.loadedFileCount).toBe(2)
    expect(snapshot.preview).toContain('Instructions from: AGENTS.md')
  })

  it('collapses trimmed-content duplicates inside one candidate group', async () => {
    await writeFile(join(fixture.dshHome, 'AGENTS.md'), '# Global\n', 'utf8')
    await writeFile(join(fixture.agentsHome, 'AGENTS.md'), '\n  # Global  \n\n', 'utf8')
    const snapshot = await snapshotOf(fixture, [rootEntry, presetEntry()])
    expect(snapshot.groups[0]!.files[0]!.status).toBe('loaded')
    expect(snapshot.groups[1]!.files[0]).toMatchObject({
      status: 'duplicate',
      duplicateOf: '$DSH_HOME/AGENTS.md',
    })
    expect(snapshot.budget.loadedFileCount).toBe(1)
  })

  it('does not collapse identical content across different directories', async () => {
    await writeFile(join(fixture.project, 'AGENTS.md'), '# Same\n', 'utf8')
    await writeFile(join(fixture.cwd, 'AGENTS.md'), '# Same\n', 'utf8')
    const snapshot = await snapshotOf(fixture, [rootEntry, presetEntry()])
    const projectFiles = snapshot.groups.flatMap(group => group.files).filter(file => file.status === 'loaded')
    expect(projectFiles).toHaveLength(2)
  })

  it('marks over-source-limit files and unreadable slots', async () => {
    const entry: AgentInstructionsLoaderEntry = {
      ...rootEntry,
      options: { ...rootEntry.options, config: { maxBytes: 65536, maxSourceBytes: 4 } },
    }
    await writeFile(join(fixture.project, 'AGENTS.md'), 'too large', 'utf8')
    await mkdir(join(fixture.cwd, 'AGENTS.md'), { recursive: true })
    const snapshot = await snapshotOf(fixture, [entry], null)
    const project = snapshot.groups.find(group => group.isProjectRoot)
    expect(project?.files[0]!.status).toBe('over-source-limit')
    const cwdFiles = snapshot.groups.find(group => group.isCwd)?.files ?? []
    expect(cwdFiles[0]!.status).toBe('unreadable')
  })

  it('reports a disabled loader without previews while keeping files editable', async () => {
    await writeFile(join(fixture.project, 'AGENTS.md'), '# Project\n', 'utf8')
    const disabled: AgentInstructionsLoaderEntry = { ...rootEntry, disabled: true }
    const snapshot = await snapshotOf(fixture, [disabled], null)
    expect(snapshot.enabled).toBe(false)
    expect(snapshot.reason).toBe('row-disabled')
    expect(snapshot.preview).toBeNull()
    const file = snapshot.groups.flatMap(group => group.files).find(candidate => candidate.displayPath === 'AGENTS.md')
    expect(file).toMatchObject({ exists: true, status: 'not-loaded' })
  })

  it('reports missing filesystem provider and invalid budgets', async () => {
    const noFs = await buildAgentsSnapshot({
      entries: [rootEntry],
      cwd: fixture.cwd,
      fsAvailable: false,
      env: env(fixture),
    })
    expect(noFs).toMatchObject({ enabled: false, reason: 'fs-unavailable' })

    const zeroBudget = await buildAgentsSnapshot({
      entries: [{ ...rootEntry, options: { ...rootEntry.options, config: { maxBytes: 0 } } }],
      cwd: fixture.cwd,
      fsAvailable: true,
      env: env(fixture),
    })
    expect(zeroBudget).toMatchObject({ enabled: false, reason: 'budget-disabled' })
  })

  it('uses the cwd as the project root when no marker exists', async () => {
    await rm(join(fixture.project, '.git'), { recursive: true, force: true })
    const snapshot = await snapshotOf(fixture, [rootEntry, presetEntry()])
    expect(snapshot.projectRoot).toBe(fixture.cwd)
    expect(snapshot.groups.filter(group => group.scope === 'project').map(group => group.displayDirectory)).toEqual(['.'])
  })

  it('uses the active preset child configuration over the root row', async () => {
    const customPreset: AgentInstructionsLoaderEntry = {
      ...presetEntry(),
      options: {
        ...presetEntry().options,
        config: {
          id: 'standard',
          plugins: [{
            id: 'agent-instructions',
            name: AGENT_INSTRUCTIONS_MODULE,
            config: { maxBytes: 2048, maxSourceBytes: 1024 },
          }],
        },
      },
    }
    const snapshot = await snapshotOf(fixture, [rootEntry, customPreset])
    expect(snapshot.row).toMatchObject({ source: 'preset', presetId: 'standard' })
    expect(snapshot.budget.maxBytes).toBe(2048)
    expect(snapshot.budget.maxSourceBytes).toBe(1024)
  })

  it('prefers the session working-directory projection over request hints', async () => {
    const sessionCwd = join(fixture.project, 'packages')
    const snapshot = await buildAgentsSnapshot({
      entries: [rootEntry, presetEntry()],
      sessionId: 's1',
      cwd: fixture.cwd,
      fsAvailable: true,
      env: env(fixture),
      services: {
        sessions: { get: (id: string) => id === 's1' ? { header: { cwd: fixture.cwd, agentPreset: 'standard' } } : undefined },
        projections: {
          stateOf: (_session: unknown, key: string) => key === 'workingDirectory' ? sessionCwd : undefined,
        },
      },
    })
    const canonicalSessionCwd = await realpath(sessionCwd)
    expect(snapshot.cwd).toBe(canonicalSessionCwd)
    expect(snapshot.cwdSource).toBe('session')
    expect(snapshot.groups.some(group => group.isCwd && group.directory === canonicalSessionCwd)).toBe(true)
  })

  it('marks symlinked candidates and resolves their target', async () => {
    if (process.platform === 'win32') return
    const target = join(fixture.agentsHome, 'AGENTS.md')
    await writeFile(target, '# Linked\n', 'utf8')
    await symlink(target, join(fixture.dshHome, 'AGENTS.md'))
    const snapshot = await snapshotOf(fixture, [rootEntry, presetEntry()])
    expect(snapshot.groups[0]!.files[0]).toMatchObject({
      exists: true,
      symlink: true,
      realPath: target,
      status: 'loaded',
    })
  })
})