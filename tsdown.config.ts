/**
 * Build faces for dsh-harness-panel. The node half (src/index.ts) is the host
 * Loader entry; the browser half (src/client/index.ts) is the client bundle
 * the shell serves for the plugin.
 *
 * The browser half follows the shell's client-bundle handshake exactly: a CJS
 * bundle wrapped in `window.__ModuleLoader__.load({ id, factory })`, with the
 * shell's platform modules left external (the factory's `require` answers
 * them from the frozen module table) and every other dependency inlined.
 */
import { defineConfig } from 'tsdown'

/** Plugin id: the patch row name, the graph row id, and the stamped bundle id all match. */
const PLUGIN_ID = 'dsh-harness-panel'

/**
 * Module specifiers the shell shares into the frozen browser module table
 * (packages/client/web/src/platform.ts, 0.2.x). Any value import outside this
 * list is inlined into the bundle.
 */
const PLATFORM_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

export default defineConfig([
  {
    name: PLUGIN_ID,
    entry: { index: 'src/index.ts' },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: false,
    fixedExtension: false,
    deps: {
      // Nothing from node_modules is bundled: peers stay external.
      neverBundle: [/^node:/],
    },
  },
  {
    name: `${PLUGIN_ID}/client`,
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: ['cjs'],
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    deps: {
      onlyBundle: false,
      alwaysBundle: (id: string) => (PLATFORM_EXTERNALS.includes(id) ? undefined : true),
      neverBundle: [...PLATFORM_EXTERNALS],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PLUGIN_ID)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
