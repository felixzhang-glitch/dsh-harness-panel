/**
 * Static fixtures for the panel preview harness. Shapes mirror the wire
 * contracts in src/ so the pages render exactly what the host would send.
 *
 * The data is deliberately generic: these screenshots ship in the public
 * README, so no real home path, project name, or personal catalog appears.
 */

const now = Date.now()
const HOME = '/Users/dev'
const PROJECT = '/Users/dev/projects/storefront'

/** 12 skills, as a real desktop profile carries them. */
export const skills = [
  ['api-client', 'Generate a typed client for an OpenAPI document, with retries, pagination and auth wiring.'],
  ['changelog', 'Turn merged pull requests into a release changelog grouped by change type.'],
  ['code-review', 'Review a diff for correctness, boundary conditions and missing tests before it lands.'],
  ['data-export', 'Export query results to CSV, Parquet or an xlsx workbook with a reproducible schema.'],
  ['docs-site', 'Build and preview the documentation site, then check internal links and anchors.'],
  ['flaky-test-triage', 'Rebuild a failing CI job locally, isolate the flaky test and report the race.'],
  ['incident-brief', 'Assemble an incident brief from logs, deploy history and the affected service map.'],
  ['migration-plan', 'Plan a schema migration with backfill, shadow reads and a rollback path.'],
  ['perf-profile', 'Profile a request path, rank the hot frames and propose the smallest fix.'],
  ['release-notes', 'Write user-facing release notes from the diff, in the product voice.'],
  ['schema-diff', 'Diff two database schemas and order the changes by deploy risk.'],
  ['sql-review', 'Review a SQL statement for correctness, index use and lock scope.'],
// A switched-off skill leaves the catalog: the gate edits its frontmatter.
].filter(([name]) => name !== 'incident-brief' && name !== 'release-notes').map(([name, description], index) => ({
  name,
  description,
  path: `${HOME}/.agents/skills/${name}/SKILL.md`,
  modelInvocable: index % 6 !== 3,
}))

/** Skills the host records as switched off. */
export const disabledSkills = [
  {
    name: 'incident-brief',
    description: 'Assemble an incident brief from logs, deploy history and the affected service map.',
    path: `${HOME}/.agents/skills/incident-brief/SKILL.md`,
    modelInvocable: true,
    disabledAt: now - 86400000 * 3,
  },
  {
    name: 'release-notes',
    description: 'Write user-facing release notes from the diff, in the product voice.',
    path: `${HOME}/.agents/skills/release-notes/SKILL.md`,
    modelInvocable: true,
    disabledAt: now - 86400000,
  },
]

/** One MCP server view. */
function server(fields: Record<string, unknown>) {
  return {
    serverName: 'srv',
    entryId: 'mcp-srv',
    transport: 'stdio',
    target: 'cmd',
    enabled: true,
    available: true,
    fiberPhase: 'active',
    configuredNote: null,
    toolCount: 0,
    tools: [],
    phase: 'connected',
    attempt: 0,
    maxAttempts: -1,
    delayMs: null,
    reconnectCount: 0,
    lastError: null,
    connectedAt: now - 3600000,
    observedAt: now - 60000,
    statusSource: 'upstream-event',
    envKeys: [],
    headerKeys: [],
    ...fields,
  }
}

/** Eight MCP rows: five healthy, one outside the fleet, four findings. */
export const mcp = {
  servers: [
    server({
      serverName: 'github', entryId: 'mcp-github', transport: 'streamable-http',
      target: 'https://mcp.github.example/tenant', toolCount: 12,
      tools: Array.from({ length: 12 }, (_, i) => ({ name: `mcp__github__tool_${i + 1}`, description: 'Issues, pull requests, checks and repository metadata' })),
      headerKeys: ['Authorization'],
    }),
    server({
      serverName: 'notion', entryId: 'mcp-notion', transport: 'streamable-http',
      target: 'https://mcp.notion.example/mcp', toolCount: 22,
      tools: Array.from({ length: 22 }, (_, i) => ({ name: `mcp__notion__API_op_${i + 1}`, description: 'Notion API operation' })),
      headerKeys: ['Authorization'],
    }),
    server({
      serverName: 'web-search', entryId: 'mcp-web-search', transport: 'stdio',
      target: 'npx -y search-mcp', toolCount: 1,
      tools: [{ name: 'mcp__web-search__search', description: 'Search the public web and return ranked results' }],
      envKeys: ['SEARCH_API_KEY'],
    }),
    server({
      serverName: 'web-reader', entryId: 'mcp-web-reader', transport: 'stdio',
      target: 'npx -y readpage-mcp', toolCount: 2,
      available: false, phase: 'connecting', attempt: 1, maxAttempts: 4, delayMs: 2000,
      tools: [{ name: 'mcp__web-reader__readpage_basic', description: 'Parse a static page' }, { name: 'mcp__web-reader__readpage_scrape', description: 'Render a page in a headless browser' }],
    }),
    server({
      serverName: 'design-docs', entryId: 'mcp-design-docs', transport: 'streamable-http',
      target: 'https://docs.example.com/mcp', toolCount: 2,
      tools: [{ name: 'mcp__design-docs__search', description: 'Search the design-system knowledge base' }, { name: 'mcp__design-docs__read', description: 'Read one documentation page' }],
    }),
    server({
      serverName: 'arxiv', entryId: 'mcp-arxiv', transport: 'stdio',
      target: 'npx -y arxiv-mcp-server', toolCount: 0, available: false, phase: 'exhausted',
      attempt: 3, maxAttempts: 3, reconnectCount: 3, lastError: 'spawn npx ENOENT: command not found', tools: [],
    }),
    server({
      serverName: 'mcp-fs', entryId: 'mcp-fs', transport: 'stdio',
      target: 'npx -y @modelcontextprotocol/server-filesystem /srv', toolCount: 0,
      available: false, fiberPhase: 'failed', phase: 'unknown', tools: [],
    }),
    server({
      serverName: 'legacy-http', entryId: 'mcp-legacy', transport: 'unknown',
      target: 'https://legacy.example/mcp', enabled: false, available: false, phase: 'disposed',
      fiberPhase: 'unloading', toolCount: 0, tools: [],
    }),
  ],
  collectedAt: now,
}

