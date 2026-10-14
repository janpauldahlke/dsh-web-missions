// Budget smoke (M5 slice 5.1 — C6 budget unit = fetch calls, S5):
//   A) service level (tmpdir bundle, fake counting fetcher — zero real spawns):
//      per-receipt budget view { max, spent, remaining, unit: fetch_calls },
//      decrement per fresh fetch, exhausted → budget_exhausted BEFORE spawn
//      (V1: max 3 → remaining 2/1/0, 4th refused, zero extra spawn), cache hit
//      at remaining 0 is FREE (V2), force does NOT bypass exhaustion (V3), a
//      failed/timeout fetch still costs its call, cacheHitCountsAsBudget via
//      opts and via config.json, defaultFetchBudget via config.json (explicit
//      budget arg wins), corrupt config.json → config_corrupt, M1-era manifest
//      (no budget.spent) treated as spent 0, budget_charged audit on rows,
//      mission_status carries budget.remaining.
//   B) tool level (BUILT lib, real browser39 + local HTTP server):
//      mission_start default budget 10; budget-2 mission: fresh full + fresh
//      404 (blocked) both charged, 3rd fresh → budget_exhausted envelope,
//      cache hit at remaining 0 succeeds (free), config.json
//      defaultFetchBudget honored, corrupt config → config_corrupt envelope.
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

