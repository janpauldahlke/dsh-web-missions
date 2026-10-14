// Browser39Fetcher live smoke (M2 slice 2.3).
// - Bundles a TS harness (local HTTP server + fetch assertions) with esbuild.
// - Also bundles a tiny resolution harness INSIDE the repo to verify the
//   production binary-resolution path (plugin node_modules via import.meta.url).
// Exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const abs = (p) => join(here, p).split(/[\\/]/).join('/')

// --- locate the real platform binary (outer script runs from the repo) -------
const outerRequire = createRequire(import.meta.url)
let platformBin = null
for (const name of [
  '@aquintanar/browser39-linux-x64',
  '@aquintanar/browser39-linux-arm64',
  '@aquintanar/browser39-darwin-x64',
  '@aquintanar/browser39-darwin-arm64',
  '@aquintanar/browser39-win32-x64',
]) {
  try {
    const pkgJson = outerRequire.resolve(`${name}/package.json`)
    const candidate = join(dirname(pkgJson), 'bin', 'browser39')
    if (existsSync(candidate)) {
      platformBin = candidate
      break
    }
  } catch {
    // platform optional-dep not installed here — keep looking
  }
}
if (!platformBin) {
  console.error('FATAL: could not locate the platform browser39 binary in node_modules')
  process.exit(1)
}

