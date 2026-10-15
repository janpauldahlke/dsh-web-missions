// Allowlist smoke (M5 slice 5.2 — egress control, dogfood on, deny-all default):
//   A) service level (tmpdir bundle, fake counting fetcher — zero real spawns):
//      pattern grammar (exact host / *.suffix incl. apex / origin+path prefix),
//      comment + blank skipping, case normalization, invalid lines →
//      allowlist_invalid (with line number), isAllowed matrix, allowlistPath,
//      loadAllowlist missing → [] (deny all), gate via runFetch: deny-all
//      default (no file) → allowlist_denied with ZERO spawn + zero budget
//      charge, exact host / suffix / origin+path admission, cache hits are
//      NOT re-gated (deny-all file after storage → hit still succeeds),
//      force IS re-gated, config allowlist:'off' disables the gate,
//      gate order (exhausted + denied → allowlist_denied, not budget_exhausted),
//      unreadable file → allowlist_unreadable.
//   B) tool level (BUILT lib, real browser39 + local HTTP server):
//      no file → allowlist_denied envelope (no spawn: server saw 0 requests),
//      origin+path pattern admits /target (charged), denies same-host /missing
//      (zero spawn), cache hit survives a rewritten deny-all file, force under
//      deny-all → allowlist_denied (no spawn), config allowlist:'off' lets a
//      non-allowlisted path through (blocked receipt, charged).
// Exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const abs = (p) => join(here, p).split(/[\\/]/).join('/')

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
    if (existsSync(candidate)) { platformBin = candidate; break }
  } catch { /* not installed */ }
}
if (!platformBin) {
  console.error('FATAL: platform browser39 binary not found in node_modules')
  process.exit(1)
}

// --- shared local server with per-path request counts (embedded) -------------
const serverCode = `
const pages = {
  '/target': {
    body: '<html><head><title>Target Page</title></head><body>' +
      '<h1>Target</h1><p>' + 'SENTINEL-ALLOWLIST-TEXT ' + 'lorem ipsum dolor sit amet '.repeat(120) + '</p></body></html>',
  },
  '/missing': { status: 404, body: '<html><head><title>404 Not Found</title></head><body>Not Found Here</body></html>' },
}
const hits = {}
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  hits[path] = (hits[path] || 0) + 1
  const spec = pages[path]
  if (!spec) { res.writeHead(404); res.end('nope'); return }
  res.writeHead(spec.status || 200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(spec.body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
`

