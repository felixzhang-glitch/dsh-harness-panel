/**
 * AGENTS.md instruction-file read/write, host side.
 *
 * One candidate file at a time. Reads are bounded and write paths go through
 * the panel's atomic writer; a write through a symbolic link lands on the
 * resolved target so `~/.dsh/AGENTS.md -> ~/.agents/AGENTS.md` keeps its link.
 * The client's `expectedMtimeMs` is the optimistic lock: a mismatch means the
 * file changed elsewhere and the write is refused with 409 instead of
 * clobbering it.
 *
 * @module dsh-harness-panel/agent-file
 */

import { lstat, readFile, realpath, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { writeFileAtomic } from './atomic.ts'
import {
  MAX_AGENT_FILE_BYTES,
  type AgentFileContent,
  type AgentFileWriteResult,
} from './agents-contract.ts'
import { sanitizeError } from './sanitize.ts'

/** A validated write request. */
export interface AgentWriteRequest {
  readonly sessionId?: string
  readonly cwd?: string
  /** Absolute candidate path as the snapshot reported it. */
  readonly path: string
  readonly content: string
  /** Current mtime the client saw, or null when it is creating a missing file. */
  readonly expectedMtimeMs: number | null
}

/** Why an instruction-file operation was refused, with the HTTP status to answer. */
export class AgentFileError extends Error {
  /**
   * @param status - 400 invalid/not-candidate, 404 missing, 409 stale, 413 too large, 500 I/O.
   * @param message - human-readable reason.
   */
  constructor(readonly status: 400 | 404 | 409 | 413 | 500, message: string) {
    super(message)
    this.name = 'AgentFileError'
  }
}

/** Render an arbitrary throw without coercing hostile values twice. */
function messageOf(error: unknown): string {
  try {
    return sanitizeError(error)
  } catch {
    return '<unrenderable error>'
  }
}

/** The error code of a filesystem failure. */
function codeOf(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

/** Normalize one absolute request path. */
function requestPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  if (value.length === 0 || value.length > 4096) return undefined
  if (/[\u0000-\u001f\u007f]/u.test(value)) return undefined
  if (!isAbsolute(value)) return undefined
  return resolve(value)
}

/** Normalize one optional request session id. */
function requestSessionId(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > 200) return undefined
  if (/[\u0000-\u001f\u007f]/u.test(trimmed)) return undefined
  return trimmed
}

/**
 * Validate one POSTed write request.
 *
 * @param raw - parsed JSON body.
 * @returns the normalized request, or undefined when malformed.
 */
export function parseAgentWriteRequest(raw: unknown): AgentWriteRequest | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined
  const row = raw as Record<string, unknown>
  const path = requestPath(row['path'])
  const content = row['content']
  if (path === undefined || typeof content !== 'string') return undefined
  const expectedRaw = row['expectedMtimeMs']
  const expectedMtimeMs = expectedRaw === null
    ? null
    : typeof expectedRaw === 'number' && Number.isFinite(expectedRaw) && expectedRaw >= 0
      ? expectedRaw
      : undefined
  if (expectedMtimeMs === undefined) return undefined
  const sessionId = requestSessionId(row['sessionId'] ?? row['session'])
  if (row['sessionId'] !== undefined && row['sessionId'] !== null && sessionId === undefined) return undefined
  if (row['session'] !== undefined && row['session'] !== null && sessionId === undefined) return undefined
  let cwd: string | undefined
  if (row['cwd'] !== undefined) {
    cwd = requestPath(row['cwd'])
    if (cwd === undefined) return undefined
  }
  return {
    path,
    content,
    expectedMtimeMs,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(cwd === undefined ? {} : { cwd }),
  }
}

/** Metadata plus the symlink target of one existing file. */
async function fileMetadata(path: string): Promise<{
  readonly realPath: string | null
  readonly symlink: boolean
  readonly sizeBytes: number
  readonly mtimeMs: number
}> {
  const info = await stat(path)
  if (!info.isFile()) throw new AgentFileError(400, `${path} is not a regular file`)
  let realPath: string | null = null
  try {
    realPath = await realpath(path)
  } catch {
    realPath = null
  }
  let symlink = false
  try {
    symlink = (await lstat(path)).isSymbolicLink()
  } catch {
    symlink = false
  }
  return { realPath, symlink, sizeBytes: info.size, mtimeMs: info.mtimeMs }
}

/**
 * Read one candidate instruction file.
 *
 * @param path - absolute candidate path.
 * @returns content plus metadata.
 * @throws AgentFileError on missing, non-regular, oversized, or unreadable files.
 */
export async function readAgentInstructionFile(path: string): Promise<AgentFileContent> {
  let linkInfo
  try {
    linkInfo = await lstat(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') throw new AgentFileError(404, `${path} does not exist`)
    throw new AgentFileError(500, `could not read ${path}: ${messageOf(error)}`)
  }
  if (!linkInfo.isFile() && !linkInfo.isSymbolicLink()) {
    throw new AgentFileError(400, `${path} is not a regular file`)
  }
  let info
  try {
    info = await stat(path)
  } catch (error) {
    if (codeOf(error) === 'ENOENT') throw new AgentFileError(404, `${path} is a dangling symbolic link`)
    throw new AgentFileError(500, `could not read ${path}: ${messageOf(error)}`)
  }
  if (!info.isFile()) throw new AgentFileError(400, `${path} is not a regular file`)
  if (info.size > MAX_AGENT_FILE_BYTES) {
    throw new AgentFileError(413, `${path} is larger than ${MAX_AGENT_FILE_BYTES} bytes`)
  }
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch (error) {
    throw new AgentFileError(500, `could not read ${path}: ${messageOf(error)}`)
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_AGENT_FILE_BYTES) {
    throw new AgentFileError(413, `${path} is larger than ${MAX_AGENT_FILE_BYTES} bytes`)
  }
  const metadata = await fileMetadata(path)
  return { path, ...metadata, content }
}

/** Whether one canonical path is the root or a descendant of it. */
function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
}

