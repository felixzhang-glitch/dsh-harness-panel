/**
 * AGENTS.md loading system, host side.
 *
 * The panel cannot import `@deepseek-ai/dsh-agent-instructions` (the profile's
 * module graph does not resolve the app-bundled package), so this module reads
 * the loader row and reproduces the loader's documented 0.2.x semantics:
 * user-global roots first, then the project chain from the discovered root down
 * to the session working directory; trimmed-content duplicates collapse within
 * one candidate group; the baseline render drops broader files before it
 * truncates the most specific file. Every candidate slot is surfaced, missing
 * ones included, so the browser can create them.
 *
 * Discovery reads with the host's Node filesystem (like the other panel
 * modules); it does not go through the agent's sandboxed `ctx.fs` provider.
 *
 * @module dsh-harness-panel/agents
 */

import { createHash } from 'node:crypto'
import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  AGENT_INSTRUCTIONS_MODULE,
  AGENT_PRESET_MODULE,
  MAX_AGENT_PREVIEW_BYTES,
  type AgentInstructionFileStatus,
  type AgentInstructionFileView,
  type AgentInstructionGroupView,
  type AgentInstructionReason,
  type AgentInstructionRowView,
  type AgentInstructionScope,
  type AgentInstructionsConfig,
  type AgentsBudgetView,
  type AgentsSnapshot,
} from './agents-contract.ts'
import { sanitizeError } from './sanitize.ts'

/** Default cap on one source file, mirroring the loader's `maxSourceBytes`. */
export const DEFAULT_MAX_SOURCE_BYTES = 1_048_576

/** Default directory markers that identify the project root. */
export const DEFAULT_PROJECT_ROOT_MARKERS: readonly string[] = ['.git']

/** Default base candidate file names. */
export const DEFAULT_INSTRUCTION_FILE_CANDIDATES: readonly string[] = ['AGENTS.md', 'CLAUDE.md']

/** Default local overlay candidate file names. */
export const DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES: readonly string[] = ['AGENTS.local.md', 'CLAUDE.local.md']

/** File name of the user-global instruction file under both global roots. */
const USER_GLOBAL_FILE = 'AGENTS.md'

/** Scope directory sentinel the loader uses for the harness home. */
const USER_GLOBAL_SCOPE = 'user-global'

/** Scope directory sentinel the loader uses for the shared agents root. */
const AGENTS_GLOBAL_SCOPE = 'agents-global'

/** Directory names the loader escapes out of the user-global display namespace. */
const RESERVED_SCOPE_DIRECTORIES: ReadonlySet<string> = new Set([USER_GLOBAL_SCOPE, AGENTS_GLOBAL_SCOPE])

/** Candidate names the loader rejects before discovery. */
const RESERVED_PATH_SEGMENTS: ReadonlySet<string> = new Set(['', '.', '..'])

/** Display labels for the two user-global roots. */
const DEFAULT_DSH_HOME_DISPLAY = '~/.dsh'
const DEFAULT_AGENTS_HOME_DISPLAY = '~/.agents'
const DSH_HOME_ENV = 'DSH_HOME'
const AGENTS_HOME_ENV = 'DSH_AGENTS_HOME'

/** A loader entry's shape as the panel reads it (structural, no loader import). */
export interface AgentInstructionsLoaderEntry {
  /** Full entry id, parent-prefixed. */
  readonly id: string
  readonly options: {
    readonly id: string
    readonly name: string
    readonly config?: unknown
  }
  readonly disabled: boolean
  readonly fiber?: { readonly state: number }
}

/** The live SessionStore face the scope resolver reads. */
export interface AgentSessionsFace {
  get(id: string): AgentSessionFace | undefined
}

/** The Session leaves the resolver reads. */
export interface AgentSessionFace {
  readonly header?: {
    readonly cwd?: string
    readonly agentPreset?: string
  }
}

/** The session-projection registry face. */
export interface AgentSessionProjectionsFace {
  stateOf(session: unknown, key: string): unknown
}

/** The agent-preset registry face. */
export interface AgentPresetsFace {
  readonly defaultId?: string
}

/** Optional services the scope resolver consults. */
export interface AgentScopeServices {
  readonly sessions?: AgentSessionsFace | undefined
  readonly projections?: AgentSessionProjectionsFace | undefined
  readonly presets?: AgentPresetsFace | undefined
}

/** Inputs shared by the snapshot and the single-file routes. */
export interface ResolveAgentScopeOptions {
  readonly entries: readonly AgentInstructionsLoaderEntry[]
  readonly sessionId?: string | undefined
  readonly cwd?: string | undefined
  readonly fsAvailable: boolean
  readonly services?: AgentScopeServices | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
}

/** The resolved chain context before any file is inspected. */
export interface AgentScope {
  readonly cwd: string
  readonly cwdSource: 'session' | 'request' | 'process'
  readonly projectRoot: string
  readonly sessionId: string | null
  readonly presetId: string | null
  readonly row: AgentInstructionRowView | null
  readonly config: AgentInstructionsConfig | null
  readonly enabled: boolean
  readonly reason: AgentInstructionReason
  readonly warnings: readonly string[]
  readonly dshHome: string
  readonly agentsHome: string
  readonly dshHomeLabel: string
  readonly agentsHomeLabel: string
}

