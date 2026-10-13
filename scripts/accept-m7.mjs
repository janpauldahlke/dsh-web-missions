// M7 acceptance — discovery companion behind a port (plan/M_7_discovery.md V1–V5).
//
//   V1  no SearXNG running, browser39-search disabled → `no_engine` supported
//       state (never a crash); mission core untouched (full regression runs
//       separately in the shell — the core imports no companion code).
//   V2  SearXNG up (local test instance on the DEFAULT endpoint :8888, real
//       API shape) → query → ≥1 URL; admitted URL fetched through the core
//       → full receipt + real spawn; unlisted URL → `allowlist_denied`
//       (no spawn). Discovered URLs are not ledger rows until fetched (D-M7.4).
//   V3  `browser39 search` live (2.0.0, DDG egress) → JSON shaped to the same
//       DiscoveryPort type (absolute http(s) urls, anchor-text titles).
//   V4  engines down mid-mission (stub killed, bin absent) → `no_engine` on
//       the next query; prior mission data (manifest/budget/ledger/
//       discovery.json) intact, mission_status still serves discovery.
//   V5  encapsulation — verified in the shell: git diff of the core shows no
//       engine code / no engine config beyond the optional discovery surface.
//
// Uses the BUILT core lib (tools in-process, repo cwd = shared store root w/
// live :3090) + the REAL companion lib (~/dev/dsh-web-discovery/lib/
// discovery.mjs). The browser39 binary is wrapped for spawn counting (M5
// pattern); the allowlist file is written then restored.
import http from 'node:http'
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  chmodSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs'
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

const work = mkdtempSync(join(tmpdir(), 'accept-m7-'))
const callLog = join(work, 'b39-calls.log')
writeFileSync(callLog, '')
const wrapper = join(work, 'b39-count.sh')
writeFileSync(wrapper, `#!/bin/sh\necho "call" >> ${JSON.stringify(callLog)}\nexec ${JSON.stringify(platformBin)} "$@"\n`)
chmodSync(wrapper, 0o755)
const callCount = () => readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length
process.env.BROWSER39_BIN = wrapper
process.env.BROWSER39_SESSIONS_DIR = join(work, 'b39-sessions')
delete process.env.SEARXNG_ENDPOINT // V2 must hit the DEFAULT endpoint (:8888)

let pass = 0
let fail = 0
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + label) }
  else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) }
}
const J = (v) => JSON.stringify(v)

// --- real companion lib --------------------------------------------------------
const C = await import('/home/hagbard/dev/dsh-web-discovery/lib/discovery.mjs')

// Build engine deps exactly like the companion tool layer (per call: config +
// env at that moment — engines are rebuilt on every search).
function buildEngines(cwd) {
  const config = C.readDiscoveryConfig(cwd, process.env)
  const presence = C.enginesForConfig(config)
  const engines = {}
  if (presence.searxng) engines.searxng = C.createSearxngEngine({ endpoint: config.searxngEndpoint })
  if (presence.browser39) engines.browser39 = C.createBrowser39Engine({ bin: config.browser39Bin })
  return engines
}

// --- fixture web server (dual-stack loopback) ----------------------------------
const FILLER = 'lorem ipsum dolor sit amet '.repeat(120) // ~3240 chars → 'full'
const FULL_PAGE = (title, body) =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  if (path === '/a') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(FULL_PAGE('M7 V2 A', 'SENTINEL-M7-V2A ' + FILLER)); return }
  if (path === '/b') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(FULL_PAGE('M7 V2 B', 'SENTINEL-M7-V2B ' + FILLER)); return }
  res.writeHead(404); res.end('nope')
})
await new Promise((r) => server.listen(0, r))
const base = 'http://127.0.0.1:' + server.address().port

// --- built core lib, tools in-process, repo cwd (shared store root w/ :3090) --
const lib = require(join(repoRoot, 'lib', 'index.js'))
const tools = []
lib.apply({
  tools: { register: (def) => { tools.push(def); return () => {} } },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
})
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
if (!byName.mission_fetch || !byName.mission_start || !byName.mission_status) {
  console.error('FATAL: mission tools not registered in built lib')
  process.exit(1)
}
const exec = () => ({})
const startMission = (args) => byName.mission_start.execute({ note: args.note, budget: args.budget, cwd: repoRoot }, exec())
const fetchTool = (mid, args) => byName.mission_fetch.execute({ mission_id: mid, url: args.url, force: args.force, cwd: repoRoot }, exec())
const status = (mid) => byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())