// --- shared local server (embedded in each harness string) --------------------
const serverCode = `
const pages = {
  '/target': {
    body: '<html><head><title>Target Page</title></head><body>' +
      '<h1>Target</h1><p>' + 'SENTINEL-BUDGET-TEXT ' + 'lorem ipsum dolor sit amet '.repeat(120) + '</p></body></html>',
  },
  '/missing': { status: 404, body: '<html><head><title>404 Not Found</title></head><body>Not Found Here</body></html>' },
}
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0]
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
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runFetch } from '${abs('../src/host/fetch-service.ts')}'
import { startMission, readManifest, missionStatus, StoreError, chargeBudget, budgetView, budgetExhausted } from '${abs('../src/host/store.ts')}'
import { readConfig, configPath, DEFAULT_CONFIG } from '${abs('../src/host/config.ts')}'
import { FetchError } from '${abs('../src/host/fetcher.ts')}'
import type { FetchedPage } from '${abs('../src/shared/types.ts')}'

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const mkPage = (url, over): FetchedPage => ({
  finalUrl: url,
  status: 200,
  title: 'T',
  content: 'budget content for ' + url + ' '.repeat(120),
  links: [],
  quality: 'full',
  qualitySignals: [],
  consentAttempted: false,
  consentImproved: false,
  byteLength: 400,
  fetchedAt: new Date().toISOString(),
  ...over,
})

const root = join(mkdtempSync(join('/tmp', 'smoke-budget-')), 'root')
// M5 5.2: permit the fake hosts — this suite tests budget mechanics; the
// deny-all default allowlist would gate every fake fetch below.
writeFileSync(join(root, '..', 'allowlist.txt'), '*.example')

// --- pure budget view helpers
const b3 = { max: 3 }
check('budgetView: no spent → spent 0', budgetView(b3).spent === 0 && budgetView(b3).remaining === 3 && budgetView(b3).unit === 'fetch_calls')
check('budgetExhausted: spent == max', budgetExhausted({ max: 3, spent: 3 }) === true && budgetExhausted({ max: 3, spent: 2 }) === false)

// --- fake counting fetcher (echoes requested URL as final URL)
let calls = 0
const fake = { async fetch(url) { calls++; return mkPage(url) } }
const expectError = async (label, fn, code, msgPart) => {
  try { await fn(); check(label, false, 'did not throw') }
  catch (e) {
    check(label, e instanceof StoreError && e.code === code && e.message.includes(msgPart), (e && e.code) + ' :: ' + e.message)
  }
}

// --- V1: max 3 → remaining 2/1/0, 4th refused (zero extra spawn)
const m1 = startMission(root, { note: 'budget-3', budget: 3 })
const r1 = await runFetch(root, fake, { url: 'http://a.example/1' })
check('V1: receipt 1 budget 3/1/2', r1.budget.max === 3 && r1.budget.spent === 1 && r1.budget.remaining === 2 && r1.budget.unit === 'fetch_calls', JSON.stringify(r1.budget))
check('V1: manifest persisted spent 1', readManifest(root, m1.mission_id).budget.spent === 1)
const r2 = await runFetch(root, fake, { url: 'http://a.example/2' })
check('V1: receipt 2 budget 3/2/1', r2.budget.spent === 2 && r2.budget.remaining === 1, JSON.stringify(r2.budget))
const r3 = await runFetch(root, fake, { url: 'http://a.example/3' })
check('V1: receipt 3 budget 3/3/0', r3.budget.spent === 3 && r3.budget.remaining === 0, JSON.stringify(r3.budget))
await expectError('V1: 4th → budget_exhausted', () => runFetch(root, fake, { url: 'http://a.example/4' }), 'budget_exhausted', '3 fetch calls used')
check('V1: zero spawn on exhaustion', calls === 3, 'calls=' + calls)
check('V1: manifest still spent 3', readManifest(root, m1.mission_id).budget.spent === 3)

// --- V2: cache hit at remaining 0 is FREE
const h1 = await runFetch(root, fake, { url: 'http://a.example/1' })
check('V2: hit at remaining 0 succeeds', h1.cached === true && h1.budget.spent === 3 && h1.budget.remaining === 0, JSON.stringify({ c: h1.cached, b: h1.budget }))
check('V2: hit spawned nothing', calls === 3, 'calls=' + calls)

// --- V3: force does NOT bypass exhaustion (no override in v0)
await expectError('V3: force on exhausted → budget_exhausted', () => runFetch(root, fake, { url: 'http://a.example/1', force: true }), 'budget_exhausted', '3 fetch calls used')
check('V3: force spawned nothing', calls === 3, 'calls=' + calls)

// --- audit: every row written by a charged attempt carries budget_charged
const rows1 = readManifest(root, m1.mission_id).fetched
check('audit: all 3 rows budget_charged true', rows1.length === 3 && rows1.every((r) => r.budget_charged === true), JSON.stringify(rows1.map((r) => [r.normalized_url, r.budget_charged])))

// --- mission_status carries budget with remaining
const st1 = missionStatus(root, m1.mission_id)
check('status: budget 3/3/0 + unit', st1.budget.max === 3 && st1.budget.spent === 3 && st1.budget.remaining === 0 && st1.budget.unit === 'fetch_calls', JSON.stringify(st1.budget))

// --- a FAILED fetch still costs its call (it was a browser spawn)
let boomCalls = 0
const boom = { async fetch() { boomCalls++; throw new FetchError('fetch_failed', 'boom') } }
const m2 = startMission(root, { note: 'fail-costs', budget: 1 })
let threw = null
try { await runFetch(root, boom, { url: 'http://b.example/1' }) } catch (e) { threw = e }
check('fail: FetchError propagates', threw instanceof FetchError && threw.code === 'fetch_failed', String(threw))
check('fail: manifest charged despite failure', readManifest(root, m2.mission_id).budget.spent === 1, 'spent=' + readManifest(root, m2.mission_id).budget.spent)
check('fail: no ledger row on failure', readManifest(root, m2.mission_id).fetched.length === 0)
await expectError('fail: next fetch → budget_exhausted', () => runFetch(root, fake, { url: 'http://b.example/2' }), 'budget_exhausted', '1 fetch calls used')

// --- cacheHitCountsAsBudget via opts (default false = free)
const m3 = startMission(root, { note: 'hits-cost', budget: 1 })
const fresh1 = await runFetch(root, fake, { url: 'http://c.example/1' })
check('knob: fresh 1/1/0', fresh1.budget.spent === 1 && fresh1.budget.remaining === 0)
const freeHit = await runFetch(root, fake, { url: 'http://c.example/1' })
check('knob: default hit is free at remaining 0', freeHit.cached === true && freeHit.budget.spent === 1 && freeHit.budget.remaining === 0, JSON.stringify(freeHit.budget))
await expectError('knob: opts hit-cost at remaining 0 → budget_exhausted', () => runFetch(root, fake, { url: 'http://c.example/1' }, { cacheHitCountsAsBudget: true }), 'budget_exhausted', '1 fetch calls used')

// --- config.json: cacheHitCountsAsBudget knob (no opts override)
writeFileSync(configPath(root), JSON.stringify({ cacheHitCountsAsBudget: true }))
const m4 = startMission(root, { note: 'cfg-hitcost', budget: 1 })
await runFetch(root, fake, { url: 'http://d.example/1' })
await expectError('config: hit-cost via config.json → budget_exhausted', () => runFetch(root, fake, { url: 'http://d.example/1' }), 'budget_exhausted', '1 fetch calls used')

// --- config.json: defaultFetchBudget (explicit budget arg wins)
writeFileSync(configPath(root), JSON.stringify({ cacheHitCountsAsBudget: false, defaultFetchBudget: 4 }))
const m5 = startMission(root, { note: 'cfg-default' })
check('config: defaultFetchBudget 4', m5.budget.max === 4, 'max=' + m5.budget.max)
const m5b = startMission(root, { note: 'cfg-arg-wins', budget: 7 })
check('config: explicit budget arg wins (7)', m5b.budget.max === 7, 'max=' + m5b.budget.max)

// --- default (no config) = 10
rmSync(configPath(root))
const m6 = startMission(root, { note: 'default' })
check('default: no config → 10', m6.budget.max === 10 && readConfig(root).defaultFetchBudget === DEFAULT_CONFIG.defaultFetchBudget, 'max=' + m6.budget.max)

// --- corrupt config.json → config_corrupt (fail loud)
writeFileSync(configPath(root), '{oops')
await expectError('config: corrupt → config_corrupt on runFetch', () => runFetch(root, fake, { url: 'http://e.example/1' }), 'config_corrupt', 'not valid JSON')
await expectError('config: corrupt → config_corrupt on startMission', () => startMission(root, { note: 'nope' }), 'config_corrupt', 'not valid JSON')
rmSync(configPath(root))

// --- M1-era manifest (budget without spent) treated as spent 0
const m7 = startMission(root, { note: 'legacy', budget: 2 })
const m7path = join(root, m7.mission_id, 'manifest.json')
const m7j = JSON.parse(readFileSync(m7path, 'utf8'))
delete m7j.budget.spent
writeFileSync(m7path, JSON.stringify(m7j, null, 2))
const r7 = await runFetch(root, fake, { url: 'http://f.example/1' })
check('legacy: no spent → first fetch ok, 2/1/1', r7.budget.max === 2 && r7.budget.spent === 1 && r7.budget.remaining === 1, JSON.stringify(r7.budget))

// --- chargeBudget direct (unit + persistence)
const before = readManifest(root, m7.mission_id).budget.spent
const afterM = chargeBudget(root, m7.mission_id)
check('chargeBudget: +1 persisted', afterM.budget.spent === before + 1 && readManifest(root, m7.mission_id).budget.spent === before + 1)
await expectError('chargeBudget: unknown mission', () => chargeBudget(root, 'm-deadbeef'), 'unknown_mission', 'no such mission')

console.log(fail === 0 ? 'harness A: all checks passed' : 'harness A: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// --- Harness B: tool level (applies the BUILT lib) -----------------------------
const harnessB = `
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require2 = createRequire(import.meta.url)
const lib = require2(${JSON.stringify(join(repoRoot, 'lib', 'index.js'))})

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const tools = []
const skills = []
const ctx = {
  tools: { register: (def) => { tools.push(def); return () => {} } },
  skills: { register: (def) => { skills.push(def); return () => {} } },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
}
lib.apply(ctx)
const byName = {}
for (const t of tools) byName[t.name] = t
check('tools: 8 registered', Object.keys(byName).length === 8, JSON.stringify(Object.keys(byName)))

