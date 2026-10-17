/**
 * The shipped `pluginManager` Remote, read structurally so the client bundle
 * never imports a shell package. The built-in Plugins page uses the same
 * Remote: `listPlugins()` tells us which loader rows are addressable and
 * `setPluginEnabled(entryId, enabled)` persists and applies one row switch.
 *
 * The panel's MCP/hook rows carry the short row id in `patchId`; `entryId` is
 * the full loader id the write needs. Both are kept distinct here.
 *
 * @module dsh-harness-panel/client/plugin-manager
 */

/** The official MCP client bridge module name. */
export const MCP_CLIENT_MODULE = '@deepseek-ai/dsh-mcp-client'

/** The Claude Code hook bridge module name. */
export const HOOKS_CLAUDE_CODE_MODULE = '@deepseek-ai/dsh-hooks-claude-code'

/** The Codex hook bridge module name. */
export const HOOKS_CODEX_MODULE = '@deepseek-ai/dsh-hooks-codex'

/** Root-fiber phase projected by the plugin inventory. */
export type PluginFiberPhase = 'pending' | 'loading' | 'active' | 'failed' | 'unloading' | null

/** Why a profile control refuses to switch a row. */
export type PluginReadOnlyReason = 'management-required' | 'unaddressable'

/** One loader row as `pluginManager.listPlugins()` reports it. */
export interface PluginInfoFace {
  readonly entryId: string
  readonly patchId?: string
  readonly moduleName: string
  readonly enabled: boolean
  readonly fiberPhase: PluginFiberPhase
  readonly readOnlyReason?: PluginReadOnlyReason
}

/** One persisted-change outcome from `setPluginEnabled`. */
export interface ChangeResultFace {
  readonly changed: boolean
  readonly application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  readonly error?: { readonly code?: string; readonly diagnostic?: string }
}

/** The Remote transport envelope. */
export type RemoteResultFace<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The two methods this panel reads from the shipped namespace. */
export interface PluginManagerRemoteFace {
  listPlugins(): Promise<RemoteResultFace<PluginInfoFace[]>>
  setPluginEnabled(entryId: string, enabled: boolean): Promise<RemoteResultFace<ChangeResultFace>>
}

/** The module name one hook dialect bridge uses. */
export function moduleNameForDialect(dialect: 'claude-code' | 'codex'): string {
  return dialect === 'codex' ? HOOKS_CODEX_MODULE : HOOKS_CLAUDE_CODE_MODULE
}

/**
 * Resolve one panel row (short id) to its addressable plugin-manager row.
 *
 * `patchId` is the exact short id. The `entryId` fallbacks cover an inventory
 * row whose patch id is absent (a read-only row still gets its reason) and a
 * loader id prefixed by its parent group. Two matches are ambiguous and yield
 * undefined so the caller disables the switch instead of guessing.
 *
 * @param rows - current `listPlugins()` rows.
 * @param shortId - the panel snapshot's `entryId`.
 * @param moduleName - exact module the row must declare.
 * @returns the unique matching row, or undefined.
 */
export function findPluginInfo(
  rows: readonly PluginInfoFace[],
  shortId: string,
  moduleName: string,
): PluginInfoFace | undefined {
  if (shortId === '') return undefined
  const matches = rows.filter(row => row.moduleName === moduleName
    && (row.patchId === shortId || row.entryId === shortId || row.entryId.endsWith(`:${shortId}`)))
  return matches.length === 1 ? matches[0] : undefined
}

/** What one switch attempt means for the caller's notice/error line. */
export type ToggleOutcome =
  | { readonly kind: 'applied' }
  | { readonly kind: 'restart-required' }
  | { readonly kind: 'overridden' }
  | { readonly kind: 'failed'; readonly message: string }

/**
 * Persist and apply one loader-row switch through the shipped Remote.
 * Transport failures and Host refusals both become a displayable outcome.
 *
 * @param pm - the shipped `remote.pluginManager` namespace.
 * @param info - the resolved addressable row.
 * @param enabled - desired state.
 * @returns the applied/notice/failed outcome.
 */
export async function togglePluginRow(
  pm: PluginManagerRemoteFace,
  info: PluginInfoFace,
  enabled: boolean,
): Promise<ToggleOutcome> {
  try {
    const result = await pm.setPluginEnabled(info.entryId, enabled)
    if (!result.ok) {
      return { kind: 'failed', message: result.error.message || result.error.code || 'request failed' }
    }
    const value = result.value
    switch (value.application) {
      case 'applied':
        return { kind: 'applied' }
      case 'restart-required':
        return { kind: 'restart-required' }
      case 'overridden':
        return { kind: 'overridden' }
      case 'failed':
        return { kind: 'failed', message: value.error?.diagnostic ?? value.error?.code ?? 'operation failed' }
      case 'cancelled':
        return { kind: 'failed', message: 'cancelled' }
      default:
        return { kind: 'failed', message: 'unknown operation outcome' }
    }
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) }
  }
}
