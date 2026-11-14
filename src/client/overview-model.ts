/**
 * Pure Overview aggregation: the four settled page snapshots become four
 * health cards plus one attention count. No React, no fetch, no locale — the
 * page maps issue kinds to dictionary keys, so every rule here is unit-testable.
 *
 * @module dsh-harness-panel/client/overview-model
 */

import type { McpSnapshot } from '../mcp.ts'
import type { HooksSnapshot } from '../hooks.ts'
import type { AgentsSnapshot } from '../agents-contract.ts'
import { mergeSkillRows, type DisabledSkillLike, type SkillEntryLike } from './skills-model.ts'

/** One independently settled data source. */
export type Settled<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly value: T }

/** The skills card's combined input: session catalog plus host disabled records. */
export interface OverviewSkillsInput {
  readonly session: 'ok' | 'no-session' | 'unavailable'
  readonly enabled: readonly SkillEntryLike[]
  readonly disabled: readonly DisabledSkillLike[]
}

/** The four detail pages an overview card can open. */
export type OverviewPageId = 'mcp' | 'skills' | 'hooks' | 'agents'

/** Card health tone, mapped to the native StateDot semantics by the page. */
export type OverviewTone = 'ok' | 'warn' | 'error' | 'muted'

/** What one attention row names. */
export type OverviewIssueKind =
  | 'mcp-failed'
  | 'mcp-unavailable'
  | 'mcp-connecting'
  | 'hook-parse-error'
  | 'hook-inactive'
  | 'skill-disabled'
  | 'agents-not-injecting'
  | 'agents-truncated'
  | 'agents-omitted'
  | 'agents-unreadable'
  | 'agents-over-limit'

/** How loudly one issue counts: info rows never raise the attention count. */
export type OverviewSeverity = 'error' | 'warn' | 'info'

/** One attention row: a stable key, its kind, and the raw subject name. */
export interface OverviewIssue {
  readonly key: string
  readonly kind: OverviewIssueKind
  readonly severity: OverviewSeverity
  /** Server name, bridge id, or display path; '' when the kind speaks alone. */
  readonly name: string
}

/** Fields every card carries, whatever its settle state. */
interface CardCommon {
  readonly status: 'loading' | 'error' | 'ready'
  readonly tone: OverviewTone
  /** Settle diagnostic when status is 'error'; null otherwise. */
  readonly message: string | null
  /** Sorted errors first, then warnings, then info rows. */
  readonly issues: readonly OverviewIssue[]
}

/** MCP card facts; zeros while loading or errored. */
export interface McpOverviewCard extends CardCommon {
  readonly id: 'mcp'
  readonly total: number
  readonly enabled: number
  readonly available: number
  readonly tools: number
}

/** Skills card facts. */
export interface SkillsOverviewCard extends CardCommon {
  readonly id: 'skills'
  readonly session: 'ok' | 'no-session' | 'unavailable' | 'unknown'
  readonly total: number
  readonly enabled: number
  readonly disabled: number
}

/** Hooks card facts. */
export interface HooksOverviewCard extends CardCommon {
  readonly id: 'hooks'
  readonly bridges: number
  readonly totalHooks: number
  readonly activeHooks: number
  readonly disabledHooks: number
}

/** AGENTS.md card facts. */
export interface AgentsOverviewCard extends CardCommon {
  readonly id: 'agents'
  readonly injecting: boolean
  readonly loadedFiles: number
  readonly renderedBytes: number
  readonly maxBytes: number | null
}

/** The complete overview model. */
export interface OverviewModel {
  readonly cards: readonly [McpOverviewCard, SkillsOverviewCard, HooksOverviewCard, AgentsOverviewCard]
  /** Error + warn issues across all cards; info rows are intentional states. */
  readonly attention: number
  readonly allReady: boolean
}

