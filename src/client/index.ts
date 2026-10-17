/**
 * `dsh-harness-panel`, browser half: registers the Harness section into the
 * settings navigation (`settings.section`, below Usage Stats), mounts the
 * dictionaries and the scoped stylesheet, and binds the pages' data deps
 * (the shipped `skills` and `pluginManager` Remote namespaces + the sessions
 * store) into the section component.
 *
 * @module dsh-harness-panel/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement } from 'react'
import type { JSX } from 'react'
import { en, zh } from './locales.ts'
import { installPanelStyles } from './styles.ts'
import { HarnessSection, type HarnessSectionDeps } from './HarnessSection.tsx'
import type { SkillsRemoteFace } from './SkillsPage.tsx'
import type { PluginManagerRemoteFace } from './plugin-manager.ts'
import type { Translate } from './shared.ts'

/** Plugin name: matches the package name and the stamped bundle id. */
export const name = 'dsh-harness-panel'

/**
 * Services the section reads. The nested Remote names must be named
 * explicitly: cordis guards nested service access by dotted name.
 */
export const inject = ['slots', 'locale', 'remote', 'remote.skills', 'remote.pluginManager', 'sessions']

/** Dictionary namespace owned by this plugin. */
export const NS = 'settings.harnessPanel'

/**
 * Minimal structural contracts of the client services this plugin reads.
 * Declared locally so the bundle never value-imports a shell package.
 */
interface LocaleFace {
  register(ns: string, dicts: Record<string, Record<string, string>>): () => void
  bind(ns: string): Translate
}

interface SlotsFace {
  inject(slot: string, callback: () => unknown): void
  register(options: {
    name: 'settings.section'
    id: string
    order: number
    label: () => string
    locale: string
  }, component: unknown): () => void
}

interface ClientFace {
  readonly slots: SlotsFace
  readonly locale: LocaleFace
  readonly remote: {
    skills?: SkillsRemoteFace
    pluginManager?: PluginManagerRemoteFace
  } | undefined
  readonly sessions: unknown
}

/**
 * Browser plugin body: dictionaries, the scoped stylesheet, and the Harness
 * settings section registration.
 *
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const client = ctx as unknown as ClientFace
  ctx.effect(() => client.locale.register(NS, { zh, en }), 'dsh-harness-panel: dictionaries')
  ctx.effect(() => installPanelStyles(), 'dsh-harness-panel: stylesheet')

  const deps: HarnessSectionDeps = {
    skills: { skills: client.remote?.skills, sessions: client.sessions },
    pluginManager: client.remote?.pluginManager,
  }
  const Section = (props: { t: Translate }): JSX.Element =>
    createElement(HarnessSection, { ...props, deps })

  client.slots.inject('settings.section', () => client.slots.register({
    name: 'settings.section',
    id: 'harness',
    // Below Usage Stats (order 90), above any later community sections.
    order: 100,
    label: () => client.locale.bind(NS)('nav'),
    locale: NS,
  }, Section))
}
