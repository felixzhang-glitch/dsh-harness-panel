/**
 * Preview entry: mounts the real Harness section with stubbed platform atoms
 * against the fixtures. Query flags: lang=en, dark=1, tab=<0..4>.
 */

import { createRoot } from 'react-dom/client'
import type { JSX } from 'react'
import { HarnessSection } from '../src/client/HarnessSection.tsx'
import { installPanelStyles } from '../src/client/styles.ts'
import { en, zh } from '../src/client/locales.ts'
import type { HarnessPanelLocaleKey } from '../src/client/locales.ts'
import { agents, hooks, mcp, pluginRows, route, sessions, skillCatalog, disabledSkills } from './fixtures.ts'

const params = new URLSearchParams(window.location.search)

if (params.get('dark') === '1') document.body.dataset.dsDarkTheme = ''

const dict = params.get('lang') === 'en' ? en : zh
const t = (key: HarnessPanelLocaleKey): string => dict[key]

// The panel's host routes, answered from fixtures.
window.fetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const body = route(url, params.get('quiet') === '1')
  if (body === undefined) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}

installPanelStyles()

const section = (
  <HarnessSection
    t={t}
    deps={{
      skills: {
        skills: {
          list: async (): Promise<{ ok: true; value: { skills: typeof skillCatalog } }> => {
            const limit = Number(params.get('limit') ?? '0')
            return { ok: true, value: { skills: limit > 0 ? skillCatalog.slice(0, limit) : skillCatalog } }
          },
        },
        sessions,
      },
      pluginManager: {
        listPlugins: async () => ({ ok: true as const, value: pluginRows }),
        setPluginEnabled: async () => ({ ok: true as const, value: { changed: true, application: 'applied' as const } }),
      },
      agents: { sessions },
    }}
  />
) as JSX.Element

const root = document.createElement('div')
root.style.width = '100%'
root.style.maxWidth = '760px'
root.style.margin = '0 auto'
root.style.padding = '28px 24px 64px'
document.body.append(root)
document.body.style.background = 'var(--dsw-alias-bg-base)'
createRoot(root).render(section)

// Deep-link one tab: the pages mount lazily, so a click is the honest path.
const tab = params.get('tab')
const open = params.get('open')
if (tab !== null) {
  setTimeout(() => {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.dhp-tab')
    buttons[Number(tab)]?.click()
    if (open === null) return
    setTimeout(() => {
      const rows = document.querySelectorAll<HTMLButtonElement>('.dhp-row-toggle')
      rows[Number(open)]?.click()
    }, 120)
  }, 30)
}

// Report the rendered height so a screenshot can be taken at exactly the
// content size (no dead space below the panel).
setTimeout(() => {
  document.documentElement.dataset.contentHeight = String(Math.ceil(document.body.scrollHeight))
}, 900)

// Quiet surface used by the harness: the fixture count is the only signal the
// preview needs to confirm all four sources settled.
void disabledSkills
void agents
void hooks
void mcp
