/**
 * Build the browser half into the DSH client-bundle format
 * (same wrapper as dsh-convfusion and the official @deepseek-ai/* client bundles).
 *
 *   window.__ModuleLoader__.load({ id, factory: (require) => { ... } })
 *
 * react / react/jsx-runtime / @deepseek-ai/* stay external — the web shell provides
 * them as platform modules.
 */
import { build } from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const id = pkg.name

const result = await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime', '@deepseek-ai/*'],
  // The built-in default logo ships inside the bundle (base64), so the
  // default brand needs no network round-trip.
  loader: { '.png': 'base64' },
  write: false,
  sourcemap: false,
  logLevel: 'warning',
})

const code = result.outputFiles[0].text
const bundle = [
  'window.__ModuleLoader__.load({',
  `\tid: ${JSON.stringify(id)},`,
  '\tfactory: (require) => {',
  '\t\tvar module = { exports: {} };',
  '\t\tvar exports = module.exports;',
  '\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });',
  '\t\t' + code.trim().replace(/\n/g, '\n\t\t'),
  '\t\treturn module.exports;',
  '\t}',
  '});',
  '',
].join('\n')

mkdirSync(join(root, 'lib'), { recursive: true })
writeFileSync(join(root, 'lib/client.js'), bundle)
console.log(`client bundle -> lib/client.js (${(bundle.length / 1024).toFixed(1)} KiB)`)
