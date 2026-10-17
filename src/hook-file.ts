/**
 * Per-hook enable/disable inside one bridge's config file.
 *
 * The bridges parse their config once at load and run only `type: "command"`
 * hooks; every other type is parsed-and-skipped. Turning one hook off is
 * therefore a one-field edit — `type: "disabled"` — that the provider's own
 * parser honors, with the original `type` recorded for a byte-faithful
 * restore. A hook whose file declared no `type` (command is the default)
 * gets the field removed again on enable.
 *
 * The editor preserves the file's shape: it reads the JSON, walks to the
 * named event → matcher group → command hook, mutates only that hook's
 * `type`, and writes back with the same indentation.
 *
 * @module dsh-harness-panel/hook-file
 */

import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from './atomic.ts'

/** The sentinel `type` value that makes a bridge skip one hook. */
export const HOOK_DISABLED_TYPE = 'disabled'

/** The `type` value the bridges run. */
export const HOOK_COMMAND_TYPE = 'command'

/** Why a hook edit was refused, with the HTTP status the route answers. */
export class HookFileError extends Error {
  /**
   * @param status - 400 for a hook the file does not carry, 500 for an unreadable or unwritable file.
   * @param message - human-readable reason.
   */
  constructor(readonly status: 400 | 500, message: string) {
    super(message)
    this.name = 'HookFileError'
  }
}

/** One validated per-hook toggle request. */
export interface HookToggleRequest {
  /** The bridge loader entry's short row id. */
  readonly bridge: string
  readonly event: string
  /** The group's matcher as written in the file; null when the group declares none. */
  readonly matcher: string | null
  readonly command: string
  readonly enabled: boolean
}

/** One hook's original `type` field state, captured at disable time. */
export interface HookEditResult {
  /** The `type` value the file declared; undefined when the field was absent (command is the default). */
  readonly originalType?: string
}

/** A parsed hooks config: a settings object with a `hooks` key, or the bare event map. */
interface HooksDocument {
  root: Record<string, unknown>
  /** The event map object, the same reference the writer serializes. */
  events: Record<string, unknown>
}

/** C0 controls except tab and newline; stored strings must stay one line. */
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu

/**
 * Read and split one hooks config file.
 *
 * @param path - absolute config path.
 * @param allowMissing - return undefined instead of throwing when the file is gone.
 * @returns the document, or undefined for a missing file when allowed.
 * @throws HookFileError when the file is unreadable or holds no event map.
 */
/** The matcher groups of one event, when the file carries them as an array. */
function groupsOf(document: HooksDocument, event: string): Array<Record<string, unknown>> {
  const raw = document.events[event]
  if (!Array.isArray(raw)) return []
  const groups: Array<Record<string, unknown>> = []
  for (const item of raw) {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) groups.push(item as Record<string, unknown>)
  }
  return groups
}

/** Whether a group's matcher equals the requested one, normalizing absent vs null. */
function matcherMatches(group: Record<string, unknown>, matcher: string | null): boolean {
  const raw = group['matcher']
  if (matcher === null) return raw === undefined || raw === null || raw === '*' || raw === ''
  return raw === matcher
}

/** The command hooks of one group. */
function hooksOf(group: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = group['hooks']
  if (!Array.isArray(raw)) return []
  const hooks: Array<Record<string, unknown>> = []
  for (const item of raw) {
    if (typeof item === 'object' && item !== null && !Array.isArray(item)) hooks.push(item as Record<string, unknown>)
  }
  return hooks
}

/**
 * Locate one hook by event, matcher, and command.
 *
 * @param document - parsed hooks document.
 * @param request - the toggle request.
 * @param path - absolute path, for error messages.
 * @returns the hook object.
 * @throws HookFileError when the file carries no such hook.
 */
function findHook(document: HooksDocument, request: { event: string; matcher: string | null; command: string }, path: string): Record<string, unknown> {
  const groups = groupsOf(document, request.event)
  if (groups.length === 0) {
    throw new HookFileError(400, `${path} carries no "${request.event}" groups`)
  }
  for (const group of groups) {
    if (!matcherMatches(group, request.matcher)) continue
    for (const hook of hooksOf(group)) {
      if (hook['command'] === request.command) return hook
    }
  }
  throw new HookFileError(400, `${path} carries no "${request.event}" hook running ${JSON.stringify(request.command)}`)
}

/**
 * Write the document back with two-space indentation, preserving the file's
 * trailing-newline convention.
 *
 * @param path - absolute config path.
 * @param document - parsed document.
 */
