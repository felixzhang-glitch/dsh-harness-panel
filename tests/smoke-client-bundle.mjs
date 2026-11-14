// Runtime smoke test of the BUILT client bundle: execute lib/client.js's
// module factory with stubbed platform externals and a minimal DOM, then run
// apply() and the registered section factory to confirm the plugin wires up
// without throwing. No new dependencies; uses the local react.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const React = require('react')

// Minimal DOM stub for installPanelStyles (querySelector/createElement/head).
const styleElements = []
const head = { append: (el) => { styleElements.push(el) } }
const documentStub = {
  head,
  querySelector: () => null,
  createElement: (tag) => ({ tagName: tag, dataset: {}, textContent: '', remove() {} }),
}

// Platform externals the shell normally provides.
const dummyComponent = (name) => {
  const C = (props) => React.createElement('div', { 'data-stub': name }, props?.children ?? null)
  C.displayName = name
  return C
}
const primitivesStub = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'relativeTime') return (at, now) => ({ unit: 'minutes', n: Math.max(0, Math.round((now - at) / 60000)) })
    if (prop === 'writeClipboard') return async () => true
    if (typeof prop === 'string') return dummyComponent(prop)
    return undefined
  },
})
const externals = {
  'react': React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-dom': { createRoot: () => ({ render() {}, unmount() {} }) },
  'react-dom/client': { createRoot: () => ({ render() {}, unmount() {} }) },
  '@deepseek-ai/cordis': {},
  '@deepseek-ai/dsh-client-ui-primitives': primitivesStub,
  '@deepseek-ai/dsh-client-store': {},
  '@deepseek-ai/dsh-client-ui-slots': {},
  '@deepseek-ai/dsh-client-ui-dockkit': {},
}

let captured = null
const windowStub = {
  __ModuleLoader__: { load: (entry) => { captured = entry } },
}

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const sandbox = {
  window: windowStub,
  document: documentStub,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  TextEncoder, TextDecoder, URL, URLSearchParams,
  fetch: async () => { throw new Error('no network in smoke test') },
  AbortController,
  require: (id) => {
    if (id in externals) return externals[id]
    throw new Error('unexpected require: ' + id)
  },
  module: { exports: {} },
  exports: {},
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'lib/client.js' })

if (captured === null) throw new Error('bundle did not register a module factory')
if (captured.id !== 'dsh-harness-panel') throw new Error('wrong bundle id: ' + captured.id)

const exports = captured.factory(sandbox.require)
if (typeof exports.apply !== 'function') throw new Error('client export has no apply()')
if (exports.name !== 'dsh-harness-panel') throw new Error('wrong plugin name')

// Mock client context capturing registrations.
const registrations = { locales: [], sections: [], effects: [] }
const translate = (key) => key
const ctx = {
  effect: (fn, label) => { registrations.effects.push(label); const dispose = fn(); return dispose },
  get: () => undefined,
  on: () => () => {},
  logger: { warn() {}, error() {} },
}
const client = {
  slots: {
    inject: (slot, cb) => { registrations.sections.push({ slot, cb }) },
    register: (opts, component) => { registrations.sections.push({ opts, component }); return () => {} },
  },
  locale: {
    register: (ns, dicts) => { registrations.locales.push({ ns, dicts }); return () => {} },
    bind: () => translate,
  },
  remote: { skills: undefined, pluginManager: undefined },
  sessions: undefined,
}
// apply reads ctx as the client face.
Object.assign(ctx, client)
exports.apply(ctx)

if (registrations.locales.length !== 1) throw new Error('expected one dictionary registration')
const { ns, dicts } = registrations.locales[0]
if (ns !== 'settings.harnessPanel') throw new Error('wrong locale namespace')
const zhKeys = Object.keys(dicts.zh).sort()
const enKeys = Object.keys(dicts.en).sort()
if (JSON.stringify(zhKeys) !== JSON.stringify(enKeys)) throw new Error('zh/en key mismatch in built bundle')
if (!dicts.zh.tabOverview || !dicts.en.tabOverview) throw new Error('Overview locale key missing in built bundle')
if (styleElements.length !== 1) throw new Error('expected one stylesheet installation')
if (!styleElements[0].textContent.includes('dhp-overview-grid')) throw new Error('overview styles missing in built bundle')

// The settings.section inject callback registers the section component.
const injectEntry = registrations.sections.find(s => s.slot === 'settings.section')
if (injectEntry === undefined) throw new Error('settings.section not injected')
injectEntry.cb()
const sectionEntry = registrations.sections.find(s => s.opts?.name === 'settings.section')
if (sectionEntry === undefined) throw new Error('section component not registered')
if (sectionEntry.opts.id !== 'harness') throw new Error('wrong section id')

// Render the section element tree shallowly to confirm it constructs without throwing.
const Section = sectionEntry.component
const element = React.createElement(Section, { t: translate })
if (element === null) throw new Error('section element is null')

console.log('SMOKE OK: bundle factory + apply() ran; locales', zhKeys.length, 'keys; overview styles present; section registered')