// --- main harness -------------------------------------------------------------
const harness = `
import http from 'node:http'
import { Browser39Fetcher, FetchError, assessQuality } from '${abs('../src/host/fetcher.ts')}'
import { normalizeUrl } from '${abs('../src/host/normalize.ts')}'

const B39_BIN = process.env.SMOKE_B39_BIN
if (!B39_BIN) { console.error('FATAL: SMOKE_B39_BIN not set'); process.exit(1) }

const LONG = 'SENTINEL-FULL-TEXT ' + 'lorem ipsum dolor sit amet '.repeat(60)
const FILLER = 'neutral filler text with no special words '.repeat(12)

const pages = {
  '/target': {
    body: '<html><head><title>Target Page</title></head><body>' +
      '<h1>Target</h1><p>' + LONG + '</p><a href="/other">the other page</a>' +
      '</body></html>',
  },
  '/short': { body: '<html><head><title>Short</title></head><body><p>Tiny page body.</p></body></html>' },
  '/cmp': {
    body: '<html><head><title>Consent</title></head><body>' +
      '<div>This page has a cookie consent banner. Please accept all to continue.</div>' +
      '<p>' + FILLER + '</p></body></html>',
  },
  '/missing': {
    status: 404,
    body: '<html><head><title>404 Not Found</title></head><body>Not Found Here</body></html>',
  },
  '/redirect': { status: 302, headers: { Location: '/target?arrived=1' }, body: '' },
  '/slow': { body: '<html><head><title>Slow</title></head><body><p>' + LONG + '</p></body></html>', delayMs: 2500 },
}

let fail = 0
function check(label, cond, detail) {
  if (cond) { console.log('ok   ' + label) } else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) }
}
function expectError(label, promise, wantCode, msgPart) {
  return promise.then(
    (page) => { fail++; console.error('FAIL ' + label + ' :: expected error, got page status ' + page.status) },
    (e) => {
      if (!(e instanceof FetchError) || e.code !== wantCode) {
        fail++; console.error('FAIL ' + label + ' :: wrong error ' + e + ' (code ' + e.code + ')')
        return
      }
      check(label, msgPart === null ? true : e.message.toLowerCase().includes(msgPart.toLowerCase()), 'msg=' + e.message)
    },
  )
}

const server = http.createServer((req, res) => {
  const spec = pages[req.url.split('?')[0]]
  if (!spec) { res.writeHead(404); res.end('nope'); return }
  const send = () => {
    res.writeHead(spec.status || 200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, spec.headers || {}))
    res.end(spec.body)
  }
  if (spec.delayMs) setTimeout(send, spec.delayMs)
  else send()
})

const main = async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port
  const fetcher = new Browser39Fetcher({ browser39Bin: B39_BIN })

  // T1: full page
  const p1 = await fetcher.fetch(base + '/target')
  check('t1 status 200', p1.status === 200, 'status=' + p1.status)
  check('t1 quality full', p1.quality === 'full', JSON.stringify(p1.qualitySignals))
  check('t1 content has sentinel', p1.content.includes('SENTINEL-FULL-TEXT'), p1.content.slice(0, 120))
  check('t1 title', p1.title === 'Target Page', p1.title)
  check('t1 finalUrl', p1.finalUrl === base + '/target', p1.finalUrl)
  check('t1 link resolved absolute', p1.links.some((l) => l.url === base + '/other' && l.text === 'the other page'), JSON.stringify(p1.links))
  check('t1 consent flags false', p1.consentAttempted === false && p1.consentImproved === false)
  check('t1 byteLength > 0', p1.byteLength > 0, 'bytes=' + p1.byteLength)
  check('t1 fetchedAt ISO', !Number.isNaN(Date.parse(p1.fetchedAt)), p1.fetchedAt)
  check('t1 ledger key stable', normalizeUrl(p1.finalUrl) === normalizeUrl(base + '/target'))

  // T2: thin by length
  const p2 = await fetcher.fetch(base + '/short')
  check('t2 quality thin', p2.quality === 'thin', JSON.stringify(p2.qualitySignals))
  check('t2 signal text<300chars', p2.qualitySignals.includes('text<300chars'), JSON.stringify(p2.qualitySignals))

  // T3: thin by CMP markers
  const p3 = await fetcher.fetch(base + '/cmp')
  check('t3 quality thin', p3.quality === 'thin', JSON.stringify(p3.qualitySignals))
  check('t3 signal cmp-marker:cookie', p3.qualitySignals.includes('cmp-marker:cookie'), JSON.stringify(p3.qualitySignals))
  check('t3 signal cmp-marker:consent', p3.qualitySignals.includes('cmp-marker:consent'), JSON.stringify(p3.qualitySignals))

  // T4: blocked 404 (ok:true line with status — NOT an error line)
  const p4 = await fetcher.fetch(base + '/missing')
  check('t4 quality blocked', p4.quality === 'blocked', JSON.stringify(p4.qualitySignals))
  check('t4 signal http-404', p4.qualitySignals.includes('http-404'), JSON.stringify(p4.qualitySignals))
  check('t4 status 404', p4.status === 404, 'status=' + p4.status)

  // T5: redirect — finalUrl is the post-redirect URL
  const p5 = await fetcher.fetch(base + '/redirect')
  check('t5 finalUrl has arrived=1', p5.finalUrl.includes('?arrived=1'), p5.finalUrl)
  check('t5 quality full (target content)', p5.quality === 'full', JSON.stringify(p5.qualitySignals))

  // T6: timeout (slow endpoint, 800 ms budget)
  const slowFetcher = new Browser39Fetcher({ browser39Bin: B39_BIN, fetchTimeoutMs: 800 })
  await expectError('t6 timeout -> fetch_failed', slowFetcher.fetch(base + '/slow'), 'fetch_failed', 'timed out')

  // T7: connection refused -> fetch_failed with HTTP_ERROR code
  await expectError('t7 dead port -> fetch_failed', fetcher.fetch('http://127.0.0.1:9/'), 'fetch_failed', 'HTTP_ERROR')

  // T8: dead binary path -> spawn_failed
  const deadFetcher = new Browser39Fetcher({ browser39Bin: '/nonexistent/b39' })
  await expectError('t8 dead bin -> spawn_failed', deadFetcher.fetch(base + '/target'), 'spawn_failed', null)

  // T9: quality unit checks
  check('t9 status 500 blocked', assessQuality({ status: 500, title: '', content: 'x'.repeat(500), thinThresholdChars: 300 }).quality === 'blocked')
  check('t9 empty content blocked', assessQuality({ status: 200, title: '', content: '   ', thinThresholdChars: 300 }).quality === 'blocked')
  check('t9 301 chars full', assessQuality({ status: 200, title: '', content: 'x'.repeat(301), thinThresholdChars: 300 }).quality === 'full')
  check('t9 299 chars thin', assessQuality({ status: 200, title: '', content: 'x'.repeat(299), thinThresholdChars: 300 }).quality === 'thin')
  // Soft signals (R2.5): keep quality=full but flag chrome / JS shells.
  const js403 = assessQuality({ status: 403, title: 'Blocked', content: 'Please enable JavaScript to continue.', thinThresholdChars: 300 })
  check('t10 403 → blocked + js_required', js403.quality === 'blocked' && js403.qualitySignals.includes('js_required'), JSON.stringify(js403))
  const chrome = assessQuality({
    status: 200,
    title: 'Odds',
    content: ('<nav>' + 'menu '.repeat(200) + '</nav>' + ' '.repeat(50)).repeat(2),
    thinThresholdChars: 300,
  })
  check('t11 chrome-long → full + low_density', chrome.quality === 'full' && chrome.qualitySignals.includes('low_density'), JSON.stringify(chrome))
  const shortFull = assessQuality({ status: 200, title: '', content: 'x'.repeat(400), thinThresholdChars: 300 })
  check('t12 short full stays clean (no soft)', shortFull.quality === 'full' && shortFull.qualitySignals.length === 0, JSON.stringify(shortFull))

  console.log(fail === 0 ? 'smoke-fetcher: all checks passed' : 'smoke-fetcher: ' + fail + ' FAILURES')
  server.close()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => { console.error('FATAL harness error: ' + (e && e.stack || e)); server.close(); process.exit(1) })
`

