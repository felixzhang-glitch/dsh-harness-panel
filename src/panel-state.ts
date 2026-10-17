/**
 * Panel state persistence for skill toggles (version 2 onward) and per-hook
 * toggles (version 3). A skill toggle records the original frontmatter
 * invocation lines of the skill file it disabled; a hook toggle records the
 * original `type` field of one hook command in a bridge's config file.
 * Version 1 records (the withdrawn registry-gate design, which never touched
 * files) are dropped at load time: their skills were never actually
 * disabled, so the panel simply stops listing them.
 *
 * The file holds display metadata plus those recorded original values only.
 * Skill bodies and credentials never enter it.
 *
 * @module dsh-harness-panel/panel-state
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic.ts'
import { isSkillName, type OriginalInvocationLines } from './skill-file.ts'

/** The state schema version this build reads and writes. */
export const PANEL_STATE_VERSION = 3

/** Hard cap on persisted disabled-skill records. */
export const MAX_DISABLED_SKILLS = 500

/** Hard cap on persisted per-hook toggle records. */
export const MAX_HOOK_TOGGLES = 500

/** One persisted disabled skill. */
export interface DisabledSkillRecord {
  readonly name: string
  readonly description: string
  /** Absolute SKILL.md path whose frontmatter carries the disable flags. */
  readonly path: string
  readonly whenToUse?: string
  /** The skill's original model policy, kept for display. */
  readonly modelInvocable: boolean
  /** Epoch ms of the disable request. */
  readonly disabledAt: number
  /** The two invocation lines as they were before the edit. */
  readonly original: OriginalInvocationLines
}

/** One persisted per-hook toggle: a single hook command turned off in its bridge's config file. */
export interface HookToggleRecord {
  /** The bridge loader entry's short row id. */
  readonly bridge: string
  /** The bridge's config file, recorded so enable can find it without the loader. */
  readonly configPath: string
  /** Event name as written in the file. */
  readonly event: string
  /** The group's matcher as written in the file; null when the group declares none. */
  readonly matcher: string | null
  /** The hook's command line, verbatim from the file. */
  readonly command: string
  /** The hook's original `type` value; absent when the file declared no `type` (defaults to command). */
  readonly originalType?: string
  /** Epoch ms of the disable request. */
  readonly disabledAt: number
}

/** The persisted panel state. */
export interface PanelState {
  readonly version: 3
  readonly disabledSkills: Map<string, DisabledSkillRecord>
  readonly hookToggles: Map<string, HookToggleRecord>
}

/** The stable key of one per-hook toggle record. */
export function hookToggleKey(record: {
  readonly bridge: string
  readonly event: string
  readonly matcher: string | null
  readonly command: string
}): string {
  return JSON.stringify([record.bridge, record.event, record.matcher, record.command])
}

/** Default state location under the DSH home. */
export function resolvePanelStatePath(dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')): string {
  return join(dshHome, 'harness-panel', 'state.json')
}

/** An empty state, used for a missing or unreadable state file. */
export function emptyPanelState(): PanelState {
  return { version: PANEL_STATE_VERSION, disabledSkills: new Map(), hookToggles: new Map() }
}

/** Stable code-point name order for wire and file output. */
function compareName(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/** Disabled records sorted by name, as the routes and the file emit them. */
export function disabledSkillRecords(state: PanelState): DisabledSkillRecord[] {
  return [...state.disabledSkills.values()].sort(compareName)
}

/** Hook toggles sorted by bridge then event, as the routes and the file emit them. */
export function hookToggleRecords(state: PanelState): HookToggleRecord[] {
  return [...state.hookToggles.values()].sort((left, right) =>
    left.bridge < right.bridge ? -1 : left.bridge > right.bridge ? 1
      : left.event < right.event ? -1 : left.event > right.event ? 1 : 0)
}

/**
 * Validate and normalize one persisted disabled-skill record. Records without
 * restore information are rejected — a disable that never captured the
 * original lines cannot be undone safely.
 *
 * @param raw - untrusted state-file value.
 * @returns the normalized record, or undefined when it is malformed.
 */
export function normalizeDisabledSkill(raw: unknown): DisabledSkillRecord | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  const name = row['name']
  if (!isSkillName(name)) return undefined
  const description = typeof row['description'] === 'string' ? row['description'].replace(/\s+/gu, ' ').trim() : ''
  const path = typeof row['path'] === 'string' ? row['path'].replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim() : ''
  const whenToUse = typeof row['whenToUse'] === 'string' ? row['whenToUse'].replace(/\s+/gu, ' ').trim() : ''
  const modelInvocable = typeof row['modelInvocable'] === 'boolean' ? row['modelInvocable'] : true
  const disabledAt = typeof row['disabledAt'] === 'number'
    && Number.isFinite(row['disabledAt'])
    && row['disabledAt'] >= 0
    ? Math.floor(row['disabledAt'])
    : 0
  const originalRaw = row['original']
  if (typeof originalRaw !== 'object' || originalRaw === null || Array.isArray(originalRaw)) return undefined
  const originalRow = originalRaw as Record<string, unknown>
  const original: { userInvocable?: string; disableModelInvocation?: string } = {}
  if (typeof originalRow['userInvocable'] === 'string' && originalRow['userInvocable'] !== '') {
    original.userInvocable = originalRow['userInvocable']
  }
  if (typeof originalRow['disableModelInvocation'] === 'string' && originalRow['disableModelInvocation'] !== '') {
    original.disableModelInvocation = originalRow['disableModelInvocation']
  }
  if (Object.keys(original).length === 0) return undefined
  return {
    name,
    description: description === '' ? name : description.slice(0, 500),
    path: path.slice(0, 1000),
    ...(whenToUse === '' ? {} : { whenToUse: whenToUse.slice(0, 1000) }),
    modelInvocable,
    disabledAt,
    original,
  }
}