/** One candidate slot after metadata probes, before content reads. */
export interface AgentInstructionSlot {
  readonly path: string
  readonly displayPath: string
  readonly scope: AgentInstructionScope
  readonly directory: string
  readonly displayDirectory: string
  readonly groupKey: string
  readonly name: string
  readonly exists: boolean
  readonly symlink: boolean
  readonly realPath: string | null
  readonly sizeBytes: number | null
  readonly mtimeMs: number | null
  readonly error: string | null
}

/** One group of candidate slots. */
export interface AgentInstructionSlotGroup {
  readonly key: string
  readonly scope: AgentInstructionScope
  readonly directory: string
  readonly displayDirectory: string
  readonly isProjectRoot: boolean
  readonly isCwd: boolean
  readonly slots: readonly AgentInstructionSlot[]
}

/** Result of slot discovery. */
export interface AgentSlotDiscovery {
  readonly groups: readonly AgentInstructionSlotGroup[]
  readonly warnings: readonly string[]
}

/** One file that survived reading and takes part in rendering. */
export interface RenderFile {
  readonly absolutePath: string
  readonly displayPath: string
  readonly content: string
}

/** Output shape of the ported baseline renderer. */
export interface RenderedInstructions {
  readonly text: string
  readonly omitted: readonly { readonly absolutePath: string; readonly displayPath: string }[]
  readonly truncated: readonly {
    readonly displayPath: string
    readonly originalBytes: number
    readonly includedBytes: number
  }[]
  readonly represented: readonly RenderFile[]
}

/** Expand the supported `~` prefixes the same way `dsh-home-paths` does. */
function expandHomePath(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** Resolve one user-data root from an environment override and a default. */
function resolveRoot(env: NodeJS.ProcessEnv, envName: string, fallback: () => string): string {
  const fromEnv = env[envName]
  const value = fromEnv !== undefined && fromEnv.trim().length > 0 ? fromEnv : undefined
  return resolve(expandHomePath(value ?? fallback()))
}

/** Resolve the process harness home (`$DSH_HOME` or `~/.dsh`). */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolveRoot(env, DSH_HOME_ENV, () => join(homedir(), '.dsh'))
}

/** Resolve the shared agents root (`$DSH_AGENTS_HOME` or `~/.agents`). */
export function resolveAgentsHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolveRoot(env, AGENTS_HOME_ENV, () => join(homedir(), '.agents'))
}

/** Symbolic label for a harness home: `~/.dsh` for the default, `$DSH_HOME` otherwise. */
export function dshHomeDisplay(home: string): string {
  return resolve(dshHomeDefault()) === home ? DEFAULT_DSH_HOME_DISPLAY : `$${DSH_HOME_ENV}`
}

/** Symbolic label for a shared agents root: `~/.agents` or `$DSH_AGENTS_HOME`. */
export function agentsHomeDisplay(home: string): string {
  return resolve(agentsHomeDefault()) === home ? DEFAULT_AGENTS_HOME_DISPLAY : `$${AGENTS_HOME_ENV}`
}

/** The default harness home before any environment override. */
function dshHomeDefault(): string {
  return join(homedir(), '.dsh')
}

/** The default shared agents root before any environment override. */
function agentsHomeDefault(): string {
  return join(homedir(), '.agents')
}

/** Keep only loader-valid candidate names, in their declared order. */
function normalizeCandidates(value: unknown, fallback: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) return [...fallback]
  const names: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    if (RESERVED_PATH_SEGMENTS.has(item)) continue
    if (/[\\/]/.test(item)) continue
    names.push(item)
  }
  return names
}

/** Keep only string root markers. */
function normalizeMarkers(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [...DEFAULT_PROJECT_ROOT_MARKERS]
  const markers: string[] = []
  for (const item of value) {
    if (typeof item === 'string' && item !== '') markers.push(item)
  }
  return markers
}

/**
 * Normalize one loader row's raw config.
 *
 * @param raw - raw `options.config` value.
 * @returns the normalized config, or null when the required budget is absent.
 */
export function parseAgentInstructionsConfig(raw: unknown): AgentInstructionsConfig | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const maxBytes = row['maxBytes']
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes)) return null
  const maxSourceBytesRaw = row['maxSourceBytes']
  const maxSourceBytes = typeof maxSourceBytesRaw === 'number'
    && Number.isFinite(maxSourceBytesRaw)
    && maxSourceBytesRaw >= 1
    ? Math.floor(maxSourceBytesRaw)
    : DEFAULT_MAX_SOURCE_BYTES
  return {
    maxBytes,
    maxSourceBytes,
    projectRootMarkers: normalizeMarkers(row['projectRootMarkers']),
    instructionFileCandidates: normalizeCandidates(row['instructionFileCandidates'], DEFAULT_INSTRUCTION_FILE_CANDIDATES),
    localInstructionFileCandidates: normalizeCandidates(row['localInstructionFileCandidates'], DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES),
  }
}

/** Read one string field from an unknown record. */
function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field !== '' ? field : undefined
}

/** The row config of one entry. */
function entryConfig(entry: AgentInstructionsLoaderEntry): unknown {
  return entry.options.config
}

