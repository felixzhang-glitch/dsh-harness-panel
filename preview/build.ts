/**
 * Builds the panel preview: one module bundle plus an HTML shell that carries
 * the shipped theme token sheets and the panel's own stylesheet.
 *
 *   bun preview/build.ts && open preview/dist/index.html
 *
 * The primitives package is swapped for preview/primitives.tsx: its real build
 * ships CSS modules that only resolve inside the shell's bundler.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const here = import.meta.dir
const dist = join(here, 'dist')
mkdirSync(dist, { recursive: true })

const result = await Bun.build({
  entrypoints: [join(here, 'entry.tsx')],
  outdir: dist,
  target: 'browser',
  format: 'esm',
  minify: false,
  naming: 'preview.js',
  define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{
    name: 'preview-atoms',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ }, () => ({
        path: join(here, 'primitives.tsx'),
      }))
      // React is installed without its DOM renderer; the Bun cache holds a
      // matched react/react-dom/scheduler triple, so the preview pins all
      // three to one version instead of half-installing a dependency tree.
      const cache = join(process.env.HOME ?? '', '.bun/install/cache')
      const react = join(cache, 'react@19.2.8@@@1')
      const reactDom = join(cache, 'react-dom@19.2.8@@@1')
      const scheduler = join(cache, 'scheduler@0.27.0@@@1')
      build.onResolve({ filter: /^react$/ }, () => ({ path: join(react, 'index.js') }))
      build.onResolve({ filter: /^react\/jsx-runtime$/ }, () => ({ path: join(react, 'jsx-runtime.js') }))
      build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({ path: join(react, 'jsx-dev-runtime.js') }))
      build.onResolve({ filter: /^react-dom$/ }, () => ({ path: join(reactDom, 'index.js') }))
      build.onResolve({ filter: /^react-dom\/client$/ }, () => ({ path: join(reactDom, 'client.js') }))
      build.onResolve({ filter: /^scheduler$/ }, () => ({ path: join(scheduler, 'index.js') }))
    },
  }],
})

if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}

const tokens = readFileSync(join(here, 'vendor/base.css'), 'utf8')
  + readFileSync(join(here, 'vendor/design-platform.css'), 'utf8')

// Inline the module: Chrome refuses to fetch a `type="module"` script over
// file://, and the harness has to work by opening the file directly.
const bundle = readFileSync(join(dist, 'preview.js'), 'utf8').replaceAll('</script', '<\\/script')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness panel preview</title>
<style>${tokens}</style>
<style>
  html, body { margin: 0; min-height: 100%; }
  body {
    font-family: var(--dsw-font-family);
    font-size: 13px;
    line-height: 20px;
    color: var(--dsw-alias-label-primary);
    background: var(--dsw-alias-bg-base);
    -webkit-font-smoothing: antialiased;
  }
  * { box-sizing: border-box; }
</style>
</head>
<body>
<script type="module">${bundle}</script>
</body>
</html>`

writeFileSync(join(dist, 'index.html'), html)
console.log('preview built: ' + join(dist, 'index.html'))