/** The plugin inventory rows behind every MCP switch. */
export const pluginRows = mcp.servers.map((entry, index) => ({
  entryId: entry.entryId,
  patchId: entry.entryId,
  moduleName: '@deepseek-ai/dsh-mcp-client',
  enabled: entry.enabled,
  fiberPhase: index === 6 ? 'failed' : entry.enabled ? 'active' : 'unloading',
  ...index === 7 ? { readOnlyReason: 'management-required' } : {},
}))

/** Two hook bridges: one inactive with three commands, one active with one. */
export const hooks = {
  mounted: [
    {
      entryId: 'hooks-claude-code',
      dialect: 'claude-code',
      configPath: `${HOME}/.claude/settings.json`,
      disabled: true,
      events: [
        {
          event: 'PreToolUse',
          groups: [
            { matcher: 'Bash', hooks: [{ command: `${HOME}/.claude/hooks/guard-bash.sh`, timeoutSec: 10, disabled: false }] },
            { matcher: 'Edit|Write', hooks: [{ command: `${HOME}/.claude/hooks/format-edits.sh`, timeoutSec: 30, disabled: true }] },
          ],
        },
        {
          event: 'Stop',
          groups: [{ matcher: null, hooks: [{ command: `${HOME}/.claude/hooks/notify.sh`, timeoutSec: null, disabled: false }] }],
        },
      ],
      skipped: [{ event: 'Notification', type: 'async' }],
      parseError: null,
    },
    {
      entryId: 'hooks-codex',
      dialect: 'codex',
      configPath: `${HOME}/.codex/hooks.json`,
      disabled: false,
      events: [
        { event: 'PostToolUse', groups: [{ matcher: null, hooks: [{ command: `bun ${HOME}/.codex/hooks/log.ts`, timeoutSec: 5, disabled: false }] }] },
      ],
      skipped: [],
      parseError: null,
    },
  ],
  discovered: [
    { path: `${PROJECT}/.claude/settings.json`, exists: true, eventCount: 1, hookCount: 2, parseError: null },
    { path: `${HOME}/.codex/unused.json`, exists: false, eventCount: 0, hookCount: 0, parseError: null },
  ],
  collectedAt: now,
}

/** One instruction file view. */
function file(fields: Record<string, unknown>) {
  return {
    path: '/tmp/AGENTS.md',
    realPath: null,
    displayPath: 'AGENTS.md',
    scope: 'project',
    directory: '/tmp',
    displayDirectory: '.',
    name: 'AGENTS.md',
    exists: true,
    symlink: false,
    sizeBytes: 1024,
    mtimeMs: now - 86400000,
    status: 'loaded',
    includedBytes: null,
    duplicateOf: null,
    error: null,
    ...fields,
  }
}

