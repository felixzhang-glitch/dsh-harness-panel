/**
 * Hooks page data: enumerate the loader's hook bridge rows
 * (`@deepseek-ai/dsh-hooks-claude-code` / `@deepseek-ai/dsh-hooks-codex`),
 * parse each row's `configPath` file into a display view, and scan
 * conventional on-disk locations for hook configuration that exists but is
 * NOT mounted into DSH. Parsing and scanning write no file; the panel's
 * bridge switch is a separate browser action over the shipped
 * `pluginManager` Remote, which stops or restarts the loader row.
 *
 * The display parser is deliberately lenient: it walks any event key the
 * file carries (both dialects share the matcher-group shape), keeps command
 * hooks verbatim (no `${CLAUDE_*}` substitution — this is a display of what
 * is configured, not an execution), and collects non-command hooks as
 * skipped instead of failing.
 *
 * @module dsh-harness-panel/hooks
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { sanitizeError } from './sanitize.ts'

/** The claude-code hook bridge module name on loader rows. */
export const HOOKS_CLAUDE_CODE_MODULE = '@deepseek-ai/dsh-hooks-claude-code'

/** The codex hook bridge module name on loader rows. */
export const HOOKS_CODEX_MODULE = '@deepseek-ai/dsh-hooks-codex'

/** One configured command hook in display form. */
export interface HookCommandView {
  /** The shell command line, verbatim from the file (variables unexpanded). */
  readonly command: string
  /** Per-hook timeout in seconds; `null` when unset. */
  readonly timeoutSec: number | null
}

/** One matcher group: a `matcher` pattern plus its command hooks. */
export interface HookGroupView {
  /** The matcher pattern; `null` = match-all or absent. */
  readonly matcher: string | null
  readonly hooks: readonly HookCommandView[]
}

/** One hook event point with its matcher groups. */
export interface HookEventView {
  /** Event name as written in the file (PreToolUse, Stop, …). */
  readonly event: string
  readonly groups: readonly HookGroupView[]
}

/** A non-command hook the bridge would skip (prompt/agent/http types). */
export interface HookSkippedView {
  readonly event: string
  readonly type: string
}

/** One mounted hook bridge row with its parsed config file. */
export interface HookBridgeView {
  /** Loader entry id. */
  readonly entryId: string
  /** Which dialect bridge this row mounts. */
  readonly dialect: 'claude-code' | 'codex'
  /** The configured hooks file path (verbatim from the row config). */
  readonly configPath: string
  /** Effective loader disabled state. */
  readonly disabled: boolean
  readonly events: readonly HookEventView[]
  readonly skipped: readonly HookSkippedView[]
  /** Sanitized read/parse failure; `null` when the file parsed cleanly. */
  readonly parseError: string | null
}

/** One conventional on-disk location scanned for unmounted hook config. */
export interface HookDiscoveryView {
  readonly path: string
  readonly exists: boolean
  /** Event keys carrying at least one runnable command hook. */
  readonly eventCount: number
  /** Total runnable command hooks across events. */
  readonly hookCount: number
  readonly parseError: string | null
}

/** The full hooks page snapshot (wire shape). */
export interface HooksSnapshot {
  readonly mounted: readonly HookBridgeView[]
  readonly discovered: readonly HookDiscoveryView[]
  readonly collectedAt: number
}

/** The parsed outcome of one hooks file (shared by mounted and scanned rows). */
export interface ParsedHookFile {
  readonly events: readonly HookEventView[]
  readonly skipped: readonly HookSkippedView[]
}

/** A plain (non-null, non-array) object, else undefined. */
function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Parse either a settings `hooks` value or a bare event map into display
 * rows. Malformed entries are ignored rather than failing the page; hooks
 * whose `type` is not `command` are collected into `skipped`.
 */