/** Find the instruction-loader child in a preset's plugin list (groups included). */
function findInstructionChild(plugins: unknown): Record<string, unknown> | undefined {
  if (!Array.isArray(plugins)) return undefined
  for (const item of plugins) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    if (row['name'] === AGENT_INSTRUCTIONS_MODULE) return row
    const nestedPlugins = row['plugins']
    if (nestedPlugins !== undefined) {
      const nested = findInstructionChild(nestedPlugins)
      if (nested !== undefined) return nested
    }
    const nestedConfig = row['config']
    if (typeof nestedConfig === 'object' && nestedConfig !== null && !Array.isArray(nestedConfig)) {
      const nested = findInstructionChild((nestedConfig as Record<string, unknown>)['plugins'])
      if (nested !== undefined) return nested
    }
  }
  return undefined
}

/** One preset declaration row and its instruction child, when present. */
interface PresetDeclaration {
  readonly entry: AgentInstructionsLoaderEntry
  readonly id: string
  readonly child: Record<string, unknown> | undefined
}

/** Collect the preset declaration rows that reference the instruction loader. */
function presetDeclarations(entries: readonly AgentInstructionsLoaderEntry[]): PresetDeclaration[] {
  const declarations: PresetDeclaration[] = []
  for (const entry of entries) {
    if (entry.options.name !== AGENT_PRESET_MODULE) continue
    const config = entryConfig(entry)
    const id = stringField(config, 'id')
    if (id === undefined) continue
    const plugins = typeof config === 'object' && config !== null && !Array.isArray(config)
      ? (config as Record<string, unknown>)['plugins']
      : undefined
    declarations.push({ entry, id, child: findInstructionChild(plugins) })
  }
  return declarations
}

/** Build the row view for one instruction-config source. */
function rowView(
  entry: AgentInstructionsLoaderEntry,
  source: 'preset' | 'root',
  presetId: string | null,
  rawConfig: unknown,
  disabled: boolean,
): AgentInstructionRowView {
  return {
    entryId: entry.id !== '' ? entry.id : entry.options.id,
    source,
    presetId,
    disabled,
    config: parseAgentInstructionsConfig(rawConfig),
  }
}

/** The outcome of resolving which loader row is in effect. */
export interface ResolvedInstructionRow {
  readonly row: AgentInstructionRowView | null
  readonly presetId: string | null
  readonly warnings: readonly string[]
}

/**
 * Resolve the instruction loader row for one agent preset.
 *
 * The per-agent composition lives in the preset declaration's `plugins` list;
 * the app-level row is normally disabled by the Web bundle. The active preset
 * is preferred, then an enabled root row, then any enabled preset child, and
 * finally any readable row so the page can still show the configured defaults.
 *
 * @param entries - every root loader entry.
 * @param presetId - the resolved active preset id, when known.
 * @returns the effective row, the preset id used, and non-fatal warnings.
 */
export function resolveInstructionRow(
  entries: readonly AgentInstructionsLoaderEntry[],
  presetId: string | null,
): ResolvedInstructionRow {
  const warnings: string[] = []
  const roots = entries.filter(entry => entry.options.name === AGENT_INSTRUCTIONS_MODULE)
  const presets = presetDeclarations(entries)

  const rowFromRoot = (entry: AgentInstructionsLoaderEntry): AgentInstructionRowView =>
    rowView(entry, 'root', null, entryConfig(entry), entry.disabled)

  const rowFromChild = (declaration: PresetDeclaration): AgentInstructionRowView =>
    rowView(
      declaration.entry,
      'preset',
      declaration.id,
      declaration.child === undefined ? undefined : declaration.child['config'],
      declaration.entry.disabled || declaration.child?.['disabled'] === true,
    )

  if (presetId !== null) {
    const declaration = presets.find(candidate => candidate.id === presetId)
    if (declaration === undefined) {
      warnings.push(`agent preset ${presetId} is not declared in the loader`)
    } else {
      if (declaration.entry.fiber !== undefined && declaration.entry.fiber.state === 3) {
        warnings.push(`agent preset ${presetId} failed to load`)
      }
      if (declaration.child !== undefined) {
        return { row: rowFromChild(declaration), presetId, warnings }
      }
      warnings.push(`agent preset ${presetId} does not mount ${AGENT_INSTRUCTIONS_MODULE}; no instructions are injected`)
      const root = roots[0]
      return { row: root === undefined ? null : rowFromRoot(root), presetId, warnings }
    }
  }

  const enabledRoot = roots.find(entry => !entry.disabled)
  if (enabledRoot !== undefined) return { row: rowFromRoot(enabledRoot), presetId, warnings }

  const enabledChild = presets.find(declaration =>
    declaration.child !== undefined
    && !declaration.entry.disabled
    && declaration.child['disabled'] !== true)
  if (enabledChild !== undefined) return { row: rowFromChild(enabledChild), presetId: enabledChild.id, warnings }

  const anyRoot = roots[0]
  if (anyRoot !== undefined) return { row: rowFromRoot(anyRoot), presetId, warnings }

  const anyChild = presets.find(declaration => declaration.child !== undefined)
  if (anyChild !== undefined) return { row: rowFromChild(anyChild), presetId: anyChild.id, warnings }

  return { row: null, presetId, warnings }
}

/** Canonicalize an existing directory. */
async function canonicalDirectory(path: string): Promise<string | undefined> {
  try {
    const resolved = await realpath(path)
    const info = await stat(resolved)
    return info.isDirectory() ? resolved : undefined
  } catch {
    return undefined
  }
}