// --- allowlist (written then restored) ------------------------------------------
const allowlistPath = join(repoRoot, '.dsh', 'allowlist.txt')
const allowlistBackup = existsSync(allowlistPath) ? readFileSync(allowlistPath, 'utf8') : null
// NOTE: www.example.com is deliberately ABSENT — it is V2's denial target.
const ALLOWLIST = ['127.0.0.1', 'localhost', '127.0.0.2', '127.0.0.3', 'www.sparda-berlin.de']
mkdirSync(join(repoRoot, '.dsh'), { recursive: true })
writeFileSync(allowlistPath, ALLOWLIST.join('\n') + '\n')

// --- companion config (written then removed) ------------------------------------
const discCfgDir = join(repoRoot, '.dsh', 'web-discovery')
const discCfgPath = join(discCfgDir, C.CONFIG_FILENAME)
const writeDiscCfg = (obj) => { mkdirSync(discCfgDir, { recursive: true }); writeFileSync(discCfgPath, JSON.stringify(obj, null, 2)) }
const clearDiscCfg = () => { if (existsSync(discCfgPath)) rmSync(discCfgPath) }

// --- V1: no SearXNG, no browser39-search → no_engine ----------------------------
// Both engines disabled by config (env overrides removed too — BROWSER39_BIN
// is set for the core's fetch counting and would otherwise re-enable the
// browser39 engine).
writeDiscCfg({ searxngEndpoint: '', browser39Bin: '' })
delete process.env.BROWSER39_BIN
{
  const r = await C.runDiscoverySearch({ engines: buildEngines(repoRoot) }, 'm7 acceptance')
  check('V1: no_engine (supported state, not a crash)', r.ok === false && String(r.error).startsWith('no_engine'), J(r))
  check('V1: reason names searxng not configured', /searxng/i.test(String(r.error)), J(r.error))
  check('V1: reason names browser39 not configured', /browser39/.test(String(r.error)), J(r.error))
  check('V1: hints the supported fallback (fixtures/manual)', /fixtures|manual|directly/i.test(String(r.error)), J(r.error))
}
process.env.BROWSER39_BIN = wrapper
clearDiscCfg()
writeFileSync(callLog, '') // re-zero spawn counts (V1 did no core fetches)

// --- V2: SearXNG up on the DEFAULT endpoint (:8888) → URLs → core fetch gate ----
const SEARXNG_PORT = 8888
const stub = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1:' + SEARXNG_PORT)
  if (u.pathname !== '/searxng/search' || u.searchParams.get('format') !== 'json') {
    res.writeHead(400); res.end('{"error":"format=json required"}'); return
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({
    query: u.searchParams.get('q'),
    results: [
      { url: base + '/a', title: 'M7 Fixture A', content: 'admitted by the allowlist (127.0.0.1)', engine: 'test', score: 1.0 },
      { url: 'https://www.example.com/', title: 'M7 Fixture B (unlisted host)', content: 'must be denied by the core allowlist gate', engine: 'test', score: 0.9 },
    ],
  }))
})
await new Promise((resolve, reject) => {
  stub.once('error', reject)
  stub.listen(SEARXNG_PORT, '127.0.0.1', resolve)
})
check('V2 setup: stub SearXNG listening on the default endpoint :8888', true)

let missionId = null
{
  const r = await C.runDiscoverySearch({ engines: buildEngines(repoRoot) }, 'm7 acceptance fixture urls', { limit: 5 })
  check('V2: query → ≥1 URL via searxng', r.ok === true && r.engine === 'searxng' && r.count >= 1, J(r))
  check('V2: urls shaped to DiscoveryPort ({url,title?,snippet?})', r.ok && r.urls.every((x) => typeof x.url === 'string' && x.url.startsWith('http') && Object.keys(x).every((k) => ['url', 'title', 'snippet'].includes(k))), J(r.urls))

  const m = await startMission({ note: 'M7 acceptance — V2 discovery bridge', budget: 5 })
  missionId = m.mission_id
  check('V2 setup: core mission started', !!missionId, J(m))

  // The companion records (one-way bridge; no via.at → exercises the now-fallback)
  const rec = C.recordDiscovery(join(repoRoot, '.dsh', 'web-missions', missionId), r.urls, { query: 'm7 acceptance fixture urls', engine: 'searxng' })
  check('V2: recordDiscovery wrote discovery.json (updated_at fallback)', typeof rec.updated_at === 'string' && rec.urls.length === r.urls.length, J({ updated_at: rec.updated_at, n: rec.urls.length }))

  const st = await status(missionId)
  check('V2: mission_status surfaces the discovery field', !!st.discovery && st.discovery.urls.length === r.urls.length, J(st.discovery))

  const fAdmit = await fetchTool(missionId, { url: base + '/a' })
  check('V2: admitted URL fetches through the core (real spawn)', fAdmit.ok !== false && fAdmit.cached === false && fAdmit.page_quality === 'full', J({ ok: fAdmit.ok, q: fAdmit.page_quality, e: fAdmit.error }))
  check('V2: one spawn for the admitted fetch', callCount() === 1, 'calls=' + callCount())

  const fDeny = await fetchTool(missionId, { url: 'https://www.example.com/' })
  check('V2: unlisted URL → allowlist_denied (the re-gate proof)', fDeny.ok === false && String(fDeny.error).includes('allowlist_denied'), J({ ok: fDeny.ok, e: fDeny.error }))
  check('V2: denial costs no spawn', callCount() === 1, 'calls=' + callCount())

  const st2 = await status(missionId)
  check('V2: D-M7.4 — discovered URLs are not ledger rows until fetched', st2.visited.length === 1 && st2.visited[0].url !== 'https://www.example.com/', J(st2.visited.map((v) => v.url)))
  check('V2: budget spent exactly 1 (admitted fetch only)', st2.budget.spent === 1 && st2.budget.remaining === 4, J(st2.budget))
}