// --- Harness A: service level (fake counting fetcher) --------------------------
const harnessA = `
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, rmdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { runFetch } from '${abs('../src/host/fetch-service.ts')}'
import { startMission, readManifest, missionStatus, StoreError } from '${abs('../src/host/store.ts')}'
import { configPath } from '${abs('../src/host/config.ts')}'
import { parseAllowlist, isAllowed, loadAllowlist, checkAllowlist, allowlistPath } from '${abs('../src/host/allowlist.ts')}'
import type { FetchedPage } from '${abs('../src/shared/types.ts')}'

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const mkPage = (url, over): FetchedPage => ({
  finalUrl: url,
  status: 200,
  title: 'T',
  content: 'allowlist content for ' + url + ' '.repeat(120),
  links: [],
  quality: 'full',
  qualitySignals: [],
  consentAttempted: false,
  consentImproved: false,
  byteLength: 400,
  fetchedAt: new Date().toISOString(),
  ...over,
})

const root = join(mkdtempSync(join('/tmp', 'smoke-allowlist-')), 'root')
const allowPath = allowlistPath(root)
check('path: dirname(root)/allowlist.txt', allowPath === join(dirname(root), 'allowlist.txt'), allowPath)

// --- pure parse
check('parse: host', JSON.stringify(parseAllowlist('a.example')) === JSON.stringify([{ kind: 'host', host: 'a.example' }]))
check('parse: suffix', JSON.stringify(parseAllowlist('*.example.com')) === JSON.stringify([{ kind: 'suffix', suffix: 'example.com' }]))
check('parse: originPath', JSON.stringify(parseAllowlist('http://a.example/foo')) === JSON.stringify([{ kind: 'originPath', origin: 'http://a.example', path: '/foo' }]))
check('parse: ** allow-all', JSON.stringify(parseAllowlist('**')) === JSON.stringify([{ kind: 'all' }]))
check('parse: comments + blanks + trim', parseAllowlist('# hi\\n\\n  a.example  \\n*.ex.com\\nhttp://b.example/p\\n').map((p) => p.kind).join(',') === 'host,suffix,originPath')
check('parse: case normalized', parseAllowlist('A.EXAMPLE.COM')[0].host === 'a.example.com')
const expectErr = async (label, fn, code, part) => {
  try { await fn(); check(label, false, 'did not throw') }
  catch (e) { check(label, e instanceof StoreError && e.code === code && e.message.includes(part), (e && e.code) + ' :: ' + e.message) }
}
await expectErr('parse: bare * invalid', () => parseAllowlist('*'), 'allowlist_invalid', 'invalid pattern')
await expectErr('parse: empty suffix invalid', () => parseAllowlist('*.'), 'allowlist_invalid', 'invalid pattern')
await expectErr('parse: not a URL invalid', () => parseAllowlist('http://exa mple.com/x'), 'allowlist_invalid', 'not a URL')
await expectErr('parse: bad protocol invalid', () => parseAllowlist('ftp://example.com'), 'allowlist_invalid', 'only http/https')
await expectErr('parse: slash host invalid', () => parseAllowlist('a.example/x'), 'allowlist_invalid', 'invalid pattern')
await expectErr('parse: line number reported', () => parseAllowlist('ok.host\\nbad*'), 'allowlist_invalid', 'line 2')

// --- isAllowed matrix
check('isAllowed: host exact', isAllowed('http://a.example/x', parseAllowlist('a.example')) === true)
check('isAllowed: host port+case insensitive', isAllowed('https://A.example:8080/x', parseAllowlist('a.example')) === true)
check('isAllowed: host sub NOT covered', isAllowed('http://sub.a.example/x', parseAllowlist('a.example')) === false)
check('isAllowed: host suffix NOT covered', isAllowed('http://a.example.evil.com/x', parseAllowlist('a.example')) === false)
check('isAllowed: suffix subdomain', isAllowed('http://deep.sub.example.com/x', parseAllowlist('*.example.com')) === true)
check('isAllowed: suffix apex', isAllowed('http://example.com/x', parseAllowlist('*.example.com')) === true)
check('isAllowed: suffix NOT notexample', isAllowed('http://notexample.com/x', parseAllowlist('*.example.com')) === false)
check('isAllowed: suffix NOT example.evil', isAllowed('http://example.com.evil.com/x', parseAllowlist('*.example.com')) === false)
check('isAllowed: originPath exact', isAllowed('http://a.example/foo', parseAllowlist('http://a.example/foo')) === true)
check('isAllowed: originPath prefix /foo/bar', isAllowed('http://a.example/foo/bar', parseAllowlist('http://a.example/foo')) === true)
check('isAllowed: originPath prefix /foobar', isAllowed('http://a.example/foobar', parseAllowlist('http://a.example/foo')) === true)
check('isAllowed: originPath other path NO', isAllowed('http://a.example/bar', parseAllowlist('http://a.example/foo')) === false)
check('isAllowed: originPath other scheme NO', isAllowed('https://a.example/foo', parseAllowlist('http://a.example/foo')) === false)
check('isAllowed: originPath other port NO', isAllowed('http://a.example:8080/foo', parseAllowlist('http://a.example/foo')) === false)
check('isAllowed: empty patterns deny all', isAllowed('http://a.example/', []) === false)
check('isAllowed: ** admits any http(s)', isAllowed('http://z.example/x', parseAllowlist('**')) === true)
check('isAllowed: non-http denied', isAllowed('ftp://a.example/', parseAllowlist('a.example')) === false)
check('isAllowed: unparseable denied', isAllowed('not a url', parseAllowlist('*.*.example.com')) === false)

// --- loadAllowlist: missing file → seed template + [] (caller surfaces allowlist_empty)
check('load: missing file → [] (and seeds template)', loadAllowlist(root).length === 0, JSON.stringify(loadAllowlist(root)))
check('load: template seeded on disk', existsSync(allowPath) === true)
rmSync(allowPath)
// file is a directory → unreadable
mkdirSync(allowPath)
expectErr('load: file is a directory → unreadable', () => loadAllowlist(root), 'allowlist_unreadable', 'cannot read')
rmdirSync(allowPath)

// --- fake counting fetcher (echoes requested URL as final URL)
let calls = 0
const fake = { async fetch(url) { calls++; return mkPage(url) } }
const deny = (label, fn, url) => expectErr(label, fn, 'allowlist_denied', url + ' not in .dsh/allowlist.txt')
const empty = (label, fn) => expectErr(label, fn, 'allowlist_empty', 'no patterns')

// Gate tests require allowlist:on (default is now off — G2)
mkdirSync(dirname(configPath(root)), { recursive: true })
writeFileSync(configPath(root), JSON.stringify({ allowlist: 'on' }))

// V1: empty/missing patterns → allowlist_empty BEFORE spawn, zero budget charge
const m1 = startMission(root, { note: 'allow-1', budget: 5 })
await empty('V1: no patterns → allowlist_empty', () => runFetch(root, fake, { url: 'http://a.example/1' }))
check('V1: zero spawn on empty', calls === 0, 'calls=' + calls)
check('V1: zero budget charge on empty', (readManifest(root, m1.mission_id).budget.spent ?? 0) === 0)

// V2: exact host admission
writeFileSync(allowPath, 'a.example')
const r2 = await runFetch(root, fake, { url: 'http://a.example/1' })
check('V2: allowed host fetches + charges', r2.cached === false && r2.budget.spent === 1, JSON.stringify(r2.budget))
await deny('V2: other host denied', () => runFetch(root, fake, { url: 'http://b.example/1' }), 'http://b.example/1')
check('V2: denial still zero-cost', readManifest(root, m1.mission_id).budget.spent === 1)

// V3: suffix (all subdomains + apex)
writeFileSync(allowPath, '# comment\\n*.example.com')
check('V3: apex allowed', (await runFetch(root, fake, { url: 'http://example.com/1' })).cached === false)
check('V3: subdomain allowed', (await runFetch(root, fake, { url: 'http://s.example.com/1' })).cached === false)
await deny('V3: lookalike denied', () => runFetch(root, fake, { url: 'http://notexample.com/1' }), 'http://notexample.com/1')

// V4: origin+path prefix
writeFileSync(allowPath, 'http://a.example/allowed')
check('V4: /allowed allowed', (await runFetch(root, fake, { url: 'http://a.example/allowed/x' })).cached === false)
await deny('V4: /other denied', () => runFetch(root, fake, { url: 'http://a.example/other' }), 'http://a.example/other')

// V5: cache hits are NOT re-gated (D-M5.4) — empty patterns file, hit still served
writeFileSync(allowPath, '# deny all')
const r5 = await runFetch(root, fake, { url: 'http://a.example/allowed/x' })
check('V5: hit not re-gated under empty patterns', r5.cached === true, JSON.stringify({ c: r5.cached }))
check('V5: hit free (no charge)', readManifest(root, m1.mission_id).budget.spent === 4, 'spent=' + readManifest(root, m1.mission_id).budget.spent)
// force IS re-gated (force = spawn = gated) → allowlist_empty
await empty('V5: force re-gated → empty', () => runFetch(root, fake, { url: 'http://a.example/allowed/x', force: true }))
check('V5: force denial zero-cost', readManifest(root, m1.mission_id).budget.spent === 4)

// V6: denial is zero-cost — a denied attempt never eats the budget
writeFileSync(allowPath, 'other.example')
const m2 = startMission(root, { note: 'allow-2', budget: 1 })
await deny('V6: denied with budget 1', () => runFetch(root, fake, { url: 'http://z.example/1' }), 'http://z.example/1')
writeFileSync(allowPath, 'z.example')
const r6 = await runFetch(root, fake, { url: 'http://z.example/1' })
check('V6: denial left the call available', r6.budget.max === 1 && r6.budget.spent === 1 && r6.budget.remaining === 0, JSON.stringify(r6.budget))

// V7: config allowlist:'off' disables the gate (fresh mission — m2 is exhausted)
const m4 = startMission(root, { note: 'allow-4', budget: 3 })
writeFileSync(configPath(root), JSON.stringify({ allowlist: 'off' }))
const r7 = await runFetch(root, fake, { url: 'http://anything.example/1' })
check('V7: gate off → fetch proceeds', r7.cached === false && r7.budget.max === 3, JSON.stringify(r7.budget))
writeFileSync(configPath(root), JSON.stringify({ allowlist: 'on' }))

// V8: gate order — allowlist fires BEFORE the budget gate
const m3 = startMission(root, { note: 'allow-3', budget: 1 })
writeFileSync(allowPath, 'x.example')
await runFetch(root, fake, { url: 'http://x.example/1' }) // spend the only call
await expectErr('V8: exhausted + denied → allowlist_denied (order)', () => runFetch(root, fake, { url: 'http://y.example/1' }), 'allowlist_denied', 'y.example/1')

// V9: invalid pattern file surfaces through runFetch
writeFileSync(allowPath, 'a.example\\n*')
await expectErr('V9: invalid file → allowlist_invalid', () => runFetch(root, fake, { url: 'http://a.example/1' }), 'allowlist_invalid', 'line 2')

// V10: mission_status carries the budget view (denials never charge)
const st10 = missionStatus(root, m1.mission_id)
check('V10: status budget view intact (4 charged, 1 denied-uncharged)', st10.budget.max === 5 && st10.budget.spent === 4 && st10.budget.remaining === 1, JSON.stringify(st10.budget))

console.log(fail === 0 ? 'harness A: all checks passed' : 'harness A: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// --- Harness B: tool level (BUILT lib + real browser39 + local server) ---------
const harnessB = `
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require2 = createRequire(import.meta.url)
const lib = require2(${JSON.stringify(join(repoRoot, 'lib', 'index.js'))})

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const tools = []
const ctx = {
  tools: { register: (def) => { tools.push(def); return () => {} } },
  skills: { register: () => () => {} },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
}
lib.apply(ctx)
const byName = {}
for (const t of tools) byName[t.name] = t
if (!byName.mission_fetch) { console.error('FATAL: mission_fetch not registered'); process.exit(1) }