${serverCode}

const workdir = mkdtempSync(join('/tmp', 'smoke-budget-tool-'))
const exec = () => ({})

// --- default budget = 10
const started = await byName.mission_start.execute({ note: 'budget tool', cwd: workdir }, exec())
check('tool: start default budget 10', started.budget.max === 10, JSON.stringify(started.budget))
// M5 5.2: permit the local fixture server (deny-all default allowlist).
mkdirSync(join(workdir, '.dsh'), { recursive: true })
writeFileSync(join(workdir, '.dsh', 'allowlist.txt'), '127.0.0.1')

// --- budget-2 mission: two charged fresh fetches, 3rd refused
const m2 = await byName.mission_start.execute({ note: 'budget 2', budget: 2, cwd: workdir }, exec())
const mid = m2.mission_id
check('tool: start budget 2', m2.budget.max === 2, JSON.stringify(m2.budget))

const full = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool: fresh full charged 2/1/1', full.cached === false && full.page_quality === 'full' && full.budget.max === 2 && full.budget.spent === 1 && full.budget.remaining === 1 && full.budget.unit === 'fetch_calls', JSON.stringify(full.budget))

const b404 = await byName.mission_fetch.execute({ url: base + '/missing', mission_id: mid, cwd: workdir }, exec())
check('tool: fresh 404 (blocked) still charged 2/2/0', b404.page_quality === 'blocked' && b404.budget.spent === 2 && b404.budget.remaining === 0, JSON.stringify(b404.budget))

