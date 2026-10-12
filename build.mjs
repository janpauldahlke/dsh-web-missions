/**
 * dsh-local-web-missions build: two artifacts, one package.
 *
 * - lib/index.js  — host half (ESM, node)
 * - lib/client.js — browser half (CJS ModuleLoader factory)
 *
 * Mirrors dsh-memento packaging (skills/dsh-out-of-tree-plugin).
 */
import { build } from 'esbuild'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const id = pkg.name

/** Frozen shell module-table baseline — the only runtime requests allowed. */
const PLATFORM_EXTERNALS = [
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

await mkdir(join(root, 'lib'), { recursive: true })

// ---- host half (ESM, node) -------------------------------------------------
await build({
  entryPoints: [join(root, 'src/host/index.ts')],
  outfile: join(root, 'lib/index.js'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  sourcemap: true,
  external: ['@deepseek-ai/*'],
  logLevel: 'warning',
})

// ---- client half (CJS, browser ModuleLoader factory) ------------------------
await build({
  entryPoints: [join(root, 'src/client/index.tsx')],
  outfile: join(root, 'lib/client.js'),
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  sourcemap: true,
  define: { 'process.env.NODE_ENV': '"production"' },
  external: [...PLATFORM_EXTERNALS, '@deepseek-ai/*'],
  banner: {
    js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
  logLevel: 'warning',
})

console.log(`[dsh-local-web-missions] built lib/index.js + lib/client.js for ${id}`)
