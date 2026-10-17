/**
 * Panel state persistence for skill toggles. Version 2 records carry the
 * original frontmatter invocation lines needed to restore a disabled skill's
 * file. Version 1 records (the withdrawn registry-gate design, which never
 * touched files) are dropped at load time: their skills were never actually
 * disabled, so the panel simply stops listing them.
 *
 * The file holds display metadata plus those two recorded lines only. Skill
 * bodies never enter it.
 *
 * @module dsh-harness-panel/skill-state
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { writeFileAtomic } from './atomic.ts'
import {
  isSkillName,
  type OriginalInvocationLines,
} from './skill-file.ts'

/** The state schema version this build reads and writes. */
export const PANEL_STATE_VERSION = 2

/** Hard cap on persisted disabled-skill records. */
export const MAX_DISABLED_SKILLS = 500

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

/** The persisted panel state. */
export interface PanelState {
  readonly version: 2
  readonly disabledSkills: Map<string, DisabledSkillRecord>
}

/** Default state location under the DSH home. */
export function resolvePanelStatePath(dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')): string {
  return join(dshHome, 'harness-panel', 'state.json')
}

/** An empty state, used for a missing or unreadable state file. */
export function emptyPanelState(): PanelState {
  return { version: PANEL_STATE_VERSION, disabledSkills: new Map() }
}

/** Stable code-point name order for wire and file output. */
function compareName(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/** Disabled records sorted by name, as the routes and the file emit them. */
export function disabledSkillRecords(state: PanelState): DisabledSkillRecord[] {
  return [...state.disabledSkills.values()].sort(compareName)
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

/**
 * Parse one persisted state document. Malformed records are skipped rather
 * than failing the whole file; the first record wins a duplicate name.
 *
 * @param raw - parsed JSON value.
 * @returns a normalized state (never throws).
 */
export function parsePanelState(raw: unknown): PanelState {
  const state = emptyPanelState()
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return state
  const record = raw as Record<string, unknown>
  const list = record['disabledSkills']
  if (!Array.isArray(list)) return state
  for (const item of list) {
    const normalized = normalizeDisabledSkill(item)
    if (normalized === undefined) continue
    if (!state.disabledSkills.has(normalized.name) && state.disabledSkills.size >= MAX_DISABLED_SKILLS) continue
    if (!state.disabledSkills.has(normalized.name)) state.disabledSkills.set(normalized.name, normalized)
  }
  return state
}

/** Serialize the state deterministically (sorted records, trailing newline). */
export function serializePanelState(state: PanelState): string {
  return `${JSON.stringify({ version: PANEL_STATE_VERSION, disabledSkills: disabledSkillRecords(state) }, null, 2)}\n`
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