${serverCode}

const workdir = mkdtempSync(join('/tmp', 'smoke-allowlist-tool-'))
const exec = () => ({})
const allowPath = join(workdir, '.dsh', 'allowlist.txt')
const cfgPath = join(workdir, '.dsh', 'web-missions', 'config.json')

const started = await byName.mission_start.execute({ note: 'allowlist tool smoke', budget: 5, cwd: workdir }, exec())
check('tool: mission started', !!started.mission_id, JSON.stringify(started))
const mid = started.mission_id

// Gate on for dogfood-style tests (default is off)
mkdirSync(join(workdir, '.dsh', 'web-missions'), { recursive: true })
writeFileSync(cfgPath, JSON.stringify({ allowlist: 'on' }))

// V1: allowlist on + empty patterns → allowlist_empty, ZERO spawn
const v1 = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool V1: allowlist_empty envelope', v1.ok === false && typeof v1.error === 'string' && v1.error.startsWith('allowlist_empty:'), JSON.stringify(v1.error))
check('tool V1: zero spawn on empty', (hits['/target'] || 0) === 0, JSON.stringify(hits))
let st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool V1: budget untouched', st.budget.spent === 0 && st.budget.remaining === 5, JSON.stringify(st.budget))

// V2: origin+path pattern admits /target (charged), same-host /missing still denied
mkdirSync(join(workdir, '.dsh'), { recursive: true })
writeFileSync(allowPath, 'http://' + new URL(base).host + '/target')
const v2 = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool V2: allowed path fetches (full)', v2.cached === false && v2.page_quality === 'full', JSON.stringify({ c: v2.cached, q: v2.page_quality, e: v2.error }))
check('tool V2: charged + receipt budget 5/1/4', v2.budget && v2.budget.spent === 1 && v2.budget.remaining === 4, JSON.stringify(v2.budget))
check('tool V2: server served /target exactly once', (hits['/target'] || 0) === 1, JSON.stringify(hits))
const v2b = await byName.mission_fetch.execute({ url: base + '/missing', mission_id: mid, cwd: workdir }, exec())
check('tool V2: same-host other path denied', v2b.ok === false && v2b.error.startsWith('allowlist_denied:'), JSON.stringify(v2b.error))
check('tool V2: denial → zero spawn', (hits['/missing'] || 0) === 0, JSON.stringify(hits))
st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool V2: budget still 5/1/4', st.budget.spent === 1 && st.budget.remaining === 4, JSON.stringify(st.budget))

