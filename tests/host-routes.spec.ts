import { Buffer } from 'node:buffer'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'
import { MCP_CLIENT_MODULE } from '../src/mcp.ts'
import type { RequestFace, ResponseFace } from '../src/http.ts'

type Handler = (req: RequestFace, res: ResponseFace) => void | Promise<void>

interface Harness {
  readonly ctx: Context
  readonly routes: Map<string, Handler>
  readonly statePath: string
  readonly dir: string
}

function request(
  chunks: readonly (Buffer | string)[],
  headers: Record<string, string | string[] | undefined> = {},
  method = 'GET',
): RequestFace {
  return {
    method,
    headers,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

function postRequest(
  chunks: readonly (Buffer | string)[],
  headers: Record<string, string | string[] | undefined> = {},
): RequestFace {
  return request(chunks, headers, 'POST')
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

const SKILL_FILE = `---
name: alpha
description: Alpha skill
---
Body.
`

async function setup(): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-harness-panel-routes-'))
  const statePath = join(dir, 'state.json')
  const routes = new Map<string, Handler>()

  const ctx = new Context()
  ctx.provide('loader', {
    entries: () => [{
      options: {
        id: 'mcp-test',
        name: MCP_CLIENT_MODULE,
        config: {
          serverName: 'test',
          transport: 'streamable-http',
          url: 'https://example.com/mcp?token=sekret',
          headers: { 'X-API-Key': 'never-shown' },
        },
      },
      disabled: false,
      fiber: { state: 2 },
    }],
  })
  ctx.provide('tools', {
    schemas: () => [{ name: 'mcp__test__foo', description: 'foo' }],
  })
  ctx.provide('webServer', {
    register: (route: { path: string; handler: Handler }) => {
      routes.set(route.path, route.handler)
      return () => {}
    },
  })
  apply(ctx, { statePath })
  return { ctx, routes, statePath, dir }
}

let harness: Harness

beforeEach(async () => {
  harness = await setup()
})

afterEach(async () => {
  await harness.ctx.fiber.dispose()
  await rm(dirname(harness.statePath), { recursive: true, force: true })
})

describe('host routes', () => {
  it('serves the MCP snapshot', async () => {
    const handler = harness.routes.get('/harness-panel/mcp')
    expect(handler).toBeDefined()
    const out = response()
    await handler!(request([]), out.res)
    expect(out.status()).toBe(200)
    const body = JSON.parse(out.body()) as { servers: Array<{ serverName: string; toolCount: number; target: string }> }
    expect(body.servers).toHaveLength(1)
    expect(body.servers[0]).toMatchObject({ serverName: 'test', toolCount: 1 })
    expect(body.servers[0]!.target).toContain('token=***')
    expect(out.body()).not.toContain('sekret')
  })

  it('starts with an empty skill state', async () => {
    const out = response()
    await harness.routes.get('/harness-panel/skills')!(request([]), out.res)
    expect(out.status()).toBe(200)
    expect(JSON.parse(out.body())).toMatchObject({ fileControlAvailable: true, disabled: [] })
  })

  it('disables a skill in its file and re-enables it', async () => {
    const skillPath = join(harness.dir, 'alpha', 'SKILL.md')
    await mkdir(dirname(skillPath), { recursive: true })
    await writeFile(skillPath, SKILL_FILE, 'utf8')
    const toggle = harness.routes.get('/harness-panel/skills/toggle')!
    const headers = {
      'x-harness-panel': '1',
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:1',
      host: '127.0.0.1:1',
    }

    const disable = response()
    await toggle(postRequest([JSON.stringify({
      name: 'alpha',
      enabled: false,
      description: 'Alpha skill',
      path: skillPath,
      modelInvocable: true,
    })], headers), disable.res)
    expect(disable.status()).toBe(200)
    const disabled = JSON.parse(disable.body()) as { disabled: Array<{ name: string; path: string }> }
    expect(disabled.disabled).toMatchObject([{ name: 'alpha', path: skillPath }])
    const disabledText = await readFile(skillPath, 'utf8')
    expect(disabledText).toContain('user-invocable: false')
    expect(disabledText).toContain('disable-model-invocation: true')
    expect(disabledText).toContain('Body.')
    const state = JSON.parse(await readFile(harness.statePath, 'utf8')) as { disabledSkills: Array<{ original: object }> }
    expect(state.disabledSkills).toHaveLength(1)
    expect(state.disabledSkills[0]!.original).toEqual({})

    const enable = response()
    await toggle(postRequest([JSON.stringify({ name: 'alpha', enabled: true })], headers), enable.res)
    expect(enable.status()).toBe(200)
    expect(JSON.parse(enable.body())).toMatchObject({ disabled: [] })
    expect(await readFile(skillPath, 'utf8')).toBe(SKILL_FILE)
  })

  it('refuses a disable whose file declares another skill', async () => {
    const skillPath = join(harness.dir, 'beta', 'SKILL.md')
    await mkdir(dirname(skillPath), { recursive: true })
    await writeFile(skillPath, SKILL_FILE.replace('name: alpha', 'name: beta'), 'utf8')
    const out = response()
    await harness.routes.get('/harness-panel/skills/toggle')!(
      postRequest([JSON.stringify({ name: 'gamma', enabled: false, path: skillPath })], {
        'x-harness-panel': '1',
        'content-type': 'application/json',
      }),
      out.res,
    )
    expect(out.status()).toBe(400)
    expect(await readFile(skillPath, 'utf8')).toContain('name: beta')
  })

  it('drops version 1 gate records at load time', async () => {
    await writeFile(harness.statePath, JSON.stringify({
      version: 1,
      disabledSkills: [{ name: 'ghost', description: 'g', path: '/g/SKILL.md', modelInvocable: true, disabledAt: 1 }],
    }), 'utf8')
    const fresh = await setup()
    try {
      const out = response()
      await fresh.routes.get('/harness-panel/skills')!(request([]), out.res)
      expect(JSON.parse(out.body())).toMatchObject({ disabled: [] })
    } finally {
      await fresh.ctx.fiber.dispose()
      await rm(dirname(fresh.statePath), { recursive: true, force: true })
    }
  })

  it('refuses a write without the panel header', async () => {
    const out = response()
    await harness.routes.get('/harness-panel/skills/toggle')!(
      postRequest(['{}'], { 'content-type': 'application/json' }),
      out.res,
    )
    expect(out.status()).toBe(403)
  })

  it('refuses a cross-origin write', async () => {
    const out = response()
    await harness.routes.get('/harness-panel/skills/toggle')!(
      postRequest(['{}'], {
        'x-harness-panel': '1',
        'content-type': 'application/json',
        origin: 'https://evil.test',
        host: '127.0.0.1:1',
      }),
      out.res,
    )
    expect(out.status()).toBe(403)
  })

  it('refuses a non-JSON write and a malformed body', async () => {
    const nonJson = response()
    await harness.routes.get('/harness-panel/skills/toggle')!(
      postRequest([], { 'x-harness-panel': '1', 'content-type': 'text/plain' }),
      nonJson.res,
    )
    expect(nonJson.status()).toBe(415)

    const malformed = response()
    await harness.routes.get('/harness-panel/skills/toggle')!(
      postRequest(['{nope'], { 'x-harness-panel': '1', 'content-type': 'application/json' }),
      malformed.res,
    )
    expect(malformed.status()).toBe(400)
  })

  it('refuses an invalid toggle request', async () => {
    const out = response()
    await harness.routes.get('/harness-panel/skills/toggle')!(
      postRequest([JSON.stringify({ name: 'Bad_Name', enabled: false, path: '/x/SKILL.md' })], {
        'x-harness-panel': '1',
        'content-type': 'application/json',
      }),
      out.res,
    )
    expect(out.status()).toBe(400)
  })

  it('answers 405 on the wrong method', async () => {
    const out = response()
    const req = { ...request([]), method: 'PUT' }
    await harness.routes.get('/harness-panel/skills/toggle')!(req, out.res)
    expect(out.status()).toBe(405)
  })
})