/**
 * Canonicalize a path even when its final components do not exist yet: the
 * deepest existing ancestor is resolved and the missing suffix is restored.
 * This keeps the allowed-root guard working for a not-yet-created home root.
 */
async function canonicalizePath(path: string): Promise<string> {
  let current = resolve(path)
  const missing: string[] = []
  for (;;) {
    try {
      const canonical = await realpath(current)
      return join(canonical, ...missing.reverse())
    } catch (error) {
      if (codeOf(error) !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/** Canonicalize the allowed roots, keeping roots that do not exist yet. */
async function canonicalRoots(roots: readonly string[] | undefined): Promise<string[]> {
  if (roots === undefined) return []
  const canonical: string[] = []
  for (const root of roots) {
    try {
      canonical.push(await canonicalizePath(root))
    } catch {
      // A root whose ancestor chain cannot be resolved cannot contain the target.
    }
  }
  return canonical
}

/** Refuse a target that escapes every allowed root. */
function assertInsideRoots(target: string, roots: readonly string[]): void {
  if (roots.length === 0) return
  if (roots.some(root => isInside(root, target))) return
  throw new AgentFileError(400, `${target} resolves outside the allowed instruction roots`)
}

/**
 * Write one candidate instruction file.
 *
 * Through a symlink the write lands on the resolved target, so the link itself
 * is preserved. When `allowedRoots` is supplied, a target that escapes those
 * roots is refused: a cloned repository must not turn the editor into a write
 * primitive for arbitrary files. A missing file is created only when the
 * caller proved it saw no file (`expectedMtimeMs === null`).
 *
 * @param request - validated target path, content, expected mtime, and the roots a target must stay inside.
 * @returns fresh metadata and whether the file was created.
 * @throws AgentFileError on stale state, non-regular targets, size, or I/O.
 */
export async function writeAgentInstructionFile(request: {
  readonly path: string
  readonly content: string
  readonly expectedMtimeMs: number | null
  readonly allowedRoots?: readonly string[] | undefined
}): Promise<AgentFileWriteResult> {
  if (request.content.includes('\u0000')) {
    throw new AgentFileError(400, 'content must not contain NUL bytes')
  }
  if (Buffer.byteLength(request.content, 'utf8') > MAX_AGENT_FILE_BYTES) {
    throw new AgentFileError(413, `content is larger than ${MAX_AGENT_FILE_BYTES} bytes`)
  }

  let linkInfo
  try {
    linkInfo = await lstat(request.path)
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') {
      throw new AgentFileError(500, `could not write ${request.path}: ${messageOf(error)}`)
    }
    linkInfo = undefined
  }

  let target = request.path
  let existing = false
  let currentMtimeMs: number | null = null
  let mode = 0o644

  if (linkInfo !== undefined) {
    existing = true
    if (linkInfo.isSymbolicLink()) {
      let resolved: string
      try {
        resolved = await realpath(request.path)
      } catch (error) {
        throw new AgentFileError(400, `${request.path} is a dangling symbolic link: ${messageOf(error)}`)
      }
      let targetInfo
      try {
        targetInfo = await stat(resolved)
      } catch (error) {
        throw new AgentFileError(400, `${request.path} cannot be written through: ${messageOf(error)}`)
      }
      if (!targetInfo.isFile()) {
        throw new AgentFileError(400, `${resolved} is not a regular file`)
      }
      target = resolved
      currentMtimeMs = targetInfo.mtimeMs
      mode = (targetInfo.mode & 0o777) || 0o644
    } else if (linkInfo.isFile()) {
      currentMtimeMs = linkInfo.mtimeMs
      mode = (linkInfo.mode & 0o777) || 0o644
    } else {
      throw new AgentFileError(400, `${request.path} is not a regular file`)
    }
  }

  const roots = await canonicalRoots(request.allowedRoots)
  if (roots.length > 0) {
    let canonicalTarget: string | undefined
    try {
      canonicalTarget = await canonicalizePath(target)
    } catch (error) {
      throw new AgentFileError(500, `could not resolve ${target}: ${messageOf(error)}`)
    }
    assertInsideRoots(canonicalTarget, roots)
  }

  if (existing) {
    if (request.expectedMtimeMs === null) {
      throw new AgentFileError(409, `${request.path} exists; reload before overwriting`)
    }
    if (currentMtimeMs === null || Math.abs(currentMtimeMs - request.expectedMtimeMs) > 1e-6) {
      throw new AgentFileError(409, `${request.path} changed on disk; reload before overwriting`)
    }
  } else if (request.expectedMtimeMs !== null) {
    throw new AgentFileError(409, `${request.path} no longer exists; reload before creating`)
  }

  try {
    await writeFileAtomic(target, request.content, mode)
  } catch (error) {
    throw new AgentFileError(500, `could not write ${target}: ${messageOf(error)}`)
  }

  let written
  try {
    written = await stat(target)
  } catch (error) {
    throw new AgentFileError(500, `wrote ${target} but could not stat it: ${messageOf(error)}`)
  }
  let realPath: string | null = null
  try {
    realPath = await realpath(request.path)
  } catch {
    realPath = null
  }
  let symlink = false
  try {
    symlink = (await lstat(request.path)).isSymbolicLink()
  } catch {
    symlink = false
  }
  return {
    path: request.path,
    realPath,
    symlink,
    sizeBytes: written.size,
    mtimeMs: written.mtimeMs,
    created: !existing,
  }
}