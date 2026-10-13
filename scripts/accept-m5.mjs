// M5 acceptance (slice 5.7): V1–V10 per plan/M_5_ledger.md, run with tools
// applied in-process from the BUILT lib (repo cwd — the same store root the
// live :3090 routes serve) + a live :3090 cross-check. Real browser39 spawns
// go through a COUNTING BROWSER39_BIN wrapper so batch-invocation counts are
// exact; BROWSER39_SESSIONS_DIR is hermetic (V6 session persistence lives in
// the temp dir, never in ~/.dsh/browser39/sessions).
//
// Layout:
//   V1  budget max 3: three fresh fetches (remaining 2/1/0), 4th →
//       budget_exhausted, no spawn, no row
//   V2  cache hit with remaining 0 → cached:true (hits free)
//   V3  allowlist admits the fixture host (real spawn) while
//       www.example.com → allowlist_denied, no spawn, no charge
//       (the file carries the dogfood entry www.sparda-berlin.de per the V
//       table; the admit path is host-agnostic, proven on the local fixture)
//   V4  allowlist file emptied (+ allowlist: on default) → every spawn due is
//       denied (deny-all), zero spawn, zero charge
//   V5  local CMP page (thin + 'cookie' marker + "Accept all" link) →
//       consent_attempted: true, consent_improved: true, quality full;
//       batch invocations = initial + 1 consent batch (≤ consentMaxAttempts);
//       budget charged exactly once
//   V6  NEW mission → fetch the same host: the session cookie persisted by
//       the consent batch → the server serves the full page, no CMP marker,
//       no consent re-trigger
//   V7  404 → blocked receipt, hint carries the do-not-claim text
//   V8  maxBytes 50000 on a ~405 KB page → quality_signals: ["truncated"],
//       stored content ≤ 50000 bytes
//   V9  maxDepth 1: seed (depth 0) ok, sublink (depth 1) ok, sub-sublink →
//       depth_exceeded, no spawn, no budget charge
//   V10 maxDiscoveredHosts 2: seed host + hosts 1–2 ok, 3rd non-seed host →
//       host_breadth_exceeded, no spawn, no budget charge
// Live:  :3090 /health 200 + all five acceptance missions visible via the
//        live routes. Exit 0 iff every check passes. Never touches :3080/:8080.
//
// Hosts: one dual-stack fixture server; V10 uses four distinct hostnames
// (127.0.0.1 / localhost / 127.0.0.2 / 127.0.0.3 — all loopback, distinct
// host keys, ports stripped) so host breadth is exercised locally.
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')
const require = createRequire(import.meta.url)

// --- platform browser39 binary (the real one, wrapped for counting) ----------
let platformBin = null
for (const name of [
  '@aquintanar/browser39-linux-x64',
  '@aquintanar/browser39-linux-arm64',
  '@aquintanar/browser39-darwin-x64',
  '@aquintanar/browser39-darwin-arm64',
  '@aquintanar/browser39-win32-x64',
]) {
  try {
    const pkgJson = require.resolve(`${name}/package.json`)
    const candidate = join(dirname(pkgJson), 'bin', 'browser39')
    if (require('node:fs').existsSync(candidate)) { platformBin = candidate; break }
  } catch { /* not installed */ }
}
if (!platformBin) {
  console.error('FATAL: platform browser39 binary not found in node_modules')
  process.exit(1)
}

const work = mkdtempSync(join(tmpdir(), 'accept-m5-'))
const callLog = join(work, 'b39-calls.log')
writeFileSync(callLog, '')
const wrapper = join(work, 'b39-count.sh')
writeFileSync(wrapper, `#!/bin/sh\necho "call" >> ${JSON.stringify(callLog)}\nexec ${JSON.stringify(platformBin)} "$@"\n`)
chmodSync(wrapper, 0o755)
const callCount = () => readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length
process.env.BROWSER39_BIN = wrapper
process.env.BROWSER39_SESSIONS_DIR = join(work, 'b39-sessions')

