/**
 * The Overview page: a four-row status board over the same routes and Remotes
 * the detail pages read. Each source settles independently — one failing route
 * degrades its own row, never the board. A row is the navigation target; the
 * findings it lists are the same destination, so they are text, not controls.
 *
 * @module dsh-harness-panel/client/OverviewPage
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { RefreshButton } from './controls.tsx'
import type { McpSnapshot } from '../mcp.ts'
import type { HooksSnapshot } from '../hooks.ts'
import type { AgentsSnapshot } from '../agents-contract.ts'
import type { HarnessPanelLocaleKey } from './locales.ts'
import {
  buildOverview,
  type AgentsOverviewCard,
  type HooksOverviewCard,
  type McpOverviewCard,
  type OverviewIssue,
  type OverviewIssueKind,
  type OverviewPageId,
  type OverviewSkillsInput,
  type OverviewTone,
  type Settled,
  type SkillsOverviewCard,
} from './overview-model.ts'
import type { DisabledSkillLike } from './skills-model.ts'
import type { SkillsRemoteFace } from './SkillsPage.tsx'
import { currentSessionId, fetchJson, fill, formatBytes, formatClock, type Translate } from './shared.ts'
import { useResumeRefresh } from './use-resume-refresh.ts'

/** Services the page reads, bound by the plugin's apply closure. */
export interface OverviewPageDeps {
  /** The shipped `remote.skills` namespace; `undefined` only when unmounted. */
  readonly skills: SkillsRemoteFace | undefined
  /** The client sessions store (structural). */
  readonly sessions: unknown
}

/** Dictionary key per issue kind. */
const ISSUE_KEY: Record<OverviewIssueKind, HarnessPanelLocaleKey> = {
  'mcp-failed': 'issueMcpFailed',
  'mcp-unavailable': 'issueMcpUnavailable',
  'mcp-connecting': 'issueMcpConnecting',
  'hook-parse-error': 'issueHookParseError',
  'hook-inactive': 'issueHookInactive',
  'skill-disabled': 'issueSkillDisabled',
  'agents-not-injecting': 'issueAgentsNotInjecting',
  'agents-truncated': 'issueAgentsTruncated',
  'agents-omitted': 'issueAgentsOmitted',
  'agents-unreadable': 'issueAgentsUnreadable',
  'agents-over-limit': 'issueAgentsOverLimit',
}

/** Row title key per page id. */
const TITLE_KEY: Record<OverviewPageId, HarnessPanelLocaleKey> = {
  mcp: 'overviewMcpTitle',
  skills: 'overviewSkillsTitle',
  hooks: 'overviewHooksTitle',
  agents: 'overviewAgentsTitle',
}

/** State word per tone; the metric line under it says why a row is quiet. */
const STATE_KEY: Record<OverviewTone, HarnessPanelLocaleKey> = {
  ok: 'statusOk',
  warn: 'statusAttention',
  error: 'statusError',
  muted: 'statusMuted',
}