const dead = await byName.mission_fetch.execute({ url: base + '/other', mission_id: mid, cwd: workdir }, exec())
check('tool: 3rd fresh → budget_exhausted envelope', dead.ok === false && dead.error.startsWith('budget_exhausted:') && dead.error.includes('2 fetch calls used'), JSON.stringify(dead))

const hit = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool: hit at remaining 0 is free', hit.cached === true && hit.budget.spent === 2 && hit.budget.remaining === 0, JSON.stringify({ c: hit.cached, b: hit.budget }))

const st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool: status budget 2/2/0 + unit', st.budget.max === 2 && st.budget.spent === 2 && st.budget.remaining === 0 && st.budget.unit === 'fetch_calls', JSON.stringify(st.budget))
check('tool: status rows budget_charged true', st.visited.length === 2 && st.visited.every((r) => r.budget_charged === true), JSON.stringify(st.visited.map((r) => [r.quality, r.budget_charged])))

// --- config.json defaultFetchBudget honored
const cfg = join(workdir, '.dsh', 'web-missions', 'config.json')
writeFileSync(cfg, JSON.stringify({ defaultFetchBudget: 5 }))
const m5 = await byName.mission_start.execute({ note: 'cfg 5', cwd: workdir }, exec())
check('tool: config defaultFetchBudget 5', m5.budget.max === 5, 'max=' + m5.budget.max)

// --- corrupt config → config_corrupt envelope
writeFileSync(cfg, '{bad')
const bad = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool: corrupt config → config_corrupt', bad.ok === false && bad.error.startsWith('config_corrupt:'), JSON.stringify(bad))
writeFileSync(cfg, '{}')
const okAgain = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool: valid {} config → hit works again', okAgain.cached === true && okAgain.budget.remaining === 0, JSON.stringify(okAgain))

console.log(fail === 0 ? 'harness B: all checks passed' : 'harness B: ' + fail + ' FAILURES')
server.close()
process.exit(fail === 0 ? 0 : 1)
`

// --- run both ------------------------------------------------------------------
let rc = 0

const dirA = mkdtempSync(join(tmpdir(), 'smoke-budget-a-'))
try {
  writeFileSync(join(dirA, 'a.ts'), harnessA)
  buildSync({ entryPoints: [join(dirA, 'a.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirA, 'a.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirA, 'a.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness A exit ' + out.status) }
} finally {
  rmSync(dirA, { recursive: true, force: true })
}

const dirB = join(repoRoot, '.smoke-budget')
try {
  rmSync(dirB, { recursive: true, force: true })
  mkdirSync(dirB, { recursive: true })
  writeFileSync(join(dirB, 'b.ts'), harnessB)
  buildSync({ entryPoints: [join(dirB, 'b.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirB, 'b.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirB, 'b.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness B exit ' + out.status) }
} finally {
  rmSync(dirB, { recursive: true, force: true })
}

process.exit(rc)