/** Normalize one absolute path request value. */
export function normalizeAbsolutePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length === 0 || value.length > 4096) return undefined
  if (/[\u0000-\u001f\u007f]/u.test(value)) return undefined
  if (!isAbsolute(value)) return undefined
  return resolve(value)
}

/** Normalize a session id from a request or service face. */
export function normalizeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 200) return undefined
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return undefined
  return trimmed
}

/** Read one string session projection. */
function projectionString(
  projections: AgentSessionProjectionsFace | undefined,
  session: unknown,
  key: string,
): string | undefined {
  if (projections === undefined) return undefined
  try {
    const value = projections.stateOf(session, key)
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/** Read the live session without letting a service failure escape. */
function liveSession(
  services: AgentScopeServices | undefined,
  sessionId: string | undefined,
): AgentSessionFace | undefined {
  if (services?.sessions === undefined || sessionId === undefined) return undefined
  try {
    return services.sessions.get(sessionId)
  } catch {
    return undefined
  }
}

/** Walk upward to the first directory containing a configured marker. */
async function findProjectRoot(
  cwd: string,
  markers: readonly string[],
): Promise<{ root: string; warnings: readonly string[] }> {
  if (markers.length === 0) return { root: resolve(cwd), warnings: [] }
  let current = resolve(cwd)
  for (;;) {
    for (const marker of markers) {
      try {
        await stat(join(current, marker))
        return { root: current, warnings: [] }
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ENOENT' || code === 'ENOTDIR') continue
        return { root: resolve(cwd), warnings: [`project root probe failed: ${sanitizeError(error)}`] }
      }
    }
    const parent = dirname(current)
    if (parent === current) return { root: resolve(cwd), warnings: [] }
    current = parent
  }
}

/** Inclusive root-to-cwd directory chain, broadest first. */
function ancestorChain(root: string, cwd: string): string[] {
  const chain: string[] = []
  let current = resolve(cwd)
  const resolvedRoot = resolve(root)
  while (current !== resolvedRoot) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  chain.push(resolvedRoot)
  return chain.reverse()
}

/** Keep a project-relative display path out of the user-global namespace. */
function escapeProjectDisplayPath(relativePath: string): string {
  const separatorIndex = relativePath.search(/[\\/]/)
  const first = separatorIndex < 0 ? relativePath : relativePath.slice(0, separatorIndex)
  return RESERVED_SCOPE_DIRECTORIES.has(first) ? `./${relativePath}` : relativePath
}

/** Convert a project-relative path to the loader's `/`-separated display form. */
function displayRelative(root: string, path: string): string {
  const rel = relative(root, path)
  return escapeProjectDisplayPath(rel).split(sep).join('/')
}

/** Display form of one project-chain directory. */
function displayProjectDirectory(root: string, directory: string): string {
  const rel = relative(root, directory)
  return rel === '' ? '.' : escapeProjectDisplayPath(rel).split(sep).join('/')
}

/**
 * Resolve the session working directory, active preset, and effective loader
 * row for one request.
 *
 * @param options - loader entries, request hints, and optional host services.
 * @returns the chain context shared by the snapshot and file routes.
 */
export async function resolveAgentScope(options: ResolveAgentScopeOptions): Promise<AgentScope> {
  const warnings: string[] = []
  const env = options.env ?? process.env
  const dshHome = resolveDshHome(env)
  const agentsHome = resolveAgentsHome(env)
  const sessionId = normalizeSessionId(options.sessionId) ?? null
  const session = liveSession(options.services, sessionId ?? undefined)

  const projectedCwd = session === undefined
    ? undefined
    : projectionString(options.services?.projections, session, 'workingDirectory')
  const requestedCwd = normalizeAbsolutePath(options.cwd)
  const headerCwd = session?.header?.cwd !== undefined && isAbsolute(session.header.cwd)
    ? resolve(session.header.cwd)
    : undefined

  let cwd = ''
  let cwdSource: AgentScope['cwdSource'] = 'process'
  for (const candidate of [
    { value: projectedCwd, source: 'session' as const },
    { value: requestedCwd, source: 'request' as const },
    { value: headerCwd, source: 'session' as const },
    { value: process.cwd(), source: 'process' as const },
  ]) {
    if (candidate.value === undefined) continue
    const canonical = await canonicalDirectory(candidate.value)
    if (canonical === undefined) {
      if (candidate.source === 'request') warnings.push(`working directory does not exist: ${candidate.value}`)
      continue
    }
    cwd = canonical
    cwdSource = candidate.source
    break
  }
  if (cwd === '') {
    const fallback = await canonicalDirectory(process.cwd())
    cwd = fallback ?? resolve(process.cwd())
    cwdSource = 'process'
    warnings.push(`could not resolve a working directory; falling back to ${cwd}`)
  }

  const projectedPreset = session === undefined
    ? undefined
    : projectionString(options.services?.projections, session, 'agentPreset')
  const headerPreset = session?.header?.agentPreset !== undefined && session.header.agentPreset !== ''
    ? session.header.agentPreset
    : undefined
  let presetId = projectedPreset ?? headerPreset ?? undefined
  if (presetId === undefined) {
    try {
      const fallback = options.services?.presets?.defaultId
      if (typeof fallback === 'string' && fallback !== '') presetId = fallback
    } catch {
      presetId = undefined
    }
  }

  const resolvedRow = resolveInstructionRow(options.entries, presetId ?? null)
  warnings.push(...resolvedRow.warnings)

  const row = resolvedRow.row
  const config = row?.config ?? null
  let reason: AgentInstructionReason
  if (row === null) reason = 'row-missing'
  else if (row.disabled) reason = 'row-disabled'
  else if (config === null) reason = 'row-invalid'
  else if (!options.fsAvailable) reason = 'fs-unavailable'
  else if (!Number.isFinite(config.maxBytes) || config.maxBytes <= 0) reason = 'budget-disabled'
  else reason = 'ok'

  const rootMarkers = config?.projectRootMarkers ?? DEFAULT_PROJECT_ROOT_MARKERS
  const discoveredRoot = await findProjectRoot(cwd, rootMarkers)
  warnings.push(...discoveredRoot.warnings)

  return {
    cwd,
    cwdSource,
    projectRoot: discoveredRoot.root,
    sessionId,
    presetId: presetId ?? null,
    row,
    config,
    enabled: reason === 'ok',
    reason,
    warnings,
    dshHome,
    agentsHome,
    dshHomeLabel: dshHomeDisplay(dshHome),
    agentsHomeLabel: agentsHomeDisplay(agentsHome),
  }
}

/** Probe one candidate slot without reading its content. */
async function inspectSlot(
  path: string,
  displayPath: string,
  scope: AgentInstructionScope,
  directory: string,
  displayDirectory: string,
  groupKey: string,
  name: string,
): Promise<AgentInstructionSlot> {
  const base: AgentInstructionSlot = {
    path,
    displayPath,
    scope,
    directory,
    displayDirectory,
    groupKey,
    name,
    exists: false,
    symlink: false,
    realPath: null,
    sizeBytes: null,
    mtimeMs: null,
    error: null,
  } as const
  let linkInfo
  try {
    linkInfo = await lstat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return base
    return { ...base, exists: true, error: sanitizeError(error) }
  }
  const symlink = linkInfo.isSymbolicLink()
  let targetInfo
  try {
    targetInfo = await stat(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (symlink && (code === 'ENOENT' || code === 'ENOTDIR')) {
      return { ...base, exists: true, symlink: true, error: 'symbolic link target does not exist' }
    }
    return { ...base, exists: true, symlink, error: sanitizeError(error) }
  }
  if (!targetInfo.isFile()) {
    return { ...base, exists: true, symlink, error: 'not a regular file' }
  }
  let resolvedPath: string | null = null
  try {
    resolvedPath = await realpath(path)
  } catch {
    resolvedPath = null
  }
  return {
    ...base,
    exists: true,
    symlink,
    realPath: resolvedPath,
    sizeBytes: targetInfo.size,
    mtimeMs: targetInfo.mtimeMs,
  }
}

/**
 * Discover every candidate slot for a resolved scope.
 *
 * @param scope - resolved chain context.
 * @returns groups in loader precedence order, each with every candidate slot.
 */
export async function discoverAgentInstructionSlots(scope: AgentScope): Promise<AgentSlotDiscovery> {
  const config = scope.config
  const baseCandidates = config?.instructionFileCandidates ?? DEFAULT_INSTRUCTION_FILE_CANDIDATES
  const localCandidates = config?.localInstructionFileCandidates ?? DEFAULT_LOCAL_INSTRUCTION_FILE_CANDIDATES
  const groups: AgentInstructionSlotGroup[] = []

  const globalGroups: readonly {
    key: string
    scope: 'user-global' | 'shared'
    directory: string
    displayDirectory: string
  }[] = [
    { key: 'user-global', scope: 'user-global', directory: scope.dshHome, displayDirectory: scope.dshHomeLabel },
    { key: 'shared', scope: 'shared', directory: scope.agentsHome, displayDirectory: scope.agentsHomeLabel },
  ]
  for (const group of globalGroups) {
    const path = join(group.directory, USER_GLOBAL_FILE)
    const slot = await inspectSlot(
      path,
      `${group.displayDirectory}/${USER_GLOBAL_FILE}`,
      group.scope,
      group.directory,
      group.displayDirectory,
      'user-global',
      USER_GLOBAL_FILE,
    )
    groups.push({
      key: group.key,
      scope: group.scope,
      directory: group.directory,
      displayDirectory: group.displayDirectory,
      isProjectRoot: false,
      isCwd: false,
      slots: [slot],
    })
  }

  for (const directory of ancestorChain(scope.projectRoot, scope.cwd)) {
    const displayDirectory = displayProjectDirectory(scope.projectRoot, directory)
    const slots: AgentInstructionSlot[] = []
    for (const name of [...baseCandidates, ...localCandidates]) {
      const path = join(directory, name)
      slots.push(await inspectSlot(
        path,
        displayRelative(scope.projectRoot, path),
        'project',
        directory,
        displayDirectory,
        `project:${directory}`,
        name,
      ))
    }
    groups.push({
      key: `project:${directory}`,
      scope: 'project',
      directory,
      displayDirectory,
      isProjectRoot: directory === scope.projectRoot,
      isCwd: directory === scope.cwd,
      slots,
    })
  }

  return { groups, warnings: [] }
}

/** One candidate's content-read outcome. */
interface SlotContent {
  readonly content?: string
  readonly overSourceLimit: boolean
  readonly error?: string
}

/** Read one present slot's content under the source cap. */
async function readSlotContent(slot: AgentInstructionSlot, maxSourceBytes: number): Promise<SlotContent> {
  if (!slot.exists || slot.error !== null) return { overSourceLimit: false }
  if (slot.sizeBytes !== null && slot.sizeBytes > maxSourceBytes) return { overSourceLimit: true }
  try {
    const content = await readFile(slot.path, 'utf8')
    if (Buffer.byteLength(content, 'utf8') > maxSourceBytes) return { overSourceLimit: true }
    return { overSourceLimit: false, content }
  } catch (error) {
    return { overSourceLimit: false, error: sanitizeError(error) }
  }
}

/** SHA-1 of trimmed content, matching the loader's duplicate identity. */
function trimmedDigest(content: string): string {
  return createHash('sha1').update(content.trim()).digest('hex')
}

/** Byte length of one UTF-8 string. */
function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

/** The loader's system-reminder fence. */
const SYSTEM_REMINDER_OPEN = '<system-reminder>'
const SYSTEM_REMINDER_CLOSE = '</system-reminder>'

/** Baseline intro text, verbatim from the loader. */
const AGENT_INSTRUCTIONS_INTRO = 'The following workspace instructions may be relevant to your work. Use them as guidance when applicable. More specific instructions take precedence over broader ones. They do not override system, developer, or direct user instructions.'

/** Compact intro used when the normal intro no longer fits. */
const COMPACT_AGENT_INSTRUCTIONS_INTRO = 'Workspace instructions were omitted or truncated to fit the configured byte budget.'

/** Escape a literal closing fence inside instruction content. */
function escapeInstructionFrameBody(body: string): string {
  return body.replaceAll(SYSTEM_REMINDER_CLOSE, '<\\/system-reminder>')
}

/** One file's baseline section. */
function sectionText(file: RenderFile): string {
  return `Instructions from: ${file.displayPath}\n\n${file.content}`
}

/** Truncate a UTF-8 string to a byte cap without splitting a code point. */
function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length <= maxBytes) return value
  let end = Math.max(0, Math.trunc(maxBytes))
  while (end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) end -= 1
  return bytes.subarray(0, end).toString('utf8')
}

/** The budget marker line, verbatim from the loader. */
function markerText(
  maxBytes: number,
  omitted: readonly { readonly displayPath: string }[],
  truncated: readonly { readonly displayPath: string; readonly originalBytes: number; readonly includedBytes: number }[],
): string {
  if (omitted.length === 0 && truncated.length === 0) return ''
  const parts: string[] = []
  if (omitted.length > 0) parts.push(`omitted ${omitted.map(file => file.displayPath).join(', ')}`)
  if (truncated.length > 0) {
    parts.push(`truncated ${truncated.map(item => `${item.displayPath} from ${item.originalBytes} to ${item.includedBytes} bytes`).join(', ')}`)
  }
  return `Workspace instruction budget ${maxBytes} bytes: ${parts.join('; ')}`
}

/** Display style of one baseline render pass. */
interface RenderStyle {
  readonly intro: string
  readonly section: (file: RenderFile) => string
}

/** The loader's normal baseline style. */
const BASELINE_STYLE: RenderStyle = {
  intro: AGENT_INSTRUCTIONS_INTRO,
  section: sectionText,
}

/** The compact fallback style used when the normal intro no longer fits. */
const COMPACT_STYLE: RenderStyle = {
  intro: COMPACT_AGENT_INSTRUCTIONS_INTRO,
  section: sectionText,
}

/** Compose the complete bounded baseline text. */
function buildInstructionText(
  files: readonly RenderFile[],
  maxBytes: number,
  omitted: readonly { readonly displayPath: string }[],
  truncated: readonly { readonly displayPath: string; readonly originalBytes: number; readonly includedBytes: number }[],
  style: RenderStyle,
): string {
  return [
    SYSTEM_REMINDER_OPEN,
    escapeInstructionFrameBody([
      markerText(maxBytes, omitted, truncated),
      style.intro,
      ...files.map(file => style.section(file)),
    ].filter(block => block.length > 0).join('\n\n')),
    SYSTEM_REMINDER_CLOSE,
  ].join('\n')
}

/** Replace one file's content with a truncated prefix. */
function withTruncatedContent(file: RenderFile, includedBytes: number): RenderFile {
  return { ...file, content: truncateUtf8(file.content, includedBytes) }
}

/** Find the largest prefix of the most-specific file that still fits. */
function truncateToFit(
  file: RenderFile,
  maxBytes: number,
  omitted: readonly { readonly displayPath: string }[],
  style: RenderStyle,
): RenderFile {
  const originalBytes = byteLength(file.content)
  let low = 0
  let high = originalBytes
  let best = withTruncatedContent(file, 0)
  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const candidate = withTruncatedContent(file, mid)
    const truncated = [{
      displayPath: file.displayPath,
      originalBytes,
      includedBytes: byteLength(candidate.content),
    }]
    if (byteLength(buildInstructionText([candidate], maxBytes, omitted, truncated, style)) <= maxBytes) {
      best = candidate
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return best
}

/**
 * Render a baseline within an explicit byte budget.
 *
 * This is a faithful port of the shipped loader's `renderInstructionContext`:
 * broader files are dropped before the most-specific file is truncated, and the
 * compact intro plus bare notice are the final fallbacks.
 *
 * @param files - deduplicated files in broadest-to-most-specific order.
 * @param maxBytes - complete baseline byte budget.
 * @returns rendered text and the transitions it represents.
 */
export function renderInstructionBaseline(files: readonly RenderFile[], maxBytes: number): RenderedInstructions {
  if (maxBytes <= 0 || !Number.isFinite(maxBytes)) {
    return {
      text: '',
      omitted: files.map(file => ({ absolutePath: file.absolutePath, displayPath: file.displayPath })),
      truncated: [],
      represented: [],
    }
  }
  const fullText = buildInstructionText(files, maxBytes, [], [], BASELINE_STYLE)
  if (byteLength(fullText) <= maxBytes) {
    return { text: fullText, omitted: [], truncated: [], represented: files }
  }
  for (let start = 1; start < files.length; start += 1) {
    const included = files.slice(start)
    const omitted = files.slice(0, start).map(file => ({
      absolutePath: file.absolutePath,
      displayPath: file.displayPath,
    }))
    const suffixText = buildInstructionText(included, maxBytes, omitted, [], BASELINE_STYLE)
    if (byteLength(suffixText) <= maxBytes) {
      return { text: suffixText, omitted, truncated: [], represented: included }
    }
  }
  const mostSpecific = files.at(-1)
  if (mostSpecific === undefined) {
    return { text: '', omitted: [], truncated: [], represented: [] }
  }
  const omitted = files.slice(0, -1).map(file => ({
    absolutePath: file.absolutePath,
    displayPath: file.displayPath,
  }))
  const originalBytes = byteLength(mostSpecific.content)
  for (const style of [BASELINE_STYLE, COMPACT_STYLE]) {
    const truncatedFile = truncateToFit(mostSpecific, maxBytes, omitted, style)
    const includedBytes = byteLength(truncatedFile.content)
    const truncated = [{ displayPath: mostSpecific.displayPath, originalBytes, includedBytes }]
    const text = buildInstructionText([truncatedFile], maxBytes, omitted, truncated, style)
    if (byteLength(text) <= maxBytes) {
      return {
        text,
        omitted,
        truncated,
        represented: includedBytes > 0 || originalBytes === 0 ? [mostSpecific] : [],
      }
    }
  }
  const truncated = [{ displayPath: mostSpecific.displayPath, originalBytes, includedBytes: 0 }]
  const compactNotice = escapeInstructionFrameBody(markerText(maxBytes, omitted, truncated))
  const compactWithHeading = escapeInstructionFrameBody([
    compactNotice,
    BASELINE_STYLE.section(withTruncatedContent(mostSpecific, 0)),
  ].join('\n\n'))
  if (byteLength(compactWithHeading) <= maxBytes) {
    return {
      text: compactWithHeading,
      omitted,
      truncated,
      represented: originalBytes === 0 ? [mostSpecific] : [],
    }
  }
  return {
    text: byteLength(compactNotice) <= maxBytes ? compactNotice : truncateUtf8(compactNotice, maxBytes),
    omitted,
    truncated,
    represented: [],
  }
}

/** The reason a slot ended up in its display status. */
interface SlotDisposition {
  readonly status: AgentInstructionFileStatus
  readonly includedBytes: number | null
  readonly duplicateOf: string | null
  readonly error: string | null
}

/** Assemble the file view from a slot and its disposition. */
function fileView(slot: AgentInstructionSlot, disposition: SlotDisposition): AgentInstructionFileView {
  return {
    path: slot.path,
    realPath: slot.realPath,
    displayPath: slot.displayPath,
    scope: slot.scope,
    directory: slot.directory,
    displayDirectory: slot.displayDirectory,
    name: slot.name,
    exists: slot.exists,
    symlink: slot.symlink,
    sizeBytes: slot.sizeBytes,
    mtimeMs: slot.mtimeMs,
    status: disposition.status,
    includedBytes: disposition.includedBytes,
    duplicateOf: disposition.duplicateOf,
    error: disposition.error,
  }
}

/** Flatten groups into loader order. */
function flattenSlots(groups: readonly AgentInstructionSlotGroup[]): AgentInstructionSlot[] {
  return groups.flatMap(group => [...group.slots])
}

/** Classify every slot and assemble the response. */
function classifySlots(
  groups: readonly AgentInstructionSlotGroup[],
  scope: AgentScope,
  contents: ReadonlyMap<string, string>,
  readErrors: ReadonlyMap<string, string>,
  overSourceLimit: ReadonlySet<string>,
  duplicates: ReadonlyMap<string, string>,
): { readonly fileViews: readonly AgentInstructionFileView[]; readonly render: RenderedInstructions | null } {
  const config = scope.config
  const enabled = scope.enabled
  const render = enabled && config !== null
    ? renderInstructionBaseline(
        flattenSlots(groups)
          .filter(slot => slot.exists && slot.error === null && contents.has(slot.path) && !duplicates.has(slot.path))
          .map(slot => ({ absolutePath: slot.path, displayPath: slot.displayPath, content: contents.get(slot.path)! })),
        config.maxBytes,
      )
    : null
  const represented = new Set(render?.represented.map(file => file.absolutePath) ?? [])
  const omitted = new Set(render?.omitted.map(file => file.absolutePath) ?? [])
  const truncated = new Map(render?.truncated.map(item => [item.displayPath, item]) ?? [])

  const views: AgentInstructionFileView[] = []
  for (const slot of flattenSlots(groups)) {
    const duplicateOf = duplicates.get(slot.path) ?? null
    const truncatedItem = truncated.get(slot.displayPath)
    const content = contents.get(slot.path)
    const error = readErrors.get(slot.path) ?? slot.error
    let status: AgentInstructionFileStatus
    if (!slot.exists) status = 'missing'
    else if (error !== null) status = 'unreadable'
    else if (overSourceLimit.has(slot.path)) status = 'over-source-limit'
    else if (duplicateOf !== null) status = 'duplicate'
    else if (!enabled) status = 'not-loaded'
    else if (truncatedItem !== undefined) status = 'truncated'
    else if (omitted.has(slot.path)) status = 'omitted'
    else if (represented.has(slot.path)) status = content === '' ? 'empty' : 'loaded'
    else status = 'not-loaded'
    const includedBytes = status === 'truncated'
      ? truncatedItem?.includedBytes ?? null
      : status === 'loaded' || status === 'empty'
        ? content === undefined ? null : byteLength(content)
        : null
    views.push(fileView(slot, { status, includedBytes, duplicateOf, error }))
  }
  return { fileViews: views, render }
}

/**
 * Build the complete AGENTS.md snapshot for one request.
 *
 * @param options - loader entries, request hints, services, and env.
 * @returns the snapshot served to the browser.
 */
export async function buildAgentsSnapshot(options: ResolveAgentScopeOptions): Promise<AgentsSnapshot> {
  const scope = await resolveAgentScope(options)
  const discovery = await discoverAgentInstructionSlots(scope)
  const maxSourceBytes = scope.config?.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES
  const warnings: string[] = [...scope.warnings, ...discovery.warnings]

  const contents = new Map<string, string>()
  const readErrors = new Map<string, string>()
  const overSourceLimit = new Set<string>()
  const duplicates = new Map<string, string>()
  const keptDigests = new Map<string, Map<string, string>>()

  for (const group of discovery.groups) {
    for (const slot of group.slots) {
      if (!slot.exists || slot.error !== null) continue
      const outcome = await readSlotContent(slot, maxSourceBytes)
      if (outcome.overSourceLimit) {
        overSourceLimit.add(slot.path)
        continue
      }
      if (outcome.error !== undefined || outcome.content === undefined) {
        readErrors.set(slot.path, outcome.error ?? 'read failed')
        continue
      }
      contents.set(slot.path, outcome.content)
      const groupDigests = keptDigests.get(slot.groupKey) ?? new Map<string, string>()
      keptDigests.set(slot.groupKey, groupDigests)
      const digest = trimmedDigest(outcome.content)
      const earlier = groupDigests.get(digest)
      if (earlier !== undefined) {
        duplicates.set(slot.path, earlier)
      } else {
        groupDigests.set(digest, slot.displayPath)
      }
    }
  }

  const { fileViews, render } = classifySlots(discovery.groups, scope, contents, readErrors, overSourceLimit, duplicates)
  const viewByPath = new Map(fileViews.map(view => [view.path, view]))
  const groups: AgentInstructionGroupView[] = discovery.groups.map(group => ({
    key: group.key,
    scope: group.scope,
    directory: group.directory,
    displayDirectory: group.displayDirectory,
    isProjectRoot: group.isProjectRoot,
    isCwd: group.isCwd,
    files: group.slots.flatMap(slot => {
      const view = viewByPath.get(slot.path)
      return view === undefined ? [] : [view]
    }),
  }))

  let preview: string | null = null
  if (render !== null && render.text !== '') {
    if (byteLength(render.text) <= MAX_AGENT_PREVIEW_BYTES) preview = render.text
    else warnings.push('the rendered baseline exceeds the preview cap; the preview is omitted')
  }

  const budget: AgentsBudgetView = {
    maxBytes: scope.config?.maxBytes ?? null,
    maxSourceBytes: scope.config?.maxSourceBytes ?? null,
    renderedBytes: render === null ? 0 : byteLength(render.text),
    loadedFileCount: render === null ? 0 : render.represented.length,
    omitted: render?.omitted.map(item => item.displayPath) ?? [],
    truncated: render?.truncated.map(item => ({ displayPath: item.displayPath, originalBytes: item.originalBytes, includedBytes: item.includedBytes })) ?? [],
  }

  return {
    cwd: scope.cwd,
    cwdSource: scope.cwdSource,
    projectRoot: scope.projectRoot,
    sessionId: scope.sessionId,
    presetId: scope.presetId,
    row: scope.row,
    enabled: scope.enabled,
    reason: scope.reason,
    groups,
    budget,
    preview,
    warnings,
    collectedAt: Date.now(),
  }
}

/** Re-export the entry shape used by callers that build the scope options. */
export type { AgentInstructionRowView, AgentInstructionsConfig }