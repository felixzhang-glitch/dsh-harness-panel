/**
 * AGENTS.md loading system — the wire contract shared by the host half and the
 * browser half. Nothing here imports Node or React, so the client bundle can
 * value-import the constants without pulling host code in.
 *
 * The host models the `@deepseek-ai/dsh-agent-instructions` loader exactly as
 * DSH 0.2.x resolves it: two user-global roots (`$DSH_HOME`, `$DSH_AGENTS_HOME`),
 * then the project chain from the discovered root down to the session working
 * directory, with base candidates before each directory's local overlays.
 *
 * @module dsh-harness-panel/agents-contract
 */

/** The official workspace-instruction loader module name on loader rows. */
export const AGENT_INSTRUCTIONS_MODULE = '@deepseek-ai/dsh-agent-instructions'

/** The agent-preset declaration module that owns the per-agent loader rows. */
export const AGENT_PRESET_MODULE = '@deepseek-ai/dsh-agent-preset'

/** Hard cap on one instruction file the panel will read or write, in bytes. */
export const MAX_AGENT_FILE_BYTES = 1024 * 1024

/** Cap on a render preview returned to the browser, in bytes. */
export const MAX_AGENT_PREVIEW_BYTES = 256 * 1024

/** Cap on the JSON write-route body, in bytes (escaped content included). */
export const MAX_AGENT_WRITE_BODY_BYTES = 4 * 1024 * 1024

/** Which root a candidate belongs to. */
export type AgentInstructionScope = 'user-global' | 'shared' | 'project'

/** Final disposition of one candidate file in the rendered baseline. */
export type AgentInstructionFileStatus =
  | 'loaded'
  | 'empty'
  | 'truncated'
  | 'omitted'
  | 'duplicate'
  | 'over-source-limit'
  | 'unreadable'
  | 'missing'
  | 'not-loaded'

/** Why the loader is not injecting instructions, when it is not. */
export type AgentInstructionReason =
  | 'ok'
  | 'row-missing'
  | 'row-disabled'
  | 'row-invalid'
  | 'fs-unavailable'
  | 'budget-disabled'

/** Normalized instruction-loader configuration (defaults filled in). */
export interface AgentInstructionsConfig {
  /** Cap on the complete rendered baseline, in bytes. */
  readonly maxBytes: number
  /** Cap on one source instruction file, in bytes. */
  readonly maxSourceBytes: number
  /** Directory names that mark the project root. */
  readonly projectRootMarkers: readonly string[]
  /** Base candidate file names loaded in every project directory. */
  readonly instructionFileCandidates: readonly string[]
  /** Local overlay candidate file names loaded after the base candidates. */
  readonly localInstructionFileCandidates: readonly string[]
}

/** The loader row the snapshot read its configuration from. */
export interface AgentInstructionRowView {
  /** Full loader entry id (parent-prefixed). */
  readonly entryId: string
  /** Whether the row came from a preset's child list or the app-level patch. */
  readonly source: 'preset' | 'root'
  /** Preset id when the row was found inside a preset declaration. */
  readonly presetId: string | null
  /** Effective disabled state (preset declaration included). */
  readonly disabled: boolean
  /** Normalized configuration; null when the row's config cannot be read. */
  readonly config: AgentInstructionsConfig | null
}

/** One candidate instruction file (present or missing). */
export interface AgentInstructionFileView {
  /** Absolute candidate path (the path the loader probes). */
  readonly path: string
  /** Symlink target when the candidate is a link and the target exists. */
  readonly realPath: string | null
  /** Model-facing path: `~/.dsh/AGENTS.md` or a project-relative path. */
  readonly displayPath: string
  readonly scope: AgentInstructionScope
  /** Absolute directory holding the candidate. */
  readonly directory: string
  /** Display form of {@link directory}: `~/.dsh`, `~/.agents`, `.`, or `packages/app`. */
  readonly displayDirectory: string
  /** Candidate file name (`AGENTS.md`, `CLAUDE.local.md`, …). */
  readonly name: string
  readonly exists: boolean
  readonly symlink: boolean
  /** Source bytes on disk; null when missing or unreadable. */
  readonly sizeBytes: number | null
  /** Last modification time in epoch ms; null when missing. */
  readonly mtimeMs: number | null
  readonly status: AgentInstructionFileStatus
  /** Bytes of this file's content that survived rendering; null when not rendered. */
  readonly includedBytes: number | null
  /** Earlier candidate whose trimmed content duplicates this one. */
  readonly duplicateOf: string | null
  /** Sanitized read/metadata error, or a dangling-symlink note. */
  readonly error: string | null
}

/** One scope group: a user-global root or one project directory. */
export interface AgentInstructionGroupView {
  /** Stable key used by the browser for expansion state. */
  readonly key: string
  readonly scope: AgentInstructionScope
  readonly directory: string
  readonly displayDirectory: string
  /** Whether this directory is the discovered project root. */
  readonly isProjectRoot: boolean
  /** Whether this directory is the session working directory. */
  readonly isCwd: boolean
  readonly files: readonly AgentInstructionFileView[]
}

/** Budget and render diagnostics for the baseline. */
export interface AgentsBudgetView {
  readonly maxBytes: number | null
  readonly maxSourceBytes: number | null
  /** Bytes of the rendered `<system-reminder>` baseline. */
  readonly renderedBytes: number
  /** Number of files semantically represented in the render. */
  readonly loadedFileCount: number
  /** Display paths dropped wholesale for budget reasons. */
  readonly omitted: readonly string[]
  /** The one file the budget truncated, when any. */
  readonly truncated: readonly {
    readonly displayPath: string
    readonly originalBytes: number
    readonly includedBytes: number
  }[]
}

/** The complete AGENTS.md tab snapshot. */
export interface AgentsSnapshot {
  /** Canonical working directory the chain was computed for. */
  readonly cwd: string
  /** Where that directory came from. */
  readonly cwdSource: 'session' | 'request' | 'process'
  /** Discovered project root (equals cwd when no root marker exists). */
  readonly projectRoot: string
  /** Session the snapshot followed, when the host could resolve one. */
  readonly sessionId: string | null
  /** Active agent preset id, when resolvable. */
  readonly presetId: string | null
  /** The loader row whose configuration is in effect. */
  readonly row: AgentInstructionRowView | null
  /** Whether the loader is actually injecting instructions. */
  readonly enabled: boolean
  readonly reason: AgentInstructionReason
  readonly groups: readonly AgentInstructionGroupView[]
  readonly budget: AgentsBudgetView
  /** Exact rendered baseline text, bounded by {@link MAX_AGENT_PREVIEW_BYTES}. */
  readonly preview: string | null
  readonly warnings: readonly string[]
  readonly collectedAt: number
}

/** Metadata of one instruction file, without content. */
export interface AgentFileMetadata {
  readonly path: string
  readonly realPath: string | null
  readonly symlink: boolean
  readonly sizeBytes: number
  readonly mtimeMs: number
}

/** One file read response. */
export interface AgentFileContent extends AgentFileMetadata {
  readonly content: string
}

/** One file write response. */
export interface AgentFileWriteResult extends AgentFileMetadata {
  readonly created: boolean
}