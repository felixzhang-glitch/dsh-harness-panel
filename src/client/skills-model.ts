/**
 * Pure merge/filter helpers for the Skills page: the session catalog's
 * enabled skills and the host's persisted disabled records become one sorted
 * row list, so a disabled skill stays visible with an off switch.
 *
 * @module dsh-harness-panel/client/skills-model
 */

/** The fields the session `skills` Remote returns. */
export interface SkillEntryLike {
  readonly path?: string
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
}

/** One disabled record returned by `GET /harness-panel/skills`. */
export interface DisabledSkillLike {
  readonly name: string
  readonly description: string
  readonly path?: string
  readonly whenToUse?: string
  readonly modelInvocable: boolean
  readonly disabledAt: number
}

/** One rendered skill row. */
export interface SkillRow {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly path?: string
  readonly modelInvocable: boolean
  readonly enabled: boolean
  readonly disabledAt?: number
}

/** The POST body one switch sends. */
export interface SkillToggleBody {
  readonly name: string
  readonly enabled: boolean
  readonly description?: string
  readonly path?: string
  readonly whenToUse?: string
  readonly modelInvocable?: boolean
}

/** Stable code-point order shared with the host. */
function compareName(left: { readonly name: string }, right: { readonly name: string }): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/**
 * Merge enabled and disabled skills by name. An enabled row wins a duplicate:
 * the gate may be shadowed by a preset layer, and the live catalog is the
 * truth. Disabled records fill the names the catalog no longer returns.
 *
 * @param enabled - user-invocable skills from the session catalog.
 * @param disabled - persisted disabled records from the host.
 * @returns sorted rows with a boolean enablement flag.
 */
export function mergeSkillRows(
  enabled: readonly SkillEntryLike[],
  disabled: readonly DisabledSkillLike[],
): SkillRow[] {
  const byName = new Map<string, SkillRow>()
  for (const skill of enabled) {
    byName.set(skill.name, {
      name: skill.name,
      description: skill.description,
      ...(skill.path === undefined ? {} : { path: skill.path }),
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      modelInvocable: skill.modelInvocable,
      enabled: true,
    })
  }
  for (const skill of disabled) {
    if (byName.has(skill.name)) continue
    byName.set(skill.name, {
      name: skill.name,
      description: skill.description,
      ...(skill.path === undefined ? {} : { path: skill.path }),
      ...(skill.whenToUse === undefined ? {} : { whenToUse: skill.whenToUse }),
      modelInvocable: skill.modelInvocable,
      enabled: false,
      disabledAt: skill.disabledAt,
    })
  }
  return [...byName.values()].sort(compareName)
}

/**
 * Case-insensitive name/description/whenToUse filter.
 *
 * @param rows - merged rows.
 * @param query - raw search text.
 * @returns matching rows in the input order.
 */
export function filterSkillRows(rows: readonly SkillRow[], query: string): SkillRow[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter(row => row.name.toLowerCase().includes(needle)
    || row.description.toLowerCase().includes(needle)
    || (row.whenToUse ?? '').toLowerCase().includes(needle))
}

/**
 * Build the toggle request: enabling needs only the name; disabling carries
 * the metadata the panel will keep showing while the gate hides the skill.
 *
 * @param row - the row being switched.
 * @param enabled - desired state.
 * @returns the POST body.
 */
export function skillToggleBody(row: SkillRow, enabled: boolean): SkillToggleBody {
  if (enabled) return { name: row.name, enabled: true }
  return {
    name: row.name,
    enabled: false,
    description: row.description,
    ...(row.path === undefined ? {} : { path: row.path }),
    ...(row.whenToUse === undefined ? {} : { whenToUse: row.whenToUse }),
    modelInvocable: row.modelInvocable,
  }
}
