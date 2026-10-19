import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { AGENT_INSTRUCTIONS_MODULE, AGENT_PRESET_MODULE, type AgentsSnapshot } from '../src/agents-contract.ts'
import type { RequestFace, ResponseFace } from '../src/http.ts'

type Handler = (req: RequestFace, res: ResponseFace) => void | Promise<void>

interface Harness {
  readonly ctx: Context
  readonly routes: Map<string, Handler>
  readonly dir: string
  readonly project: string
  readonly cwd: string
}

function request(
  chunks: readonly (Buffer | string)[],
  headers: Record<string, string | string[] | undefined> = {},
  method = 'GET',
  url = '/',
): RequestFace {
  return {
    method,
    headers,
    url,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function response(): { res: ResponseFace; status: () => number; body: () => string } {
  let status = 0
  let body = ''
  return {
    res: {
      writeHead(code) { status = code },
      end(text) { body = text ?? '' },
    },
    status: () => status,
    body: () => body,
  }
}

const WRITE_HEADERS = {
  'x-harness-panel': '1',
  'content-type': 'application/json',
  origin: 'http://127.0.0.1:1',
  host: '127.0.0.1:1',
}

let previousDshHome: string | undefined
let previousAgentsHome: string | undefined

async function setup(): Promise<Harness> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'dsh-agents-routes-')))
  const dshHome = join(dir, 'dsh-home')
  const agentsHome = join(dir, 'agents-home')
  const project = join(dir, 'project')
  const cwd = join(project, 'packages', 'app')
  await mkdir(dshHome, { recursive: true })
  await mkdir(agentsHome, { recursive: true })
  await mkdir(cwd, { recursive: true })
  await mkdir(join(project, '.git'), { recursive: true })

  previousDshHome = process.env['DSH_HOME']
  previousAgentsHome = process.env['DSH_AGENTS_HOME']
  process.env['DSH_HOME'] = dshHome
  process.env['DSH_AGENTS_HOME'] = agentsHome

  const routes = new Map<string, Handler>()
  const ctx = new Context()
  ctx.provide('loader', {
    entries: () => [{
      id: 'agent-instructions',
      options: {
        id: 'agent-instructions',
        name: AGENT_INSTRUCTIONS_MODULE,
        config: { maxBytes: 65536 },
      },
      disabled: true,
    }, {
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
          }],
        },
      },
      disabled: false,
    }],
  })
  ctx.provide('tools', { schemas: () => [] })
  ctx.provide('webServer', {
    register: (route: { path: string; handler: Handler }) => {
      routes.set(route.path, route.handler)
      return () => {}
    },
  })
  ctx.provide('fs', {})
  ctx.provide('sessions', {
    get: (id: string) => id === 's1' ? { header: { cwd, agentPreset: 'standard' } } : undefined,
  })
  ctx.provide('sessionProjections', { stateOf: () => undefined })
  ctx.provide('agentPresets', { defaultId: 'standard' })
  apply(ctx, { statePath: join(dir, 'state.json') })
  return { ctx, routes, dir, project, cwd }
}

let harness: Harness

beforeEach(async () => {
  harness = await setup()
})

