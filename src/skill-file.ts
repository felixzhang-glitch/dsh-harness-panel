/**
 * File-level skill enable/disable.
 *
 * The skill registry's layers are host+per-scope, and every agent preset
 * mounts its own `skill-filesystem` provider into its scope layer, where a
 * same-name entry outranks anything registered in the global layer. A global
 * shadow provider therefore cannot disable a preset-visible skill. The one
 * mechanism that works at every layer is the provider's own contract: the
 * frontmatter keys `user-invocable: false` and
 * `disable-model-invocation: true` remove the skill from both the user `/`
 * menu and the model catalog regardless of which layer's provider reads the
 * file, and the filesystem watcher re-publishes the catalog automatically.
 *
 * The editor is line-oriented and zero-dependency: it locates the leading
 * YAML frontmatter block, records the original lines of the two invocation
 * keys for a byte-faithful restore, and rewrites only those lines.
 *
 * @module dsh-harness-panel/skill-file
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.ts'

/** The provider's frontmatter key controlling the user `/` menu. */
export const USER_INVOCABLE_KEY = 'user-invocable'

/** The provider's frontmatter key controlling the model catalog. */
export const DISABLE_MODEL_KEY = 'disable-model-invocation'

/** One invocation key's original frontmatter line; absent when the file never declared it. */
export interface OriginalInvocationLines {
  /** Original `user-invocable` line verbatim, absent when the key was not declared. */
  readonly userInvocable?: string
  /** Original `disable-model-invocation` line verbatim, absent when the key was not declared. */
  readonly disableModelInvocation?: string
}

/** The file-side facts one disable leaves behind, for display and restore. */
export interface SkillFileEdit {
  /** Kebab-case skill name read from the file's frontmatter. */
  readonly name: string
  /** The two invocation lines as they were before the edit. */
  readonly original: OriginalInvocationLines
}

/** One validated toggle request. `disable` carries the file target and display metadata. */
export interface SkillToggleRequest {
  readonly name: string
  readonly enabled: boolean
  readonly disable?: {
    readonly name: string
    readonly description: string
    readonly path: string
    readonly whenToUse?: string
    readonly modelInvocable: boolean
  }
}

/** Why a file edit was refused, with the HTTP status the route answers. */
export class SkillFileError extends Error {
  /**
   * @param status - 400 for a mismatched file, 500 for an unreadable or unwritable one.
   * @param message - human-readable reason.
   */
  constructor(readonly status: 400 | 500, message: string) {
    super(message)
    this.name = 'SkillFileError'
  }
}

/** Kebab-case skill-name grammar, shared with the skill registry. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** C0 controls except tab and newline; a stored path must stay one line. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu

/** A frontmatter line declaring one key, capturing its indentation. */
function keyLinePattern(key: string): RegExp {
  return new RegExp(`^(\\s*)${key}\\s*:`)
}

/** Whether a line declares one invocation key. */
function isKeyLine(line: string, key: string): boolean {
  return keyLinePattern(key).test(line)
}

/** The scalar value of a frontmatter line, unquoted. */
function lineValue(line: string): string {
  const colon = line.indexOf(':')
  const raw = colon < 0 ? '' : line.slice(colon + 1).trim()
  if (raw.length >= 2 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
    return raw.slice(1, -1)
  }
  return raw
}

/** One skill file split into its frontmatter lines, body lines, and join separator. */
interface SkillDocument {
  /** Frontmatter lines between the two `---` fences. */
  readonly frontmatter: string[]
  /** Lines after the closing fence. */
  readonly body: string[]
}

/** Split a skill file around its leading YAML frontmatter block. */
function splitSkillDocument(text: string): SkillDocument | undefined {
  const lines = text.split('\n')
  if (lines[0]?.replace(/\r$/, '') !== '---') return undefined
  const close = lines.findIndex((line, index) => index > 0 && line.replace(/\r$/, '') === '---')
  if (close < 0) return undefined
  return { frontmatter: lines.slice(1, close), body: lines.slice(close + 1) }
}

/** The frontmatter's `name` value, when the file declares one. */
function frontmatterName(document: SkillDocument): string | undefined {
  for (const line of document.frontmatter) {
    if (keyLinePattern('name').test(line)) {
      const value = lineValue(line)
      return value === '' ? undefined : value
    }
  }
  return undefined
}

/**
 * Read and split one skill file.
 *
 * @param path - absolute SKILL.md path.
 * @param allowMissing - return undefined instead of throwing when the file is gone.
 * @returns the split document, or undefined for a missing file when allowed.
 * @throws SkillFileError when the file is unreadable or has no frontmatter.
 */
async function readSkillDocument(path: string, allowMissing = false): Promise<SkillDocument | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new SkillFileError(500, `could not read ${path}: ${messageOf(error)}`)
  }
  const document = splitSkillDocument(text)
  if (document === undefined) {
    throw new SkillFileError(400, `${path} has no YAML frontmatter block`)
  }
  return document
}

/**
 * Write the document back, preserving the original line structure.
 *
 * @param path - absolute SKILL.md path.
 * @param document - split document with edited frontmatter lines.
 */
async function writeSkillDocument(path: string, document: SkillDocument): Promise<void> {
  const text = ['---', ...document.frontmatter, '---', ...document.body].join('\n')
  try {
    await writeFileAtomic(path, text, 0o644)
  } catch (error) {
    throw new SkillFileError(500, `could not write ${path}: ${messageOf(error)}`)
  }
}