// V3: cache hit survives a rewritten deny-all file (not re-gated)
writeFileSync(allowPath, '# deny all')
const v3 = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool V3: hit under deny-all (not re-gated)', v3.cached === true, JSON.stringify({ c: v3.cached, e: v3.error }))
check('tool V3: hit free', (await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())).budget.spent === 1)

// V4: force under empty patterns → allowlist_empty, no spawn
const v4 = await byName.mission_fetch.execute({ url: base + '/target', force: true, mission_id: mid, cwd: workdir }, exec())
check('tool V4: force re-gated → empty', v4.ok === false && v4.error.startsWith('allowlist_empty:'), JSON.stringify(v4.error))
check('tool V4: no spawn on empty force', (hits['/target'] || 0) === 1, JSON.stringify(hits))

// V5: config allowlist:'off' disables the gate (blocked 404 receipt, charged)
writeFileSync(cfgPath, JSON.stringify({ allowlist: 'off' }))
const v5 = await byName.mission_fetch.execute({ url: base + '/missing', mission_id: mid, cwd: workdir }, exec())
check('tool V5: gate off → 404 blocked receipt (not denied)', v5.ok !== false && v5.page_quality === 'blocked', JSON.stringify({ q: v5.page_quality, e: v5.error }))
st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool V5: charged under gate off', st.budget.spent === 2 && st.budget.remaining === 3, JSON.stringify(st.budget))