afterEach(async () => {
  await harness.ctx.fiber.dispose()
  await rm(harness.dir, { recursive: true, force: true })
  if (previousDshHome === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = previousDshHome
  if (previousAgentsHome === undefined) delete process.env['DSH_AGENTS_HOME']
  else process.env['DSH_AGENTS_HOME'] = previousAgentsHome
})

/** The query string every route call shares for this fixture. */
function query(extra: Record<string, string> = {}): string {
  const params = new URLSearchParams()
  params.set('session', 's1')
  params.set('cwd', harness.cwd)
  for (const [key, value] of Object.entries(extra)) params.set(key, value)
  return params.toString()
}

async function loadSnapshot(): Promise<AgentsSnapshot> {
  const out = response()
  await harness.routes.get('/harness-panel/agents')!(
    request([], {}, 'GET', `/harness-panel/agents?${query()}`),
    out.res,
  )
  expect(out.status()).toBe(200)
  return JSON.parse(out.body()) as AgentsSnapshot
}

describe('AGENTS.md routes', () => {
  it('serves the instruction chain for the session working directory', async () => {
    await writeFile(join(harness.project, 'AGENTS.md'), '# Project\n', 'utf8')
    const snapshot = await loadSnapshot()
    expect(snapshot.enabled).toBe(true)
    expect(snapshot.reason).toBe('ok')
    expect(snapshot.presetId).toBe('standard')
    expect(snapshot.sessionId).toBe('s1')
    expect(snapshot.cwd).toBe(await realpath(harness.cwd))
    expect(snapshot.projectRoot).toBe(await realpath(harness.project))
    expect(snapshot.groups.some(group => group.isProjectRoot)).toBe(true)
    expect(snapshot.groups.some(group => group.isCwd)).toBe(true)
    const projectFile = snapshot.groups
      .find(group => group.isProjectRoot)!
      .files.find(file => file.name === 'AGENTS.md')!
    expect(projectFile).toMatchObject({ exists: true, status: 'loaded' })
  })

  it('reads one candidate file and refuses non-candidates', async () => {
    const projectFile = join(harness.project, 'AGENTS.md')
    await writeFile(projectFile, '# Project\n', 'utf8')
    const canonical = await realpath(projectFile)

    const ok = response()
    await harness.routes.get('/harness-panel/agents/file')!(
      request([], {}, 'GET', `/harness-panel/agents/file?${query({ path: canonical })}`),
      ok.res,
    )
    expect(ok.status()).toBe(200)
    expect(JSON.parse(ok.body())).toMatchObject({ content: '# Project\n', path: canonical })

    const outside = response()
    await harness.routes.get('/harness-panel/agents/file')!(
      request([], {}, 'GET', `/harness-panel/agents/file?${query({ path: join(harness.dir, 'other.md') })}`),
      outside.res,
    )
    expect(outside.status()).toBe(400)

    const missing = response()
    await harness.routes.get('/harness-panel/agents/file')!(
      request([], {}, 'GET', `/harness-panel/agents/file?${query({ path: join(await realpath(harness.project), 'CLAUDE.md') })}`),
      missing.res,
    )
    expect(missing.status()).toBe(404)
  })

  it('creates a missing candidate and enforces the mtime precondition', async () => {
    const snapshot = await loadSnapshot()
    const target = snapshot.groups
      .find(group => group.isProjectRoot)!
      .files.find(file => file.name === 'AGENTS.md')!
    expect(target.exists).toBe(false)

    const create = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request([JSON.stringify({
        sessionId: 's1',
        cwd: snapshot.cwd,
        path: target.path,
        content: '# Created\n',
        expectedMtimeMs: null,
      })], WRITE_HEADERS, 'POST', '/harness-panel/agents/write'),
      create.res,
    )
    expect(create.status()).toBe(200)
    expect(JSON.parse(create.body())).toMatchObject({ created: true, symlink: false })
    expect(await readFile(target.path, 'utf8')).toBe('# Created\n')

    const staleCreate = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request([JSON.stringify({
        sessionId: 's1',
        cwd: snapshot.cwd,
        path: target.path,
        content: '# Again\n',
        expectedMtimeMs: null,
      })], WRITE_HEADERS, 'POST', '/harness-panel/agents/write'),
      staleCreate.res,
    )
    expect(staleCreate.status()).toBe(409)

    const current = (await stat(target.path)).mtimeMs
    await new Promise(resolve => { setTimeout(resolve, 15) })
    await writeFile(target.path, '# External\n', 'utf8')
    const conflict = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request([JSON.stringify({
        sessionId: 's1',
        cwd: snapshot.cwd,
        path: target.path,
        content: '# Mine\n',
        expectedMtimeMs: current,
      })], WRITE_HEADERS, 'POST', '/harness-panel/agents/write'),
      conflict.res,
    )
    expect(conflict.status()).toBe(409)
    expect(await readFile(target.path, 'utf8')).toBe('# External\n')
  })

  it('refuses non-candidate writes', async () => {
    const out = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request([JSON.stringify({
        sessionId: 's1',
        cwd: harness.cwd,
        path: join(harness.dir, 'secret.md'),
        content: 'x',
        expectedMtimeMs: null,
      })], WRITE_HEADERS, 'POST', '/harness-panel/agents/write'),
      out.res,
    )
    expect(out.status()).toBe(400)
  })

  it('gates the write route and bounds its body', async () => {
    const noHeader = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request(['{}'], { 'content-type': 'application/json' }, 'POST', '/harness-panel/agents/write'),
      noHeader.res,
    )
    expect(noHeader.status()).toBe(403)

    const crossOrigin = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request(['{}'], { ...WRITE_HEADERS, origin: 'https://evil.test' }, 'POST', '/harness-panel/agents/write'),
      crossOrigin.res,
    )
    expect(crossOrigin.status()).toBe(403)

    const nonJson = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request([], { 'x-harness-panel': '1', 'content-type': 'text/plain' }, 'POST', '/harness-panel/agents/write'),
      nonJson.res,
    )
    expect(nonJson.status()).toBe(415)

    const malformed = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request(['{nope'], { 'x-harness-panel': '1', 'content-type': 'application/json' }, 'POST', '/harness-panel/agents/write'),
      malformed.res,
    )
    expect(malformed.status()).toBe(400)

    const wrongMethod = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request([], {}, 'GET', '/harness-panel/agents/write'),
      wrongMethod.res,
    )
    expect(wrongMethod.status()).toBe(405)

    const snapshot = await loadSnapshot()
    const target = snapshot.groups
      .find(group => group.isProjectRoot)!
      .files.find(file => file.name === 'AGENTS.md')!
    const oversized = response()
    await harness.routes.get('/harness-panel/agents/write')!(
      request([JSON.stringify({
        sessionId: 's1',
        cwd: snapshot.cwd,
        path: target.path,
        content: 'x'.repeat(1_048_577),
        expectedMtimeMs: null,
      })], WRITE_HEADERS, 'POST', '/harness-panel/agents/write'),
      oversized.res,
    )
    expect(oversized.status()).toBe(413)
  })
})