/** The instruction chain: two user-global roots and the project chain. */
export const agents = {
  cwd: PROJECT,
  cwdSource: 'session',
  projectRoot: PROJECT,
  sessionId: 'sess-1',
  presetId: 'standard',
  row: { entryId: 'agent-instructions', source: 'preset', presetId: 'standard', disabled: false, config: null },
  enabled: true,
  reason: 'ok',
  groups: [
    {
      key: 'dsh-home',
      scope: 'user-global',
      directory: `${HOME}/.dsh`,
      displayDirectory: '~/.dsh',
      isProjectRoot: false,
      isCwd: false,
      files: [
        file({
          path: `${HOME}/.agents/AGENTS.md`,
          realPath: `${HOME}/.agents/AGENTS.md`,
          displayPath: '~/.dsh/AGENTS.md',
          scope: 'user-global',
          directory: `${HOME}/.dsh`,
          displayDirectory: '~/.dsh',
          symlink: true,
          sizeBytes: 4210,
          name: 'AGENTS.md',
        }),
      ],
    },
    {
      key: 'shared-root',
      scope: 'shared',
      directory: `${HOME}/.agents`,
      displayDirectory: '~/.agents',
      isProjectRoot: false,
      isCwd: false,
      files: [],
    },
    {
      key: 'project-root',
      scope: 'project',
      directory: PROJECT,
      displayDirectory: '.',
      isProjectRoot: true,
      isCwd: true,
      files: [
        file({
          path: `${PROJECT}/AGENTS.md`,
          displayPath: 'AGENTS.md',
          directory: PROJECT,
          displayDirectory: '.',
          name: 'AGENTS.md',
          sizeBytes: 2140,
        }),
        file({
          path: `${PROJECT}/CLAUDE.md`,
          displayPath: 'CLAUDE.md',
          directory: PROJECT,
          displayDirectory: '.',
          name: 'CLAUDE.md',
          exists: false,
          sizeBytes: null,
          mtimeMs: null,
          status: 'missing',
        }),
        file({
          path: `${PROJECT}/AGENTS.local.md`,
          displayPath: 'AGENTS.local.md',
          directory: PROJECT,
          displayDirectory: '.',
          name: 'AGENTS.local.md',
          status: 'truncated',
          sizeBytes: 98304,
          includedBytes: 40960,
        }),
        file({
          path: `${PROJECT}/docs/AGENTS.md`,
          displayPath: 'docs/AGENTS.md',
          directory: `${PROJECT}/docs`,
          displayDirectory: 'docs',
          name: 'AGENTS.md',
          status: 'omitted',
          sizeBytes: 5120,
        }),
        file({
          path: `${PROJECT}/src/AGENTS.md`,
          displayPath: 'src/AGENTS.md',
          directory: `${PROJECT}/src`,
          displayDirectory: 'src',
          name: 'AGENTS.md',
          status: 'unreadable',
          error: 'EACCES: permission denied',
          sizeBytes: null,
          mtimeMs: null,
        }),
      ],
    },
  ],
  budget: {
    maxBytes: 65536,
    maxSourceBytes: 40960,
    renderedBytes: 7680,
    loadedFileCount: 2,
    omitted: ['docs/AGENTS.md'],
    truncated: [{ displayPath: 'AGENTS.local.md', originalBytes: 98304, includedBytes: 40960 }],
  },
  preview: '# AGENTS.md\n\nProject conventions live in docs/.',
  warnings: [],
  collectedAt: now,
}

/** The session store face the panel reads structurally. */
export const sessions = {
  list: {
    subscribe: () => () => {},
    getSnapshot: () => ({
      current: 'sess-1',
      byId: { 'sess-1': { cwd: PROJECT, retainedBy: { mainView: 1 } } },
    }),
  },
}

/** The same fleet with nothing to fix, for checking the quiet board. */
function quiet(source: string): unknown {
  if (source === '/harness-panel/mcp') {
    return {
      servers: mcp.servers.filter(entry => entry.enabled).map(entry => ({
        ...entry,
        available: true,
        phase: 'connected',
        fiberPhase: 'active',
        attempt: 0,
        reconnectCount: 0,
        lastError: null,
      })),
      collectedAt: now,
    }
  }
  if (source === '/harness-panel/hooks') {
    return { mounted: hooks.mounted.map(entry => ({ ...entry, disabled: false })), discovered: [], collectedAt: now }
  }
  if (source === '/harness-panel/agents') {
    return {
      ...agents,
      groups: agents.groups.map(group => ({
        ...group,
        files: group.files.map(entry => entry.status === 'missing' ? entry : { ...entry, status: 'loaded' }),
      })),
      budget: { ...agents.budget, omitted: [], truncated: [] },
    }
  }
  return { fileControlAvailable: true, disabled: [], collectedAt: now }
}

/** Route table for the panel's host endpoints. */
export function route(url: string, allHealthy = false): unknown {
  const path = url.split('?')[0] ?? ''
  if (allHealthy) return quiet(path)
  if (path === '/harness-panel/mcp') return mcp
  if (path === '/harness-panel/hooks') return hooks
  if (path === '/harness-panel/agents') return agents
  if (path === '/harness-panel/skills') return { fileControlAvailable: true, disabled: disabledSkills, collectedAt: now }
  if (path === '/harness-panel/agents/file') {
    const name = decodeURIComponent(url).includes('AGENTS.local.md') ? 'AGENTS.local.md' : 'AGENTS.md'
    return { path: '/tmp/' + name, realPath: null, symlink: false, sizeBytes: 120, mtimeMs: now, content: '# ' + name + '\n\n- Convention one\n- Convention two\n' }
  }
  return undefined
}

/** Skill catalog for the `remote.skills` stub. */
export const skillCatalog = skills