/** The four settled sources the overview reads. */
export interface OverviewInput {
  readonly mcp: Settled<McpSnapshot>
  readonly hooks: Settled<HooksSnapshot>
  readonly skills: Settled<OverviewSkillsInput>
  readonly agents: Settled<AgentsSnapshot>
}

/** Severity order for the attention list. */
const SEVERITY_RANK: Record<OverviewSeverity, number> = { error: 0, warn: 1, info: 2 }

/** Sort issues errors-first, keeping insertion order within one severity. */
function sortIssues(issues: readonly OverviewIssue[]): OverviewIssue[] {
  return [...issues].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity])
}

/** The strongest tone a list of issues implies, or the fallback when quiet. */
function toneOf(issues: readonly OverviewIssue[], quiet: OverviewTone): OverviewTone {
  if (issues.some(issue => issue.severity === 'error')) return 'error'
  if (issues.some(issue => issue.severity === 'warn')) return 'warn'
  return quiet
}

/** Settle-state shell shared by every card builder. */
function commonOf<T>(settled: Settled<T>): CardCommon {
  if (settled.status === 'loading') return { status: 'loading', tone: 'muted', message: null, issues: [] }
  if (settled.status === 'error') return { status: 'error', tone: 'error', message: settled.message, issues: [] }
  return { status: 'ready', tone: 'ok', message: null, issues: [] }
}

/** Aggregate the MCP snapshot. */
function mcpCard(settled: Settled<McpSnapshot>): McpOverviewCard {
  const common = commonOf(settled)
  if (settled.status !== 'ready') {
    return { ...common, id: 'mcp', total: 0, enabled: 0, available: 0, tools: 0 }
  }
  const servers = settled.value.servers
  const issues: OverviewIssue[] = []
  let enabled = 0
  let available = 0
  let tools = 0
  for (const server of servers) {
    tools += server.toolCount
    if (!server.enabled) continue
    enabled += 1
    if (server.available) available += 1
    if (server.fiberPhase === 'failed') {
      issues.push({ key: `mcp-failed:${server.entryId}`, kind: 'mcp-failed', severity: 'error', name: server.serverName })
    } else if (server.phase === 'connecting' || server.phase === 'waiting') {
      issues.push({ key: `mcp-connecting:${server.entryId}`, kind: 'mcp-connecting', severity: 'warn', name: server.serverName })
    } else if (!server.available) {
      issues.push({ key: `mcp-unavailable:${server.entryId}`, kind: 'mcp-unavailable', severity: 'error', name: server.serverName })
    }
  }
  const sorted = sortIssues(issues)
  return {
    ...common,
    id: 'mcp',
    total: servers.length,
    enabled,
    available,
    tools,
    issues: sorted,
    tone: toneOf(sorted, enabled === 0 ? 'muted' : 'ok'),
  }
}

/** Aggregate the skills input. */
function skillsCard(settled: Settled<OverviewSkillsInput>): SkillsOverviewCard {
  const common = commonOf(settled)
  if (settled.status !== 'ready') {
    return { ...common, id: 'skills', session: 'unknown', total: 0, enabled: 0, disabled: 0 }
  }
  const input = settled.value
  const rows = mergeSkillRows(input.enabled, input.disabled)
  const enabledCount = rows.filter(row => row.enabled).length
  const issues: OverviewIssue[] = rows
    .filter(row => !row.enabled)
    .map(row => ({ key: `skill-disabled:${row.name}`, kind: 'skill-disabled' as const, severity: 'info' as const, name: row.name }))
  return {
    ...common,
    id: 'skills',
    session: input.session,
    total: rows.length,
    enabled: enabledCount,
    disabled: rows.length - enabledCount,
    issues,
    tone: input.session === 'ok' ? 'ok' : 'muted',
  }
}