/**
 * Validate the file against the requested skill name.
 *
 * @param document - split document.
 * @param name - requested kebab-case skill name.
 * @param path - absolute path, for error messages.
 */
function assertNameMatches(document: SkillDocument, name: string, path: string): void {
  const declared = frontmatterName(document)
  if (declared === undefined) {
    throw new SkillFileError(400, `${path} declares no skill name`)
  }
  if (declared !== name) {
    throw new SkillFileError(400, `${path} declares skill "${declared}", not "${name}"`)
  }
}

/**
 * Disable one skill in its file: both invocation keys are set so the skill
 * leaves the user `/` menu and the model catalog in every scope layer.
 *
 * @param path - absolute SKILL.md path.
 * @param name - kebab-case skill name the file must declare.
 * @returns the original invocation lines for a later restore.
 * @throws SkillFileError when the file cannot be read, parsed, matched, or written.
 */
export async function disableSkillFile(path: string, name: string): Promise<SkillFileEdit> {
  const document = await readSkillDocument(path)
  if (document === undefined) {
    throw new SkillFileError(500, `could not read ${path}`)
  }
  assertNameMatches(document, name, path)
  const original: { userInvocable?: string; disableModelInvocation?: string } = {}
  const frontmatter = [...document.frontmatter]
  for (const [key, value] of [
    [USER_INVOCABLE_KEY, 'false'],
    [DISABLE_MODEL_KEY, 'true'],
  ] as const) {
    const index = frontmatter.findIndex(line => isKeyLine(line, key))
    if (index < 0) {
      frontmatter.push(`${key}: ${value}`)
      continue
    }
    const originalLine = frontmatter[index]!
    if (key === USER_INVOCABLE_KEY) original.userInvocable = originalLine
    else original.disableModelInvocation = originalLine
    const indent = /^(\s*)/.exec(originalLine)?.[1] ?? ''
    frontmatter[index] = `${indent}${key}: ${value}`
  }
  await writeSkillDocument(path, { frontmatter, body: document.body })
  return { name, original }
}

/**
 * Re-enable one skill in its file, restoring the recorded original lines.
 * An unrecorded key line (the file gained one while disabled) is removed; a
 * recorded line is restored verbatim, appended at the end of the frontmatter
 * when its line no longer exists. A file that no longer exists is a skill
 * deleted while disabled: there is nothing to restore, so the call succeeds
 * without touching anything and the caller drops its record.
 *
 * @param path - absolute SKILL.md path.
 * @param name - kebab-case skill name the file must declare.
 * @param original - the lines captured at disable time.
 * @throws SkillFileError when the file cannot be read, parsed, matched, or written.
 */
export async function enableSkillFile(path: string, name: string, original: OriginalInvocationLines): Promise<void> {
  const document = await readSkillDocument(path, true)
  if (document === undefined) return
  assertNameMatches(document, name, path)
  const frontmatter = [...document.frontmatter]
  const restore = (key: string, originalLine: string | undefined): void => {
    const index = frontmatter.findIndex(line => isKeyLine(line, key))
    if (originalLine === undefined) {
      if (index >= 0) frontmatter.splice(index, 1)
      return
    }
    if (index >= 0) frontmatter[index] = originalLine
    else frontmatter.push(originalLine)
  }
  restore(USER_INVOCABLE_KEY, original.userInvocable)
  restore(DISABLE_MODEL_KEY, original.disableModelInvocation)
  await writeSkillDocument(path, { frontmatter, body: document.body })
}

/** Whether a value is a valid kebab-case skill name. */
export function isSkillName(value: unknown): value is string {
  return typeof value === 'string' && SKILL_NAME.test(value)
}

/** Collapse whitespace for one-line display fields. */
function collapse(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

/** Keep a path one line without rewriting its interior spacing. */
function cleanPath(value: string): string {
  return value.replace(CONTROL_CHARS, '').trim()
}

/**
 * Validate one POSTed toggle request. A disable must carry the skill file
 * path the client read from the session catalog; an enable needs only the
 * name, because the recorded state names the file.
 *
 * @param raw - parsed JSON request body.
 * @returns the normalized request, or undefined when it is malformed.
 */
export function parseSkillToggleRequest(raw: unknown): SkillToggleRequest | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  const name = row['name']
  const enabled = row['enabled']
  if (!isSkillName(name) || typeof enabled !== 'boolean') return undefined
  if (enabled) return { name, enabled: true }
  const path = typeof row['path'] === 'string' ? cleanPath(row['path']) : ''
  if (path === '' || !path.endsWith('.md')) return undefined
  const description = typeof row['description'] === 'string' ? collapse(row['description']) : ''
  const whenToUse = typeof row['whenToUse'] === 'string' ? collapse(row['whenToUse']) : ''
  return {
    name,
    enabled: false,
    disable: {
      name,
      description: description === '' ? name : description.slice(0, 500),
      path: path.slice(0, 1000),
      ...(whenToUse === '' ? {} : { whenToUse: whenToUse.slice(0, 1000) }),
      modelInvocable: typeof row['modelInvocable'] === 'boolean' ? row['modelInvocable'] : true,
    },
  }
}

/** Render a non-Error throw without coercing hostile values twice. */
function messageOf(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable error>'
  }
}
