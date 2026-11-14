/**
 * The Overview page: four health cards (MCP / Skills / Hooks / AGENTS.md)
 * aggregated client-side from the same routes and Remotes the detail pages
 * read. Each source settles independently — one failing route dims its own
 * card, never the page. Attention rows jump straight to the owning tab.
 *
 * @module dsh-harness-panel/client/OverviewPage
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import {
  Button,
  IconApiOutlineRegular,
  IconChevronRightOutlineRegular,
  IconCodeOutlineRegular,
  IconContextInjectionOutlineRegular,
  IconSkillOutlineRegular,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
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
import { currentSessionId, fetchJson, fill, formatBytes, type Translate } from './shared.ts'
import { RefreshButton } from './controls.tsx'

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

/** Card title key per page id. */
const TITLE_KEY: Record<OverviewPageId, HarnessPanelLocaleKey> = {
  mcp: 'overviewMcpTitle',
  skills: 'overviewSkillsTitle',
  hooks: 'overviewHooksTitle',
  agents: 'overviewAgentsTitle',
}

/** Native StateDot semantics per card tone. */
const DOT_STATE: Record<OverviewTone, StateDotState> = {
  ok: 'done',
  warn: 'warning',
  error: 'error',
  muted: 'idle',
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

/** Load the skills card input: session catalog plus the host disabled records. */
async function loadSkillsInput(deps: OverviewPageDeps, signal: AbortSignal): Promise<OverviewSkillsInput> {
  // The disabled snapshot is independent of the session catalog; a missing
  // route leaves the card showing the catalog alone.
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

/** One attention row; clicking opens the owning detail tab. */
function IssueRow({ issue, t, onOpen }: {
  readonly issue: OverviewIssue
  readonly t: Translate
  readonly onOpen: () => void
}): JSX.Element {
  return (
    <li>
      <button type="button" className="dhp-ov-issue" data-severity={issue.severity} onClick={onOpen}>
        <span className="dhp-dot" />
        <span className="dhp-ov-issue-label">{t(ISSUE_KEY[issue.kind])}</span>
        {issue.name !== '' ? <span className="dhp-ov-issue-name dhp-code">{issue.name}</span> : null}
      </button>
    </li>
  )
}

/** The card's attention list, capped at three rows plus an overflow hint. */
function IssueList({ issues, t, onOpen }: {
  readonly issues: readonly OverviewIssue[]
  readonly t: Translate
  readonly onOpen: () => void
}): JSX.Element | null {
  if (issues.length === 0) return null
  return (
    <ul className="dhp-ov-issues">
      {issues.slice(0, 3).map(issue => (
        <IssueRow key={issue.key} issue={issue} t={t} onOpen={onOpen} />
      ))}
      {issues.length > 3 ? (
        <li className="dhp-hint dhp-ov-more">{fill(t('overviewMoreIssues'), { count: issues.length - 3 })}</li>
      ) : null}
    </ul>
  )
}

/** The card chrome: icon seat, title, health dot, body, and the open footer. */
function CardShell({ page, tone, loading, icon, t, onNavigate, children }: {
  readonly page: OverviewPageId
  readonly tone: OverviewTone
  readonly loading: boolean
  readonly icon: ReactNode
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
  readonly children: ReactNode
}): JSX.Element {
  return (
    <section className="dhp-ov-card" data-tone={tone} aria-label={t(TITLE_KEY[page])}>
      <div className="dhp-ov-head">
        <span className="dhp-ov-icon">{icon}</span>
        <span className="dhp-ov-title">{t(TITLE_KEY[page])}</span>
        <StateDot state={loading ? 'ongoing' : DOT_STATE[tone]} />
      </div>
      {children}
      <div className="dhp-ov-footer">
        <Button size="sm" className="dhp-ov-open" onClick={() => { onNavigate(page) }}>
          {t('overviewOpen')}
          <IconChevronRightOutlineRegular />
        </Button>
      </div>
    </section>
  )
}

/** Loading / error body shared by every card. */
function CardStateBody({ status, message, t }: {
  readonly status: 'loading' | 'error' | 'ready'
  readonly message: string | null
  readonly t: Translate
}): JSX.Element | null {
  if (status === 'loading') {
    return (
      <div className="dhp-skeleton" aria-label={t('loading')}>
        <span className="dhp-skeleton-bar" />
        <span className="dhp-skeleton-bar" />
      </div>
    )
  }
  if (status === 'error') {
    return <p className="dhp-error" role="alert">{t('error')} · {message}</p>
  }
  return null
}

/** The MCP health card. */
function McpCard({ card, t, onNavigate }: {
  readonly card: McpOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const open = (): void => { onNavigate('mcp') }
  return (
    <CardShell page="mcp" tone={card.tone} loading={card.status === 'loading'} icon={<IconApiOutlineRegular />} t={t} onNavigate={onNavigate}>
      <CardStateBody status={card.status} message={card.message} t={t} />
      {card.status === 'ready' ? (
        <>
          <p className="dhp-ov-headline">
            {card.total === 0 ? t('overviewMcpEmpty') : fill(t('overviewMcpHeadline'), { available: card.available, total: card.total })}
          </p>
          <p className="dhp-ov-facts">
            {fill(t('toolCount'), { count: card.tools })}
            {card.total - card.enabled > 0 ? ` · ${fill(t('overviewDisabled'), { count: card.total - card.enabled })}` : ''}
          </p>
          <IssueList issues={card.issues} t={t} onOpen={open} />
        </>
      ) : null}
    </CardShell>
  )
}

/** The Skills health card. */
function SkillsCard({ card, t, onNavigate }: {
  readonly card: SkillsOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const open = (): void => { onNavigate('skills') }
  const sessionNote = card.session === 'no-session'
    ? t('overviewNoSession')
    : card.session === 'unavailable'
      ? t('overviewUnavailable')
      : null
  return (
    <CardShell page="skills" tone={card.tone} loading={card.status === 'loading'} icon={<IconSkillOutlineRegular />} t={t} onNavigate={onNavigate}>
      <CardStateBody status={card.status} message={card.message} t={t} />
      {card.status === 'ready' ? (
        <>
          <p className="dhp-ov-headline">
            {card.total === 0 && card.session === 'ok' ? t('overviewSkillsEmpty') : fill(t('overviewSkillsHeadline'), { enabled: card.enabled, total: card.total })}
          </p>
          <p className="dhp-ov-facts">
            {sessionNote ?? (card.disabled > 0 ? fill(t('overviewDisabled'), { count: card.disabled }) : t('overviewAllGood'))}
          </p>
          <IssueList issues={card.issues} t={t} onOpen={open} />
        </>
      ) : null}
    </CardShell>
  )
}

/** The Hooks health card. */
function HooksCard({ card, t, onNavigate }: {
  readonly card: HooksOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const open = (): void => { onNavigate('hooks') }
  return (
    <CardShell page="hooks" tone={card.tone} loading={card.status === 'loading'} icon={<IconCodeOutlineRegular />} t={t} onNavigate={onNavigate}>
      <CardStateBody status={card.status} message={card.message} t={t} />
      {card.status === 'ready' ? (
        <>
          <p className="dhp-ov-headline">
            {card.bridges === 0 ? t('overviewHooksEmpty') : fill(t('overviewHooksHeadline'), { active: card.activeHooks, total: card.totalHooks })}
          </p>
          <p className="dhp-ov-facts">
            {fill(t('overviewHooksBridges'), { count: card.bridges })}
            {card.disabledHooks > 0 ? ` · ${fill(t('overviewDisabled'), { count: card.disabledHooks })}` : ''}
          </p>
          <IssueList issues={card.issues} t={t} onOpen={open} />
        </>
      ) : null}
    </CardShell>
  )
}

/** The AGENTS.md health card with its budget bar. */
function AgentsCard({ card, t, onNavigate }: {
  readonly card: AgentsOverviewCard
  readonly t: Translate
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const open = (): void => { onNavigate('agents') }
  const percent = card.maxBytes !== null && card.maxBytes > 0
    ? Math.round((card.renderedBytes / card.maxBytes) * 100)
    : null
  return (
    <CardShell page="agents" tone={card.tone} loading={card.status === 'loading'} icon={<IconContextInjectionOutlineRegular />} t={t} onNavigate={onNavigate}>
      <CardStateBody status={card.status} message={card.message} t={t} />
      {card.status === 'ready' ? (
        <>
          <p className="dhp-ov-headline">
            {card.maxBytes === null
              ? t('agentsStatusNotLoaded')
              : `${formatBytes(card.renderedBytes)} / ${formatBytes(card.maxBytes)}`}
          </p>
          {percent !== null ? (
            <div className="dhp-ov-bar" role="img" aria-label={fill(t('overviewBudget'), { percent })}>
              <span className="dhp-ov-bar-fill" data-hot={percent > 90 ? 'true' : undefined} style={{ width: `${Math.min(100, percent)}%` }} />
            </div>
          ) : null}
          <p className="dhp-ov-facts">
            {card.injecting ? fill(t('overviewAgentsFiles'), { count: card.loadedFiles }) : t('issueAgentsNotInjecting')}
          </p>
          <IssueList issues={card.issues} t={t} onOpen={open} />
        </>
      ) : null}
    </CardShell>
  )
}

/** The Overview page body. */
export function OverviewPage({ t, deps, onNavigate }: {
  readonly t: Translate
  readonly deps: OverviewPageDeps
  readonly onNavigate: (page: OverviewPageId) => void
}): JSX.Element {
  const [mcp, setMcp] = useState<Settled<McpSnapshot>>({ status: 'loading' })
  const [hooks, setHooks] = useState<Settled<HooksSnapshot>>({ status: 'loading' })
  const [skills, setSkills] = useState<Settled<OverviewSkillsInput>>({ status: 'loading' })
  const [agents, setAgents] = useState<Settled<AgentsSnapshot>>({ status: 'loading' })
  const [refreshing, setRefreshing] = useState(false)
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
  }, [deps])

  useEffect(() => {
    const controller = new AbortController()
    void loadAll(controller.signal)
    return () => { controller.abort() }
  }, [loadAll])

  const onRefresh = useCallback((): void => {
    setRefreshing(true)
    const controller = new AbortController()
    void loadAll(controller.signal).finally(() => {
      if (mounted.current) setRefreshing(false)
    })
  }, [loadAll])

  const model = buildOverview({ mcp, hooks, skills, agents })
  const [mcpCard, skillsCard, hooksCard, agentsCard] = model.cards

  return (
    <>
      <div className="dhp-toolbar">
        <p className="dhp-sub" role="status">
          {model.allReady
            ? model.attention > 0
              ? fill(t('overviewAttention'), { count: model.attention })
              : t('overviewAllGood')
            : ''}
        </p>
        <RefreshButton t={t} busy={refreshing} onClick={onRefresh} />
      </div>
      <div className="dhp-overview-grid">
        <McpCard card={mcpCard} t={t} onNavigate={onNavigate} />
        <SkillsCard card={skillsCard} t={t} onNavigate={onNavigate} />
        <HooksCard card={hooksCard} t={t} onNavigate={onNavigate} />
        <AgentsCard card={agentsCard} t={t} onNavigate={onNavigate} />
      </div>
    </>
  )
}
