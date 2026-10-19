/**
 * Atomic file writes shared by the panel's host half: a mode-0600 temp file
 * next to the target, then a rename. Windows refuses a rename over an
 * existing file, so that case falls back to a direct write and cleans the
 * temp file up.
 *
 * @module dsh-harness-panel/atomic
 */

import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Write one file atomically.
 *
 * @param path - absolute target path.
 * @param text - full file content.
 * @param mode - file mode for the fresh file; pass an existing file's bits to preserve them.
 */
export async function writeFileAtomic(path: string, text: string, mode = 0o600): Promise<void> {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  await writeFile(temp, text, { mode })
  try {
    await rename(temp, path)
  } catch {
    try {
      await writeFile(path, text, { mode })
    } finally {
      await rm(temp, { force: true })
    }
  }
}