/** Bound one display string from an untrusted state value. */
function cleanText(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim().slice(0, limit) : ''
}

/**
 * Validate and normalize one persisted per-hook toggle record.
 *
 * @param raw - untrusted state-file value.
 * @returns the normalized record, or undefined when it is malformed.
 */
export function normalizeHookToggle(raw: unknown): HookToggleRecord | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  const bridge = cleanText(row['bridge'], 200)
  const configPath = cleanText(row['configPath'], 1000)
  const event = cleanText(row['event'], 100)
  const command = cleanText(row['command'], 2000)
  if (bridge === '' || configPath === '' || event === '' || command === '') return undefined
  const matcherRaw = row['matcher']
  const matcher = matcherRaw === null ? null : typeof matcherRaw === 'string' ? cleanText(matcherRaw, 500) : undefined
  if (matcher === undefined) return undefined
  const disabledAt = typeof row['disabledAt'] === 'number'
    && Number.isFinite(row['disabledAt'])
    && row['disabledAt'] >= 0
    ? Math.floor(row['disabledAt'])
    : 0
  const originalType = row['originalType'] === undefined ? undefined : cleanText(row['originalType'], 100)
  return {
    bridge,
    configPath,
    event,
    matcher,
    command,
    ...(originalType === undefined || originalType === '' ? {} : { originalType }),
    disabledAt,
  }
}

/**
 * Parse one persisted state document. Malformed records are skipped rather
 * than failing the whole file; the first record wins a duplicate key.
 *
 * @param raw - parsed JSON value.
 * @returns a normalized state (never throws).
 */
export function parsePanelState(raw: unknown): PanelState {
  const state = emptyPanelState()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return state
  const record = raw as Record<string, unknown>
  const skills = record['disabledSkills']
  if (Array.isArray(skills)) {
    for (const item of skills) {
      const normalized = normalizeDisabledSkill(item)
      if (normalized === undefined) continue
      if (!state.disabledSkills.has(normalized.name) && state.disabledSkills.size >= MAX_DISABLED_SKILLS) continue
      if (!state.disabledSkills.has(normalized.name)) state.disabledSkills.set(normalized.name, normalized)
    }
  }
  const hooks = record['hookToggles']
  if (Array.isArray(hooks)) {
    for (const item of hooks) {
      const normalized = normalizeHookToggle(item)
      if (normalized === undefined) continue
      const key = hookToggleKey(normalized)
      if (!state.hookToggles.has(key) && state.hookToggles.size >= MAX_HOOK_TOGGLES) continue
      if (!state.hookToggles.has(key)) state.hookToggles.set(key, normalized)
    }
  }
  return state
}

/** Serialize the state deterministically (sorted records, trailing newline). */
export function serializePanelState(state: PanelState): string {
  return `${JSON.stringify({
    version: PANEL_STATE_VERSION,
    disabledSkills: disabledSkillRecords(state),
    hookToggles: hookToggleRecords(state),
  }, null, 2)}\n`
}

/** One loaded state plus an optional non-fatal read/parse warning. */
export interface LoadedPanelState {
  readonly state: PanelState
  readonly warning: string | null
}

/**
 * Read the state file synchronously at plugin apply time.
 *
 * A missing file is normal (nothing disabled yet). Any other failure starts
 * with an empty state and reports a warning, so a damaged file never keeps
 * the panel from mounting.
 *
 * @param path - absolute state-file path.
 * @returns the parsed state and an optional warning.
 */
export function loadPanelStateFile(path: string): LoadedPanelState {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { state: emptyPanelState(), warning: null }
    }
    return { state: emptyPanelState(), warning: `could not read ${path}: ${messageOf(error)}` }
  }
  let raw: unknown
  try {
    raw = JSON.parse(text) as unknown
  } catch (error) {
    return { state: emptyPanelState(), warning: `could not parse ${path}: ${messageOf(error)}` }
  }
  return { state: parsePanelState(raw), warning: null }
}

/**
 * Write the state atomically.
 *
 * @param path - absolute state-file path.
 * @param state - state to persist.
 */
export async function savePanelStateFile(path: string, state: PanelState): Promise<void> {
  await writeFileAtomic(path, serializePanelState(state))
}

/** Render a non-Error throw without coercing hostile values twice. */
function messageOf(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable error>'
  }
}