// --- V3: browser39 search LIVE (2.0.0, DDG egress) → DiscoveryPort shape -------
// DDG rate-limits rapid queries (bot challenge → HTTP 202 → browser39_blocked);
// retry with cooldown — the challenge window clears within minutes.
{
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  let r = null
  for (let attempt = 1; attempt <= 10; attempt++) {
    r = await C.runDiscoverySearch({ engines: buildEngines(repoRoot) }, 'tokio rust async runtime', { engine: 'browser39', limit: 5 })
    if (r.ok) break
    if (!/blocked/.test(String(r.error))) break // a different failure — stop retrying
    if (attempt < 10) await sleep(60000) // DDG challenge cooldown (clears within minutes)
  }
  check('V3: live browser39 search → ok with ≥1 URL', r.ok === true && r.engine === 'browser39' && r.count >= 1, J({ ok: r?.ok, e: r?.error, n: r?.count }))
  check('V3: all urls absolute http(s)', r.ok && r.urls.every((x) => /^https?:\/\/[^\s]+$/i.test(x.url)), J(r.urls?.map((x) => x.url)))
  check('V3: anchor-text titles present (DDG SERP shape mapped)', r.ok && r.urls.some((x) => typeof x.title === 'string' && x.title.length > 0), J(r.urls?.map((x) => x.title)))
  if (r.ok) {
    C.recordDiscovery(join(repoRoot, '.dsh', 'web-missions', missionId), r.urls, { query: 'tokio rust async runtime', engine: 'browser39' })
    const st = await status(missionId)
    check('V3: live results recorded + surfaced (merged, deduped)', st.discovery.urls.length >= 3, J(st.discovery?.urls.map((u) => u.url)))
  } else {
    check('V3: live results recorded + surfaced (merged, deduped)', false, 'live search did not return urls (' + r?.error + ')')
  }
}

// --- V4: engines down mid-mission → no_engine, prior data intact ----------------
{
  const before = C.readDiscoveryFile(join(repoRoot, '.dsh', 'web-missions', missionId))
  const stBefore = await status(missionId)
  stub.close() // searxng down
  process.env.BROWSER39_BIN = '/nonexistent/browser39' // bin absent
  const r = await C.runDiscoverySearch({ engines: buildEngines(repoRoot) }, 'm7 acceptance after engine death')
  check('V4: engine down mid-mission → no_engine on next query', r.ok === false && String(r.error).startsWith('no_engine'), J(r))
  check('V4: reason covers both engines down', /searxng/.test(String(r.error)) && /browser39/.test(String(r.error)), J(r.error))

  const after = C.readDiscoveryFile(join(repoRoot, '.dsh', 'web-missions', missionId))
  check('V4: discovery.json intact (same urls + updated_at)', JSON.stringify(after) === JSON.stringify(before), 'diff')
  const stAfter = await status(missionId)
  check('V4: mission_status still serves discovery + ledger + budget intact', JSON.stringify(stAfter.discovery) === JSON.stringify(stBefore.discovery) && stAfter.visited.length === stBefore.visited.length && stAfter.budget.spent === stBefore.budget.spent, J({ d: stAfter.discovery?.urls.length, v: stAfter.visited.length, b: stAfter.budget }))
  process.env.BROWSER39_BIN = wrapper // restore for any later step
}

// --- cleanup ---------------------------------------------------------------------
server.close()
if (allowlistBackup !== null) writeFileSync(allowlistPath, allowlistBackup)
else if (existsSync(allowlistPath)) rmSync(allowlistPath)
clearDiscCfg()
rmSync(work, { recursive: true, force: true })

if (fail > 0) { console.error('M7 ACCEPTANCE: ' + fail + ' check(s) FAILED'); process.exit(1) }
console.log('M7 ACCEPTANCE: all checks passed (' + pass + ' checks) — mission ' + missionId + ' left in the shared store (V5 runs in the shell)')
