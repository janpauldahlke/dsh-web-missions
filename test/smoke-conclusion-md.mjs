/**
 * Hermetic checks for the conclusion markdown subset renderer.
 * Builds a tiny entry that exports render helpers via react-dom/server.
 */
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Keep temp under the package root so external react/react-dom resolve upward.
const T = mkdtempSync(join(root, '.tmp-concl-'))
const entry = join(T, 'entry.tsx')
writeFileSync(
  entry,
  `
import { renderToStaticMarkup } from 'react-dom/server'
import { ConclusionMarkdown } from '../src/client/conclusionMd.tsx'

export function html(text) {
  return renderToStaticMarkup(<ConclusionMarkdown text={text} />)
}
`,
)

const out = join(T, 'out.mjs')
await build({
  entryPoints: [entry],
  outfile: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  define: { 'process.env.NODE_ENV': '"production"' },
})

const { html } = await import(out)
let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    console.log('ok  ', name)
    pass++
  } else {
    console.error('FAIL', name, detail)
    fail++
  }
}

const sample = `### Answer
- **OIDC:** trust record on npmjs.com [\`p-69cbf1aa\`](https://docs.npmjs.com/trusted-publishers)
- Use \`permissions: id-token: write\`

### When not
plain paragraph with **bold** and \`code\`.`

const h = html(sample)
check('renders h4 for ###', h.includes('<h4') && h.includes('Answer'))
check('renders bullets', h.includes('<ul') && h.includes('<li'))
check('renders strong', h.includes('<strong') && h.includes('OIDC'))
check('renders code', h.includes('<code') && h.includes('permissions: id-token: write'))
check('renders link', h.includes('<a') && h.includes('docs.npmjs.com'))
check('no raw html injection', !html('<script>x</script>').includes('<script>x</script>'))
check('plain wall still readable', html('one long paragraph').includes('one long paragraph'))

rmSync(T, { recursive: true, force: true })
if (fail > 0) {
  console.error(`conclusion-md smoke: ${fail} failed`)
  process.exit(1)
}
console.log(`conclusion-md smoke: all checks passed (${pass})`)