/** Aggregate the hooks snapshot. */
function hooksCard(settled: Settled<HooksSnapshot>): HooksOverviewCard {
  const common = commonOf(settled)
  if (settled.status !== 'ready') {
    return { ...common, id: 'hooks', bridges: 0, totalHooks: 0, activeHooks: 0, disabledHooks: 0 }
  }
  const mounted = settled.value.mounted
  const issues: OverviewIssue[] = []
  let totalHooks = 0
  let activeHooks = 0
  let disabledHooks = 0
  for (const bridge of mounted) {
    const hooks = bridge.events.flatMap(event => event.groups.flatMap(group => group.hooks))
    totalHooks += hooks.length
    disabledHooks += hooks.filter(hook => hook.disabled).length
    if (!bridge.disabled) activeHooks += hooks.filter(hook => !hook.disabled).length
    if (bridge.parseError !== null) {
      issues.push({ key: `hook-parse:${bridge.entryId}`, kind: 'hook-parse-error', severity: 'error', name: bridge.entryId })
    }
    if (bridge.disabled) {
      issues.push({ key: `hook-inactive:${bridge.entryId}`, kind: 'hook-inactive', severity: 'warn', name: bridge.entryId })
    }
  }
  const sorted = sortIssues(issues)
  return {
    ...common,
    id: 'hooks',
    bridges: mounted.length,
    totalHooks,
    activeHooks,
    disabledHooks,
    issues: sorted,
    tone: toneOf(sorted, mounted.length === 0 ? 'muted' : 'ok'),
  }
}

/** Aggregate the AGENTS.md snapshot. */
function agentsCard(settled: Settled<AgentsSnapshot>): AgentsOverviewCard {
  const common = commonOf(settled)
  if (settled.status !== 'ready') {
    return { ...common, id: 'agents', injecting: false, loadedFiles: 0, renderedBytes: 0, maxBytes: null }
  }
  const snapshot = settled.value
  const issues: OverviewIssue[] = []
  const injecting = snapshot.enabled && snapshot.reason === 'ok'
  if (!injecting) {
    issues.push({ key: 'agents-not-injecting', kind: 'agents-not-injecting', severity: 'error', name: '' })
  }
  for (const group of snapshot.groups) {
    for (const file of group.files) {
      if (file.status === 'truncated') {
        issues.push({ key: `agents-truncated:${file.path}`, kind: 'agents-truncated', severity: 'warn', name: file.displayPath })
      } else if (file.status === 'omitted') {
        issues.push({ key: `agents-omitted:${file.path}`, kind: 'agents-omitted', severity: 'warn', name: file.displayPath })
      } else if (file.status === 'unreadable') {
        issues.push({ key: `agents-unreadable:${file.path}`, kind: 'agents-unreadable', severity: 'error', name: file.displayPath })
      } else if (file.status === 'over-source-limit') {
        issues.push({ key: `agents-over-limit:${file.path}`, kind: 'agents-over-limit', severity: 'error', name: file.displayPath })
      }
    }
  }
  const sorted = sortIssues(issues)
  return {
    ...common,
    id: 'agents',
    injecting,
    loadedFiles: snapshot.budget.loadedFileCount,
    renderedBytes: snapshot.budget.renderedBytes,
    maxBytes: snapshot.budget.maxBytes,
    issues: sorted,
    tone: toneOf(sorted, 'ok'),
  }
}

/**
 * Build the overview model from the four settled sources. Each card settles
 * independently: one failing route dims its own card, never the page.
 *
 * @param input - settled MCP, hooks, skills, and AGENTS.md sources.
 * @returns the four cards, the attention count, and the all-ready flag.
 */
export function buildOverview(input: OverviewInput): OverviewModel {
  const cards = [
    mcpCard(input.mcp),
    skillsCard(input.skills),
    hooksCard(input.hooks),
    agentsCard(input.agents),
  ] as const
  const attention = cards.reduce(
    (sum, card) => sum + card.issues.filter(issue => issue.severity !== 'info').length,
    0,
  )
  return { cards, attention, allReady: cards.every(card => card.status === 'ready') }
}