const { spawnSync } = await import('node:child_process')
const dir = mkdtempSync(join(tmpdir(), 'smoke-fetcher-'))
// M5 5.4: hermetic host-scoped session dirs (never touch ~/.dsh/browser39/sessions).
process.env.BROWSER39_SESSIONS_DIR = join(dir, 'b39-sessions')
let rc = 1
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
  // Child process: the harness may call process.exit freely.
  const out = spawnSync(process.execPath, [join(dir, 'harness.mjs')], {
    encoding: 'utf8',
    env: { ...process.env, SMOKE_B39_BIN: platformBin },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  rc = out.status === 0 ? 0 : 1
  if (out.status !== 0) console.error('main harness exit ' + out.status)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

// --- production resolution check (bundle lives INSIDE the repo) ---------------
const resolveDir = join(repoRoot, '.smoke-fetcher-resolve')
const resolveHarness = `
import { resolveBrowser39Bin } from '${abs('../src/host/fetcher.ts')}'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

let fail = 0
const r = resolveBrowser39Bin()
if (!r) { fail++; console.error('FAIL resolve: null in repo context') }
else if (r.cmd !== process.execPath) { fail++; console.error('FAIL resolve: cmd=' + r.cmd + ' want ' + process.execPath) }
else if (!r.args[0] || !r.args[0].endsWith('node_modules/@aquintanar/browser39/bin.js')) {
  fail++; console.error('FAIL resolve: args=' + JSON.stringify(r.args))
} else if (!existsSync(r.args[0])) { fail++; console.error('FAIL resolve: bin.js missing: ' + r.args[0]) }
else console.log('ok   resolve: ' + r.cmd + ' ' + r.args[0])
process.exit(fail === 0 ? 0 : 1)
`
try {
  rmSync(resolveDir, { recursive: true, force: true })
  mkdirSync(resolveDir, { recursive: true })
  writeFileSync(join(resolveDir, 'resolve-harness.ts'), resolveHarness)
  buildSync({
    entryPoints: [join(resolveDir, 'resolve-harness.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: join(resolveDir, 'resolve-harness.mjs'),
    absWorkingDir: here,
  })
  const out = spawnSync(process.execPath, [join(resolveDir, 'resolve-harness.mjs')], { encoding: 'utf8' })
  process.stdout.write(out.stdout)
  if (out.stderr) process.stderr.write(out.stderr)
  if (out.status !== 0) { rc = 1; console.error('FAIL resolve harness exit ' + out.status) }
} finally {
  rmSync(resolveDir, { recursive: true, force: true })
}

process.exit(rc)