// --- fixture server (dual-stack: 127.0.0.1 / localhost / 127.0.0.2 / 127.0.0.3)
const FILLER = 'lorem ipsum dolor sit amet '.repeat(120) // → ~3240 chars
const FULL_PAGE = (title, body) =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`

// V5: cookie-aware CMP page — thin + 'cookie' marker while the consent cookie
// is absent; full and marker-free once the cookie is set (a real CMP only
// renders when unconsented).
const cmpThin = () =>
  '<html><head><title>Cookie-Hinweis – Beispiel</title></head><body>' +
  '<p>Bitte Cookies erlauben, um fortzufahren.</p>' +
  '<a href="/v5-accept">Accept all</a></body></html>'
const fullNoMarker = FULL_PAGE('Beispiel – Artikel', 'SENTINEL-M5-CONSSENT ' + FILLER)

// V8: ~405 KB ASCII page (bytes = chars).
const bigPage = FULL_PAGE('Beispiel – Großseite', 'lorem ipsum dolor sit amet '.repeat(15000))

const pages = {
  '/v1a': { status: 200, body: FULL_PAGE('V1 A', 'SENTINEL-M5-V1A ' + FILLER) },
  '/v1b': { status: 200, body: FULL_PAGE('V1 B', 'SENTINEL-M5-V1B ' + FILLER) },
  '/v1c': { status: 200, body: FULL_PAGE('V1 C', 'SENTINEL-M5-V1C ' + FILLER) },
  '/v1d': { status: 200, body: FULL_PAGE('V1 D', 'SENTINEL-M5-V1D ' + FILLER) },
  '/v3': { status: 200, body: FULL_PAGE('V3', 'SENTINEL-M5-V3 ' + FILLER) },
  '/v5': { status: 200, body: null, dynamic: (cookie) => (cookie ? fullNoMarker : cmpThin()) },
  '/v5-accept': {
    status: 200,
    body: FULL_PAGE('Beispiel – Artikel', 'SENTINEL-M5-ACCEPT ' + FILLER),
    setCookie: 'consent=accepted; Path=/',
  },
  '/v7': { status: 404, body: '<html><head><title>404</title></head><body>Nothing Here</body></html>' },
  '/v8': { status: 200, body: bigPage },
  '/v9-seed': {
    status: 200,
    body: FULL_PAGE('V9 Seed', 'SENTINEL-M5-V9SEED ' + FILLER) +
      '<a href="/v9-sub">to sub</a>',
  },
  '/v9-sub': {
    status: 200,
    body: FULL_PAGE('V9 Sub', 'SENTINEL-M5-V9SUB ' + FILLER) +
      '<a href="/v9-subsub">to subsub</a>',
  },
  '/v9-subsub': { status: 200, body: FULL_PAGE('V9 SubSub', 'SENTINEL-M5-V9SUBSUB ' + FILLER) },
  '/v10': { status: 200, body: FULL_PAGE('V10', 'SENTINEL-M5-V10 ' + FILLER) },
}

const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  const spec = pages[path]
  const cookie = String(req.headers.cookie ?? '')
  if (!spec || spec.status === 404) { res.writeHead(404); res.end('nope'); return }
  const body = spec.dynamic ? spec.dynamic(cookie.includes('consent=accepted')) : spec.body
  const headers = { 'Content-Type': 'text/html; charset=utf-8' }
  if (spec.setCookie) headers['Set-Cookie'] = spec.setCookie
  res.writeHead(spec.status, headers)
  res.end(body)
})
await new Promise((r) => server.listen(0, r)) // dual-stack: serves every 127.x + localhost + ::1
const port = server.address().port
const base = 'http://127.0.0.1:' + port

// --- built lib, tools in-process, repo cwd (shared store root w/ live :3090) --
const lib = require(join(repoRoot, 'lib', 'index.js'))
const tools = []
lib.apply({
  tools: { register: (def) => { tools.push(def); return () => {} } },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
})
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
if (!byName.mission_fetch || !byName.mission_start) {
  console.error('FATAL: mission tools not registered in built lib')
  process.exit(1)
}
const exec = () => ({})
const J = (v) => JSON.stringify(v)

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label); else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

// --- allowlist (V3 needs the dogfood entry; V4 empties it; restored after) ---
const allowlistPath = join(repoRoot, '.dsh', 'allowlist.txt')
const allowlistBackup = existsSync(allowlistPath) ? readFileSync(allowlistPath, 'utf8') : null
// NOTE: www.example.com is deliberately ABSENT — it is V3's denial target.
const ALLOWLIST = ['127.0.0.1', 'localhost', '127.0.0.2', '127.0.0.3', 'www.sparda-berlin.de']
mkdirSync(join(repoRoot, '.dsh'), { recursive: true })
writeFileSync(allowlistPath, ALLOWLIST.join('\n') + '\n')

// config.json (mission root) — read per tool call, so it can be re-pointed
// between V-phases. Removed at the end (defaults restored).
const configPath = join(repoRoot, '.dsh', 'web-missions', 'config.json')
const writeConfig = (obj) => { mkdirSync(dirname(configPath), { recursive: true }); writeFileSync(configPath, JSON.stringify(obj, null, 2)) }
const clearConfig = () => { if (existsSync(configPath)) rmSync(configPath) }

const startMission = (args) => byName.mission_start.execute({ note: args.note, budget: args.budget, seeds: args.seeds, cwd: repoRoot }, exec())
const fetchTool = (mid, args) => byName.mission_fetch.execute({ mission_id: mid, url: args.url, force: args.force, cwd: repoRoot }, exec())
const status = async (mid) => byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())

// --- V1: budget (max 3) --------------------------------------------------------
const m1 = await startMission({ note: 'M5 acceptance — V1/V2 budget', budget: 3 })
check('V1 setup: mission started with budget 3', !!m1.mission_id && m1.budget?.max === 3, J(m1))
const mid1 = m1.mission_id

const f1 = await fetchTool(mid1, { url: base + '/v1a' })
check('V1: fetch 1 fresh, remaining 2', f1.ok !== false && f1.cached === false && f1.budget?.remaining === 2 && f1.budget?.spent === 1, J({ c: f1.cached, b: f1.budget, e: f1.error }))
check('V1: one spawn after fetch 1', callCount() === 1, 'calls=' + callCount())
const f2 = await fetchTool(mid1, { url: base + '/v1b' })
check('V1: fetch 2 remaining 1', f2.budget?.remaining === 1 && f2.budget?.spent === 2, J({ b: f2.budget }))
const f3 = await fetchTool(mid1, { url: base + '/v1c' })
check('V1: fetch 3 remaining 0', f3.budget?.remaining === 0 && f3.budget?.spent === 3, J({ b: f3.budget }))
check('V1: three spawns', callCount() === 3, 'calls=' + callCount())
const f4 = await fetchTool(mid1, { url: base + '/v1d' })
check('V1: 4th fetch → budget_exhausted', f4.ok === false && String(f4.error).includes('budget_exhausted'), J({ ok: f4.ok, e: f4.error }))
check('V1: 4th fetch no spawn', callCount() === 3, 'calls=' + callCount())
const st1 = await status(mid1)
check('V1: no charge on refusal (spent 3), 3 rows', st1.budget?.spent === 3 && st1.visited.length === 3, J({ spent: st1.budget?.spent, rows: st1.visited.length }))

// --- V2: cache hit with remaining 0 -------------------------------------------
const f5 = await fetchTool(mid1, { url: base + '/v1a' })
check('V2: hit at remaining 0 → cached:true', f5.ok !== false && f5.cached === true && f5.budget?.remaining === 0, J({ c: f5.cached, b: f5.budget, e: f5.error }))
check('V2: hit costs no spawn', callCount() === 3, 'calls=' + callCount())

// --- V3: allowlist gate --------------------------------------------------------
// fresh mission: m1 is budget-exhausted, and the ADMIT path must show a real
// spawn (the gate order allowlist-before-budget is proven separately in
// smoke-allowlist).
const m2v3 = await startMission({ note: 'M5 acceptance — V3 allowlist', budget: 5 })
const mid2v3 = m2v3.mission_id
const v3admit = await fetchTool(mid2v3, { url: base + '/v3' })
check('V3: allowlisted host fetches ok (real spawn)', v3admit.ok !== false && v3admit.cached === false && v3admit.page_quality === 'full', J({ ok: v3admit.ok, q: v3admit.page_quality, e: v3admit.error }))
const callsBeforeDeny = callCount()
const v3denied = await fetchTool(mid2v3, { url: 'https://www.example.com/' })
check('V3: unlisted host → allowlist_denied', v3denied.ok === false && String(v3denied.error).includes('allowlist_denied'), J({ ok: v3denied.ok, e: v3denied.error }))
check('V3: denial no spawn, no charge', callCount() === callsBeforeDeny && (await status(mid2v3)).budget?.spent === 1, 'calls=' + callCount())

// --- V4: empty allowlist → deny-all -------------------------------------------
writeFileSync(allowlistPath, '# emptied for V4 (deny-all)\n')
const m4v = await startMission({ note: 'M5 acceptance — V4 deny-all', budget: 5 })
const mid4v = m4v.mission_id
const d1 = await fetchTool(mid4v, { url: base + '/v1a' })
check('V4: fixture host denied (deny-all)', d1.ok === false && String(d1.error).includes('allowlist_denied'), J({ ok: d1.ok, e: d1.error }))
const d2 = await fetchTool(mid4v, { url: 'https://www.sparda-berlin.de/' })
check('V4: dogfood host denied too (file empty)', d2.ok === false && String(d2.error).includes('allowlist_denied'), J({ ok: d2.ok, e: d2.error }))
check('V4: zero spawn, zero charge', callCount() === callsBeforeDeny && (await status(mid4v)).budget?.spent === 0, 'calls=' + callCount() + ' spent=' + (await status(mid4v)).budget?.spent)
writeFileSync(allowlistPath, ALLOWLIST.join('\n') + '\n') // restore for V5+

// --- V5: consent (thin + CMP marker → accept link) -----------------------------
const m5v = await startMission({ note: 'M5 acceptance — V5 consent', budget: 5 })
const mid5v = m5v.mission_id
const callsBeforeConsent = callCount()
const c1 = await fetchTool(mid5v, { url: base + '/v5' })
check('V5: consent attempted + improved', c1.consent_attempted === true && c1.consent_improved === true, J({ a: c1.consent_attempted, i: c1.consent_improved, e: c1.error }))
check('V5: improved page is full', c1.page_quality === 'full', J({ q: c1.page_quality, s: c1.quality_signals }))
check('V5: exactly initial + 1 consent batch (≤ maxAttempts)', callCount() === callsBeforeConsent + 2, 'calls delta=' + (callCount() - callsBeforeConsent))
check('V5: budget charged exactly once', c1.budget?.spent === 1 && c1.budget?.remaining === 4, J(c1.budget))
check('V5: improved hint carries no do-not-claim for the full page', c1.next_step_hint.includes('accept worked'), c1.next_step_hint)

// --- V6: session persistence across missions ----------------------------------
const m6v = await startMission({ note: 'M5 acceptance — V6 sessions', budget: 3 })
const mid6v = m6v.mission_id
const s1 = await fetchTool(mid6v, { url: base + '/v5' })
check('V6: second mission sees the consented page (full)', s1.page_quality === 'full', J({ q: s1.page_quality, s: s1.quality_signals, e: s1.error }))
check('V6: no CMP markers on the persisted fetch', !(s1.quality_signals ?? []).some((s) => String(s).startsWith('cmp-marker:')), J(s1.quality_signals))
check('V6: no consent re-trigger', s1.consent_attempted === false, J({ a: s1.consent_attempted }))

// --- V7: honesty gate (404) -----------------------------------------------------
const v7 = await fetchTool(mid6v, { url: base + '/v7' })
check('V7: 404 → blocked receipt', v7.page_quality === 'blocked', J({ q: v7.page_quality, s: v7.quality_signals, e: v7.error }))
check('V7: hint carries do-not-claim', v7.next_step_hint.includes('do not claim content from this page'), v7.next_step_hint)

// --- V8: maxBytes truncation ----------------------------------------------------
writeConfig({ maxBytes: 50000 })
const v8 = await fetchTool(mid6v, { url: base + '/v8' })
check('V8: truncated signal', v8.ok !== false && (v8.quality_signals ?? []).includes('truncated'), J({ s: v8.quality_signals, e: v8.error }))
check('V8: page still full after cap', v8.page_quality === 'full', J({ q: v8.page_quality }))
// stored artifact content ≤ 50000 bytes
const m8 = await status(mid6v)
const row8 = m8.visited.find((r) => r.url === base + '/v8')
let storedBytes = -1
if (row8) {
  const pagePath = join(repoRoot, '.dsh', 'web-missions', mid6v, 'pages', row8.artifact_id, 'page.json')
  const stored = JSON.parse(readFileSync(pagePath, 'utf8'))
  storedBytes = Buffer.byteLength(stored.content ?? '', 'utf8')
}
check('V8: stored content ≤ 50000 bytes (and actually large)', storedBytes > 40000 && storedBytes <= 50000, 'storedBytes=' + storedBytes)

// --- V9: depth fence (maxDepth 1) ------------------------------------------------
writeConfig({ maxBytes: 50000, maxDepth: 1 })
const m9v = await startMission({ note: 'M5 acceptance — V9 depth fence', budget: 4, seeds: [base + '/v9-seed'] })
const mid9v = m9v.mission_id
const d0 = await fetchTool(mid9v, { url: base + '/v9-seed' })
check('V9: seed fetch depth 0 ok', d0.ok !== false && d0.depth === 0, J({ d: d0.depth, e: d0.error }))
const d1v = await fetchTool(mid9v, { url: base + '/v9-sub' })
check('V9: sublink fetch depth 1 ok (within maxDepth 1)', d1v.ok !== false && d1v.depth === 1, J({ d: d1v.depth, e: d1v.error }))
const callsBeforeFence = callCount()
const d2v = await fetchTool(mid9v, { url: base + '/v9-subsub' })
check('V9: sub-sublink → depth_exceeded', d2v.ok === false && String(d2v.error).includes('depth_exceeded'), J({ ok: d2v.ok, e: d2v.error }))
const st9 = await status(mid9v)
check('V9: refusal no spawn, no charge (spent 2)', callCount() === callsBeforeFence && st9.budget?.spent === 2, 'calls=' + callCount() + ' spent=' + st9.budget?.spent)

// --- V10: host breadth (maxDiscoveredHosts 2) -----------------------------------
writeConfig({ maxBytes: 50000, maxDepth: 1, maxDiscoveredHosts: 2 })
const m10v = await startMission({ note: 'M5 acceptance — V10 host breadth', budget: 5, seeds: [base + '/v10'] })
const mid10v = m10v.mission_id
const h0 = await fetchTool(mid10v, { url: base + '/v10' })
check('V10: seed host fetch ok', h0.ok !== false, J({ e: h0.error }))
const h1 = await fetchTool(mid10v, { url: 'http://localhost:' + port + '/v10' })
check('V10: 1st non-seed host ok', h1.ok !== false, J({ e: h1.error }))
const h2 = await fetchTool(mid10v, { url: 'http://127.0.0.2:' + port + '/v10' })
check('V10: 2nd non-seed host ok', h2.ok !== false, J({ e: h2.error }))
const callsBeforeBreadth = callCount()
const h3 = await fetchTool(mid10v, { url: 'http://127.0.0.3:' + port + '/v10' })
check('V10: 3rd non-seed host → host_breadth_exceeded', h3.ok === false && String(h3.error).includes('host_breadth_exceeded'), J({ ok: h3.ok, e: h3.error }))
const st10 = await status(mid10v)
check('V10: refusal no spawn, no charge (spent 3)', callCount() === callsBeforeBreadth && st10.budget?.spent === 3, 'calls=' + callCount() + ' spent=' + st10.budget?.spent)

// --- cleanup: restore allowlist + drop the phase config -------------------------
writeFileSync(allowlistPath, allowlistBackup ?? '127.0.0.1\n')
clearConfig()

// --- live :3090 cross-check ------------------------------------------------------
const liveBase = 'http://127.0.0.1:3090'
const health = await (await fetch(liveBase + '/api/web-missions/health')).json()
check('live: :3090 health ok', health.ok === true && health.name === 'dsh-local-web-missions', J(health))
const list = await (await fetch(liveBase + '/api/web-missions/missions')).json()
const active = list.active || []
const seen = (id) => active.find((m) => m.mission_id === id)
for (const [label, mid] of [
  ['V1/V2 mission', mid1], ['V3 mission', mid2v3], ['V4 mission', mid4v],
  ['V5/V6/V7/V8 mission', mid6v], ['V9 mission', mid9v], ['V10 mission', mid10v],
]) {
  const row = seen(mid)
  check('live: ' + label + ' visible via live routes', !!row && row.status === 'active', J(row ?? { active: active.map((m) => m.mission_id) }))
}
if (seen(mid6v)) {
  const byId = await (await fetch(liveBase + '/api/web-missions/missions/' + mid6v)).json()
  check('live: by-id route serves the consent/404/truncation ledger', Array.isArray(byId.visited) && byId.visited.length === 3, 'visited=' + (byId.visited || []).length)
}

console.log(fail === 0 ? 'M5 ACCEPTANCE: all checks passed' : 'M5 ACCEPTANCE: ' + fail + ' FAILURES')
server.close()
rmSync(work, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