async function writeHooksDocument(path: string, document: HooksDocument, trailingNewline: boolean): Promise<void> {
  const text = JSON.stringify(document.root, null, 2)
  try {
    await writeFileAtomic(path, trailingNewline ? `${text}\n` : text, 0o644)
  } catch (error) {
    throw new HookFileError(500, `could not write ${path}: ${messageOf(error)}`)
  }
}

/** Read the file's trailing-newline convention alongside the document. */
async function readDocumentWithNewline(path: string, allowMissing = false): Promise<{ document: HooksDocument; trailingNewline: boolean } | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new HookFileError(500, `could not read ${path}: ${messageOf(error)}`)
  }
  const document = await (async (): Promise<HooksDocument> => {
    let root: unknown
    try {
      root = JSON.parse(text) as unknown
    } catch (error) {
      throw new HookFileError(500, `could not parse ${path}: ${messageOf(error)}`)
    }
    if (typeof root !== 'object' || root === null || Array.isArray(root)) {
      throw new HookFileError(500, `${path} is not a JSON object`)
    }
    const wrapped = (root as Record<string, unknown>)['hooks']
    const events = typeof wrapped === 'object' && wrapped !== null && !Array.isArray(wrapped)
      ? wrapped as Record<string, unknown>
      : root as Record<string, unknown>
    return { root: root as Record<string, unknown>, events }
  })()
  return { document, trailingNewline: text.endsWith('\n') }
}

/**
 * Disable one hook in its bridge's config file by setting its `type` to the
 * sentinel the bridges skip.
 *
 * @param path - absolute config path.
 * @param request - the toggle request.
 * @returns the hook's original `type` state for a later restore.
 * @throws HookFileError when the file cannot be read, parsed, matched, or written.
 */
export async function disableHookFile(path: string, request: HookToggleRequest): Promise<HookEditResult> {
  const loaded = await readDocumentWithNewline(path)
  if (loaded === undefined) throw new HookFileError(500, `could not read ${path}`)
  const hook = findHook(loaded.document, request, path)
  const hasType = Object.hasOwn(hook, 'type')
  const originalType = hasType && typeof hook['type'] === 'string' ? hook['type'] : undefined
  if (hook['type'] !== HOOK_DISABLED_TYPE) {
    hook['type'] = HOOK_DISABLED_TYPE
    await writeHooksDocument(path, loaded.document, loaded.trailingNewline)
  }
  return { ...(originalType === undefined ? {} : { originalType }) }
}

/**
 * Re-enable one hook, restoring the recorded original `type` state. An
 * unrecorded original (the file declared no `type`) removes the field again.
 * A file that no longer exists is a config deleted with the hook: there is
 * nothing to restore, so the call succeeds without touching anything.
 *
 * @param path - absolute config path.
 * @param request - the toggle request.
 * @param originalType - the `type` value captured at disable time; absent when the file declared none.
 * @throws HookFileError when the file cannot be read, parsed, matched, or written.
 */
export async function enableHookFile(path: string, request: HookToggleRequest, originalType: string | undefined): Promise<void> {
  const loaded = await readDocumentWithNewline(path, true)
  if (loaded === undefined) return
  const hook = findHook(loaded.document, request, path)
  if (originalType === undefined || originalType === '') delete hook['type']
  else hook['type'] = originalType
  await writeHooksDocument(path, loaded.document, loaded.trailingNewline)
}

/**
 * Validate one POSTed per-hook toggle request.
 *
 * @param raw - parsed JSON request body.
 * @returns the normalized request, or undefined when it is malformed.
 */
export function parseHookToggleRequest(raw: unknown): HookToggleRequest | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  const bridge = typeof row['bridge'] === 'string' ? row['bridge'].replace(CONTROL_CHARS, '').trim().slice(0, 200) : ''
  const event = typeof row['event'] === 'string' ? row['event'].replace(CONTROL_CHARS, '').trim().slice(0, 100) : ''
  const command = typeof row['command'] === 'string' ? row['command'].replace(CONTROL_CHARS, '').trim().slice(0, 2000) : ''
  const enabled = row['enabled']
  if (bridge === '' || event === '' || command === '' || typeof enabled !== 'boolean') return undefined
  const matcherRaw = row['matcher']
  if (matcherRaw !== null && typeof matcherRaw !== 'string') return undefined
  const matcher = matcherRaw === null ? null : (matcherRaw as string).replace(CONTROL_CHARS, '').trim().slice(0, 500)
  return { bridge, event, matcher, command, enabled }
}

/** Render a non-Error throw without coercing hostile values twice. */
function messageOf(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    return '<unrenderable error>'
  }
}