/** Settle one promise into state unless the load was aborted or unmounted. */
async function settleInto<T>(
  source: Promise<T>,
  apply: (settled: Settled<T>) => void,
  signal: AbortSignal,
  isMounted: () => boolean,
): Promise<void> {
  try {
    const value = await source
    if (!signal.aborted && isMounted()) apply({ status: 'ready', value })
  } catch (error) {
    if (signal.aborted || !isMounted()) return
    apply({ status: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

/** Load the skills row input: session catalog plus the host disabled records. */
async function loadSkillsInput(deps: OverviewPageDeps, signal: AbortSignal): Promise<OverviewSkillsInput> {
  // The disabled snapshot is independent of the session catalog; a missing
  // route leaves the row showing the catalog alone.
  const hostPromise = fetchJson<{ disabled: readonly DisabledSkillLike[] }>('/harness-panel/skills', signal)
    .catch((): { disabled: readonly DisabledSkillLike[] } => ({ disabled: [] }))
  const remote = deps.skills
  if (remote === undefined) {
    const host = await hostPromise
    return { session: 'unavailable', enabled: [], disabled: host.disabled }
  }
  const sessionId = currentSessionId(deps.sessions)
  if (sessionId === undefined) {
    const host = await hostPromise
    return { session: 'no-session', enabled: [], disabled: host.disabled }
  }
  const result = await remote.list({ sessionId }, signal)
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
  const host = await hostPromise
  return { session: 'ok', enabled: result.value.skills, disabled: host.disabled }
}

/** One finding line: severity dot, kind, and the subject's identifier. */
function Finding({ issue, t }: {
  readonly issue: OverviewIssue
  readonly t: Translate
}): JSX.Element {
  return (
    <span className="dhp-finding" data-severity={issue.severity}>
      <span className="dhp-finding-label">{t(ISSUE_KEY[issue.kind])}</span>
      {issue.name === '' ? null : <span className="dhp-finding-name">{issue.name}</span>}
    </span>
  )
}

/**
 * The findings under one row: failures and warnings only, three lines plus an
 * overflow count. Intentional states (a disabled skill) are already counted in
 * the row's metrics and would only add noise here.
 */
function Findings({ issues, t }: {
  readonly issues: readonly OverviewIssue[]
  readonly t: Translate
}): JSX.Element | null {
  const actionable = issues.filter(issue => issue.severity !== 'info')
  if (actionable.length === 0) return null
  return (
    <span className="dhp-board-findings">
      {actionable.slice(0, 3).map(issue => <Finding key={issue.key} issue={issue} t={t} />)}
      {actionable.length > 3
        ? <span className="dhp-finding-more">{fill(t('overviewMoreIssues'), { count: actionable.length - 3 })}</span>
        : null}
    </span>
  )
}

/** One board row: name, state, metrics, findings — the whole row navigates. */
function BoardRow({ page, tone, status, message, findings, children, t, onNavigate }: {
  readonly page: OverviewPageId
  readonly tone: OverviewTone
  readonly status: 'loading' | 'error' | 'ready'
  readonly message: string | null
  readonly findings: readonly OverviewIssue[]
  readonly children: ReactNode
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const stateTone: OverviewTone = status === 'ready' ? tone : status === 'error' ? 'error' : 'muted'
  const stateLabel = status === 'loading' ? t('loading') : status === 'error' ? t('error') : t(STATE_KEY[tone])
  return (
    <li>
      <button
        type="button"
        className="dhp-board-row"
        onClick={() => { onNavigate(page) }}
      >
        <span className="dhp-board-name">{t(TITLE_KEY[page])}</span>
        <span className="dhp-board-state">
          <span className="dhp-state" data-tone={stateTone}>
            <span className="dhp-dot" />
            {stateLabel}
          </span>
        </span>
        <span className="dhp-board-metrics">
          {status === 'loading'
            ? null
            : status === 'error'
              ? <span className="dhp-error">{message}</span>
              : children}
        </span>
        {status === 'ready' ? <Findings issues={findings} t={t} /> : null}
      </button>
    </li>
  )
}

/** The MCP row: availability against the configured fleet, in tools. */
function McpRow({ card, t, onNavigate }: {
  readonly card: McpOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  return (
    <BoardRow
      page="mcp"
      tone={card.tone}
      status={card.status}
      message={card.message}
      findings={card.issues}
      t={t}
      onNavigate={onNavigate}
    >
      {card.total === 0
        ? t('overviewMcpEmpty')
        : [
            fill(t('overviewMcpServers'), { count: card.total }),
            fill(t('overviewMcpAvailable'), { count: card.available }),
            fill(t('toolCount'), { count: card.tools }),
            ...card.total - card.enabled > 0 ? [fill(t('overviewDisabled'), { count: card.total - card.enabled })] : [],
          ].join(' · ')}
    </BoardRow>
  )
}

/** The Skills row: the session catalog against the disabled records. */
function SkillsRow({ card, t, onNavigate }: {
  readonly card: SkillsOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const line = card.session === 'no-session'
    ? t('overviewNoSession')
    : card.session === 'unavailable'
      ? t('overviewUnavailable')
      : card.total === 0
        ? t('overviewSkillsEmpty')
        // total − enabled is the disabled count; stating it twice adds nothing.
        : fill(t('overviewSkillsRatio'), { enabled: card.enabled, total: card.total })
  return (
    <BoardRow
      page="skills"
      tone={card.tone}
      status={card.status}
      message={card.message}
      findings={card.issues}
      t={t}
      onNavigate={onNavigate}
    >
      {line}
    </BoardRow>
  )
}

/** The Hooks row: active commands against the mounted bridges. */
function HooksRow({ card, t, onNavigate }: {
  readonly card: HooksOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  return (
    <BoardRow
      page="hooks"
      tone={card.tone}
      status={card.status}
      message={card.message}
      findings={card.issues}
      t={t}
      onNavigate={onNavigate}
    >
      {card.bridges === 0
        ? t('overviewHooksEmpty')
        : [
            fill(t('overviewHooksBridges'), { count: card.bridges }),
            fill(t('overviewHooksRatio'), { active: card.activeHooks, total: card.totalHooks }),
            ...card.disabledHooks > 0 ? [fill(t('overviewDisabled'), { count: card.disabledHooks })] : [],
          ].join(' · ')}
    </BoardRow>
  )
}

/** The AGENTS.md row: the injected instruction budget. */
function AgentsRow({ card, t, onNavigate }: {
  readonly card: AgentsOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const percent = card.maxBytes !== null && card.maxBytes > 0
    ? Math.round((card.renderedBytes / card.maxBytes) * 100)
    : null
  // The gauge exists to warn; a budget with room left is stated in numbers only.
  const tight = percent !== null && percent >= 75
  return (
    <BoardRow
      page="agents"
      tone={card.tone}
      status={card.status}
      message={card.message}
      findings={card.issues}
      t={t}
      onNavigate={onNavigate}
    >
      {card.maxBytes === null
        ? t('agentsStatusNotLoaded')
        : [
            `${formatBytes(card.renderedBytes)} / ${formatBytes(card.maxBytes)}`,
            ...percent === null ? [] : [fill(t('overviewBudgetShare'), { percent })],
            fill(t('overviewAgentsFiles'), { count: card.loadedFiles }),
          ].join(' · ')}
      {tight ? (
        <span className="dhp-budget" role="img" aria-label={fill(t('overviewBudget'), { percent: percent ?? 0 })}>
          <span className="dhp-budget-track">
            <span
              className="dhp-budget-fill"
              data-hot={percent >= 90 ? 'true' : undefined}
              style={{ width: `${Math.min(100, percent ?? 0)}%` }}
            />
          </span>
        </span>
      ) : null}
    </BoardRow>
  )
}

/** The Overview page body. */
export function OverviewPage({ t, deps, active, onNavigate }: {
  readonly t: Translate
  readonly deps: OverviewPageDeps
  /** Whether this panel is the selected tab; selecting it again re-reads. */
  readonly active: boolean
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const [mcp, setMcp] = useState<Settled<McpSnapshot>>({ status: 'loading' })
  const [hooks, setHooks] = useState<Settled<HooksSnapshot>>({ status: 'loading' })
  const [skills, setSkills] = useState<Settled<OverviewSkillsInput>>({ status: 'loading' })
  const [agents, setAgents] = useState<Settled<AgentsSnapshot>>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
  const [readAt, setReadAt] = useState<number | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  /** Load all four sources; resolves when every one has settled. */
  const loadAll = useCallback(async (signal: AbortSignal): Promise<void> => {
    const isMounted = (): boolean => mounted.current
    const params = new URLSearchParams()
    const sessionId = currentSessionId(deps.sessions)
    if (sessionId !== undefined) params.set('session', sessionId)
    await Promise.all([
      settleInto(fetchJson<McpSnapshot>('/harness-panel/mcp', signal), setMcp, signal, isMounted),
      settleInto(fetchJson<HooksSnapshot>('/harness-panel/hooks', signal), setHooks, signal, isMounted),
      settleInto(loadSkillsInput(deps, signal), setSkills, signal, isMounted),
      settleInto(fetchJson<AgentsSnapshot>(`/harness-panel/agents?${params.toString()}`, signal), setAgents, signal, isMounted),
    ])
    if (!signal.aborted && isMounted()) setReadAt(Date.now())
  }, [deps])

  useEffect(() => {
    const controller = new AbortController()
    void loadAll(controller.signal)
    return () => { controller.abort() }
  }, [loadAll])

  // The board is a live read of state this panel edits; re-read it whenever the
  // tab becomes the selected one again.
  const refreshQuietly = useCallback((): void => {
    void loadAll(new AbortController().signal)
  }, [loadAll])
  useResumeRefresh(active, refreshQuietly)

  const onRefresh = useCallback((): void => {
    setRefreshing(true)
    const controller = new AbortController()
    void loadAll(controller.signal).finally(() => {
      if (mounted.current) setRefreshing(false)
    })
  }, [loadAll])

  const model = buildOverview({ mcp, hooks, skills, agents })
  const [mcpCard, skillsCard, hooksCard, agentsCard] = model.cards
  // The count wears the worst tone on the board, not its own attention total.
  const worst: 'error' | 'warn' | undefined = model.cards.some(card => card.tone === 'error')
    ? 'error'
    : model.attention > 0 ? 'warn' : undefined

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-meta" data-tone={worst} role="status">
          {model.allReady
            ? model.attention > 0
              ? <strong>{fill(t('overviewAttention'), { count: model.attention })}</strong>
              : t('overviewAllGood')
            : t('loading')}
          {readAt === null ? null : <span>{fill(t('overviewReadAt'), { time: formatClock(readAt) })}</span>}
        </p>
        <RefreshButton t={t} busy={refreshing} onClick={onRefresh} />
      </div>
      <div className="dhp-board">
        <div className="dhp-board-head" aria-hidden="true">
          <span>{t('overviewColumnSubsystem')}</span>
          <span>{t('overviewColumnState')}</span>
          <span>{t('overviewColumnScale')}</span>
        </div>
        <ul className="dhp-board-list">
          <McpRow card={mcpCard} t={t} onNavigate={onNavigate} />
          <SkillsRow card={skillsCard} t={t} onNavigate={onNavigate} />
          <HooksRow card={hooksCard} t={t} onNavigate={onNavigate} />
          <AgentsRow card={agentsCard} t={t} onNavigate={onNavigate} />
        </ul>
      </div>
    </>
  )
}