export function parseHookFile(raw: unknown): ParsedHookFile {
  const root = asObject(raw)
  const hooksMap = root === undefined ? undefined : asObject(root['hooks']) ?? root
  const events: HookEventView[] = []
  const skipped: HookSkippedView[] = []
  if (hooksMap === undefined) return { events, skipped }
  for (const [event, rawGroups] of Object.entries(hooksMap)) {
    if (!Array.isArray(rawGroups)) continue
    const groups: HookGroupView[] = []
    for (const rawGroup of rawGroups) {
      const group = asObject(rawGroup)
      if (group === undefined || !Array.isArray(group['hooks'])) continue
      const commands: HookCommandView[] = []
      for (const rawHook of group['hooks']) {
        const hook = asObject(rawHook)
        if (hook === undefined) continue
        const type = typeof hook['type'] === 'string' ? hook['type'] : 'command'
        if (type !== 'command') {
          skipped.push({ event, type })
          continue
        }
        const command = hook['command']
        if (typeof command !== 'string' || command === '') continue
        const timeout = hook['timeout']
        commands.push({
          command,
          timeoutSec: typeof timeout === 'number' && Number.isFinite(timeout) ? timeout : null,
        })
      }
      if (commands.length === 0) continue
      const matcher = group['matcher']
      groups.push({
        matcher: typeof matcher === 'string' && matcher !== '' && matcher !== '*' ? matcher : null,
        hooks: commands,
      })
    }
    if (groups.length > 0) events.push({ event, groups })
  }
  return { events, skipped }
}

/** Read and parse one hooks file; failures surface as a sanitized string. */
export async function readHookFile(path: string): Promise<{ parsed: ParsedHookFile; parseError: string | null }> {
  let rawText: string
  try {
    rawText = await readFile(path, 'utf8')
  } catch (error) {
    return { parsed: { events: [], skipped: [] }, parseError: sanitizeError(error) }
  }
  try {
    return { parsed: parseHookFile(JSON.parse(rawText)), parseError: null }
  } catch (error) {
    return { parsed: { events: [], skipped: [] }, parseError: sanitizeError(error) }
  }
}

/** The loader row shape this module reads (structural; no cordis import). */
export interface HookLoaderRow {
  readonly entryId: string
  readonly moduleName: string
  readonly disabled: boolean
  readonly config: unknown
}

/** Dialect of one loader row; `undefined` when the row is no hook bridge. */
export function dialectOf(moduleName: string): 'claude-code' | 'codex' | undefined {
  if (moduleName === HOOKS_CLAUDE_CODE_MODULE) return 'claude-code'
  if (moduleName === HOOKS_CODEX_MODULE) return 'codex'
  return undefined
}

/** Assemble the mounted-bridge view of one loader row. */
export async function bridgeViewOf(row: HookLoaderRow): Promise<HookBridgeView | undefined> {
  const dialect = dialectOf(row.moduleName)
  if (dialect === undefined) return undefined
  const config = asObject(row.config)
  const configPath = typeof config?.['configPath'] === 'string' ? config['configPath'] : ''
  if (configPath === '') {
    return {
      entryId: row.entryId,
      dialect,
      configPath: '',
      disabled: row.disabled,
      events: [],
      skipped: [],
      parseError: 'row has no configPath',
    }
  }
  const { parsed, parseError } = await readHookFile(configPath)
  return {
    entryId: row.entryId,
    dialect,
    configPath,
    disabled: row.disabled,
    events: parsed.events,
    skipped: parsed.skipped,
    parseError,
  }
}

/** Conventional hook config locations scanned read-only (never mounted here). */
export function conventionalHookPaths(cwd: string): readonly string[] {
  const home = homedir()
  return [
    join(home, '.claude', 'settings.json'),
    join(home, '.claude', 'hooks.json'),
    join(home, '.codex', 'hooks.json'),
    join(cwd, '.claude', 'settings.json'),
    join(cwd, '.claude', 'hooks.json'),
    join(cwd, '.codex', 'hooks.json'),
  ]
}

/** Scan one conventional location; a missing file reads `exists: false`. */
export async function scanHookPath(path: string): Promise<HookDiscoveryView> {
  let rawText: string
  try {
    rawText = await readFile(path, 'utf8')
  } catch {
    return { path, exists: false, eventCount: 0, hookCount: 0, parseError: null }
  }
  try {
    const parsed = parseHookFile(JSON.parse(rawText))
    const hookCount = parsed.events.reduce(
      (sum, event) => sum + event.groups.reduce((inner, group) => inner + group.hooks.length, 0),
      0,
    )
    return { path, exists: true, eventCount: parsed.events.length, hookCount, parseError: null }
  } catch (error) {
    return { path, exists: true, eventCount: 0, hookCount: 0, parseError: sanitizeError(error) }
  }
}
