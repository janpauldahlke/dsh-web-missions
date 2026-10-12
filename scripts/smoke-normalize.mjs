// C2 normalization unit checks (M2 slice 2.2).
// Bundles a TS harness with esbuild, runs it, exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

const normPath = join(here, '../src/host/normalize.ts').split(/[\\/]/).join('/')
const storePath = join(here, '../src/host/store.ts').split(/[\\/]/).join('/')

const harness = `
import { normalizeUrl } from '${normPath}'
import { StoreError } from '${storePath}'

const cases = [
  // [input, expected]
  ['https://example.com', 'https://example.com'],
  ['https://example.com/', 'https://example.com'],
  ['https://example.com///', 'https://example.com'],
  ['https://EXAMPLE.com', 'https://example.com'],
  ['https://example.com/Path/Keep/Case', 'https://example.com/Path/Keep/Case'],
  ['https://example.com:443/', 'https://example.com'],
  ['http://example.com:80/', 'http://example.com'],
  ['http://example.com:8080/', 'http://example.com:8080'],
  ['https://example.com/a/b/', 'https://example.com/a/b'],
  ['https://example.com/page#frag', 'https://example.com/page'],
  ['https://example.com/?b=2&a=1#f', 'https://example.com?a=1&b=2'],
  ['https://example.com/page?b=2&a=1', 'https://example.com/page?a=1&b=2'],
  ['https://example.com/page?a=2&a=1', 'https://example.com/page?a=1&a=2'],
  ['https://example.com/page?a=1&a=2', 'https://example.com/page?a=1&a=2'],
  ['https://user:pass@example.com/p', 'https://user:pass@example.com/p'],
  ['https://user@example.com/p', 'https://user@example.com/p'],
  ['https://example.com/p?a=1+b', 'https://example.com/p?a=1%20b'],
  ['https://example.com/p?z=1&z=1', 'https://example.com/p?z=1&z=1'],
]

let fail = 0
for (const [input, expected] of cases) {
  const got = normalizeUrl(input)
  if (got !== expected) {
    fail++
    console.error(\`FAIL normalizeUrl(\${JSON.stringify(input)}) = \${JSON.stringify(got)} want \${JSON.stringify(expected) }\`)
  }
}

// error cases: must throw StoreError with code normalize_failed, before any spawn
const bad = [
  'not a url at all',
  'example.com',
  '://missing-scheme',
  'mailto:x@example.com',
  'ftp://example.com/file',
  'javascript:alert(1)',
]
for (const input of bad) {
  try {
    const got = normalizeUrl(input)
    fail++
    console.error(\`FAIL normalizeUrl(\${JSON.stringify(input)}) returned \${JSON.stringify(got)} want StoreError normalize_failed\`)
  } catch (e) {
    if (!(e instanceof StoreError) || e.code !== 'normalize_failed') {
      fail++
      console.error(\`FAIL normalizeUrl(\${JSON.stringify(input)}) threw wrong error: \${e && e.code} \${e && e.message}\`)
    }
  }
}

// idempotence: normalizing a normalized key is a no-op
for (const [input] of cases) {
  const once = normalizeUrl(input)
  const twice = normalizeUrl(once)
  if (once !== twice) {
    fail++
    console.error(\`FAIL idempotence for \${JSON.stringify(input)}: \${JSON.stringify(once)} -> \${JSON.stringify(twice)}\`)
  }
}

console.log(fail === 0 ? \`smoke-normalize: all cases passed (\${cases.length} mapping + \${bad.length} error + \${cases.length} idempotence)\` : \`smoke-normalize: \${fail} FAILURES\`)
process.exit(fail === 0 ? 0 : 1)
`

const dir = mkdtempSync(join(tmpdir(), 'smoke-normalize-'))
try {
  writeFileSync(join(dir, 'harness.ts'), harness)
  buildSync({
    entryPoints: [join(dir, 'harness.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: join(dir, 'harness.mjs'),
    absWorkingDir: here,
  })
  await import(pathToFileURL(join(dir, 'harness.mjs')).href)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