console.log(fail === 0 ? 'harness B: all checks passed' : 'harness B: ' + fail + ' FAILURES')
server.close()
process.exit(fail === 0 ? 0 : 1)
`

// --- run both ------------------------------------------------------------------
// M5 5.4: hermetic host-scoped session dirs (never touch ~/.dsh/browser39/sessions).
process.env.BROWSER39_SESSIONS_DIR = mkdtempSync(join(tmpdir(), 'smoke-allowlist-sess-'))
let rc = 0

const dirA = mkdtempSync(join(tmpdir(), 'smoke-allowlist-a-'))
try {
  writeFileSync(join(dirA, 'a.ts'), harnessA)
  buildSync({ entryPoints: [join(dirA, 'a.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirA, 'a.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirA, 'a.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness A exit ' + out.status) }
} finally {
  rmSync(dirA, { recursive: true, force: true })
}

const dirB = mkdtempSync(join(tmpdir(), 'smoke-allowlist-b-'))
try {
  writeFileSync(join(dirB, 'b.ts'), harnessB)
  buildSync({ entryPoints: [join(dirB, 'b.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirB, 'b.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirB, 'b.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness B exit ' + out.status) }
} finally {
  rmSync(dirB, { recursive: true, force: true })
}

process.exit(rc)
