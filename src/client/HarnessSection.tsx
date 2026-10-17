/**
 * The Harness settings section: a heading, an intro line, and the underline
 * tab strip (MCP / Skills / Hooks) around the three pages. The tab chrome
 * mirrors the shipped Plugins settings section; pages mount lazily on first
 * selection and stay mounted so their local state survives switching.
 *
 * @module dsh-harness-panel/client/HarnessSection
 */

import { useEffect, useId, useRef, useState } from 'react'
import type { JSX } from 'react'
import { McpPage } from './McpPage.tsx'
import { SkillsPage, type SkillsPageDeps } from './SkillsPage.tsx'
import { HooksPage } from './HooksPage.tsx'
import type { PluginManagerRemoteFace } from './plugin-manager.ts'
import type { Translate } from './shared.ts'

/** The fixed page set, in tab order. */
const PAGES = [
  { id: 'mcp', labelKey: 'tabMcp' },
  { id: 'skills', labelKey: 'tabSkills' },
  { id: 'hooks', labelKey: 'tabHooks' },
] as const

type PageId = (typeof PAGES)[number]['id']

/** Services the pages read, bound by the plugin's apply closure. */
export interface HarnessSectionDeps {
  readonly skills: SkillsPageDeps
  /** `remote.pluginManager`; absent only when the namespace is not mounted. */
  readonly pluginManager: PluginManagerRemoteFace | undefined
}

/** The section component. */
export function HarnessSection({ t, deps }: {
  readonly t: Translate
  readonly deps: HarnessSectionDeps
}): JSX.Element {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [activeId, setActiveId] = useState<PageId>('mcp')
  const [visited, setVisited] = useState<ReadonlySet<PageId>>(() => new Set(['mcp']))

  useEffect(() => {
    setVisited(previous => previous.has(activeId) ? previous : new Set([...previous, activeId]))
  }, [activeId])

  return (
    <div data-dsh-harness-panel="">
      <h2 className="dhp-heading">{t('title')}</h2>
      <p className="dhp-intro">{t('intro')}</p>
      <div className="dhp-tabs" role="tablist" aria-label={t('title')}>
        {PAGES.map((page, index) => {
          const selected = page.id === activeId
          return (
            <button
              key={page.id}
              ref={(element) => { tabRefs.current[index] = element }}
              id={`${tabsId}-tab-${page.id}`}
              type="button"
              role="tab"
              className="dhp-tab"
              aria-selected={selected}
              aria-controls={`${tabsId}-panel-${page.id}`}
              data-active={selected ? 'true' : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => { setActiveId(page.id) }}
              onKeyDown={(event) => {
                let nextIndex: number
                switch (event.key) {
                  case 'ArrowRight': nextIndex = (index + 1) % PAGES.length; break
                  case 'ArrowLeft': nextIndex = (index - 1 + PAGES.length) % PAGES.length; break
                  case 'Home': nextIndex = 0; break
                  case 'End': nextIndex = PAGES.length - 1; break
                  default: return
                }
                event.preventDefault()
                const next = PAGES[nextIndex] as (typeof PAGES)[number]
                setActiveId(next.id)
                tabRefs.current[nextIndex]?.focus()
              }}
            >
              {t(page.labelKey)}
            </button>
          )
        })}
      </div>
      {PAGES.filter(page => page.id === activeId || visited.has(page.id)).map(page => {
        const selected = page.id === activeId
        return (
          <div
            key={page.id}
            id={`${tabsId}-panel-${page.id}`}
            className="dhp-panel"
            role="tabpanel"
            aria-labelledby={`${tabsId}-tab-${page.id}`}
            hidden={!selected}
          >
            {page.id === 'mcp' ? <McpPage t={t} deps={{ pluginManager: deps.pluginManager }} />
              : page.id === 'skills' ? <SkillsPage t={t} deps={deps.skills} />
              : <HooksPage t={t} deps={{ pluginManager: deps.pluginManager }} />}
          </div>
        )
      })}
    </div>
  )
}
