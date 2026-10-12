// M3 acceptance (slices 3.5 + 3.6): V1–V6 per plan/M_3_cache.md, run against
// the live :3090 server (routes) with tools applied in-process from the BUILT
// lib (repo cwd — the same store root the live routes serve, per M1/M2
// acceptance idiom). Real browser39 spawns go through a COUNTING BROWSER39_BIN
// wrapper so batch-invocation counts are exact (this script is the M8 DoD
// proof seed — D-M3.4: M8 reuses it, not reinvents it).
//
// Layout:
//   V1  fetch /a (miss) → fetch /a again
//       → second: cached:true, same artifact_id, exactly ONE batch for both
//   V2  fetch /b same host (miss) → hint_find_first on B's receipt; /a still hits
//   V3  force:true on /a → new spawn, same artifact_id, row updated in place
//       (row count unchanged), cached:false, age_days:0
//   V4  backdate /a row fetched_at -25h → hit receipt age_days ≈ 1.04,
//       zero batch (injected-clock arithmetic proven in the smoke harness)
//   V5  fetch /blocked (404, miss) → re-fetch (no force) → cached:true,
//       page_quality blocked, zero batch
//   V6  fetch /redir (302 → /a, miss, collapses onto /a's row in place) →
//       re-fetch /redir → cache hit (same normalized final-URL key)
// Live:  :3090 /health 200; /missions + /missions/<id> show the acceptance
//        mission with exactly 3 rows / 3 artifacts.
// Exit 0 iff every check passes. Never touches :3080 / :8080.
import http from 'node:http'
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
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

// --- counting wrapper for BROWSER39_BIN ---------------------------------------
const work = mkdtempSync(join(tmpdir(), 'accept-cache-'))
const callLog = join(work, 'b39-calls.log')
writeFileSync(callLog, '')
const wrapper = join(work, 'b39-count.sh')
writeFileSync(wrapper, `#!/bin/sh\necho "call" >> ${JSON.stringify(callLog)}\nexec ${JSON.stringify(platformBin)} "$@"\n`)
chmodSync(wrapper, 0o755)
const callCount = () => readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length
process.env.BROWSER39_BIN = wrapper

// --- fixture server (two full pages, 404, redirect) ----------------------------
const FILLER = 'lorem ipsum dolor sit amet '.repeat(120) // → ~3240 chars
const pages = {
  '/a': {
    status: 200,
    body: '<html><head><title>Page A</title></head><body>' +
      '<h1>A</h1><p>SENTINEL-M3-CACHE ' + FILLER + '</p>' +
      '<a href="/b">to b</a>' +
      '</body></html>',
  },
  '/b': {
    status: 200,
    body: '<html><head><title>Page B</title></head><body>' +
      '<h1>B</h1><p>SENTINEL-M3-B ' + FILLER + '</p>' +
      '<a href="/a">to a</a>' +
      '</body></html>',
  },
  '/blocked': { status: 404, body: '<html><head><title>404</title></head><body>Nothing Here</body></html>' },
  '/redir': { status: 302, location: '/a' },
}
const server = http.createServer((req, res) => {
  const spec = pages[req.url.split('?')[0]]
  if (!spec) { res.writeHead(404); res.end('nope'); return }
  if (spec.location) { res.writeHead(spec.status, { Location: spec.location }); res.end(); return }
  res.writeHead(spec.status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(spec.body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

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
if (!byName.mission_fetch) {
  console.error('FATAL: mission_fetch not registered in built lib')
  process.exit(1)
}
const exec = () => ({})
const J = (v) => JSON.stringify(v)

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label); else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const started = await byName.mission_start.execute({ note: 'M3 acceptance', cwd: repoRoot }, exec())
check('setup: mission started', !!started.mission_id, J(started))
const mid = started.mission_id

const fetchTool = (args) => byName.mission_fetch.execute({ mission_id: mid, cwd: repoRoot, ...args }, exec())
const status = async () => byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())

// --- V1 ------------------------------------------------------------------------
const a1 = await fetchTool({ url: base + '/a' })
check('V1: first fetch fresh (cached:false, full, age_days 0)', a1.cached === false && a1.page_quality === 'full' && a1.age_days === 0, J({ c: a1.cached, q: a1.page_quality, age: a1.age_days, e: a1.error }))
check('V1: one batch after first fetch', callCount() === 1, 'calls=' + callCount())
const a2 = await fetchTool({ url: base + '/a' })
check('V1: second fetch cached:true, same artifact_id', a2.cached === true && a2.artifact_id === a1.artifact_id && a2.age_days === 0, J({ c: a2.cached, a: [a1.artifact_id, a2.artifact_id], age: a2.age_days }))
check('V1: exactly one batch invocation for both fetches', callCount() === 1, 'calls=' + callCount())
check('V1: cached hint wording', a2.next_step_hint === 'cached: already stored (age 0d). Use mission_find, or pass force: true to re-fetch.', a2.next_step_hint)
check('V1: one ledger row', (await status()).visited.length === 1, 'rows=' + (await status()).visited.length)

// --- V2 ------------------------------------------------------------------------
const b1 = await fetchTool({ url: base + '/b' })
check('V2: B fresh (miss, age_days 0)', b1.cached === false && b1.age_days === 0, J({ c: b1.cached, age: b1.age_days, e: b1.error }))
check('V2: one new batch for B', callCount() === 2, 'calls=' + callCount())
check('V2: B receipt carries hint_find_first', b1.hint_find_first === 'this host has 1 stored pages — consider mission_find before fetching a new path', J(b1.hint_find_first))
const a3 = await fetchTool({ url: base + '/a' })
check('V2: A still a hit (V1 holds), no new batch', a3.cached === true && a3.artifact_id === a1.artifact_id && callCount() === 2, J({ c: a3.cached, calls: callCount() }))

// --- V3 ------------------------------------------------------------------------
const rowsBeforeForce = (await status()).visited.length
const aForce = await fetchTool({ url: base + '/a', force: true })
check('V3: force → fresh receipt (cached:false, age_days 0)', aForce.cached === false && aForce.age_days === 0, J({ c: aForce.cached, age: aForce.age_days, e: aForce.error }))
check('V3: force → same artifact_id', aForce.artifact_id === a1.artifact_id, J([a1.artifact_id, aForce.artifact_id]))
check('V3: one new batch (real spawn)', callCount() === 3, 'calls=' + callCount())
const stForce = await status()
check('V3: row count unchanged (in-place update)', stForce.visited.length === rowsBeforeForce, 'rows ' + rowsBeforeForce + '->' + stForce.visited.length)
const rowA = stForce.visited.find((r) => r.artifact_id === a1.artifact_id)
check('V3: row refreshed (new fetched_at, same key + artifact)', !!rowA && rowA.fetched_at === aForce.fetched_at, J(rowA))

// --- V4 ------------------------------------------------------------------------
// Backdate the /a row's fetched_at by 25h, then re-hit → age_days ≈ 1.04
// (injected-clock arithmetic itself is unit-proven in the smoke harness).
const manifestPath = join(repoRoot, '.dsh', 'web-missions', mid, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const rowBackdate = manifest.fetched.find((r) => r.artifact_id === a1.artifact_id)
rowBackdate.fetched_at = new Date(Date.now() - 25 * 3600 * 1000).toISOString()
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
const aAged = await fetchTool({ url: base + '/a' })
check('V4: aged hit cached:true, zero batch', aAged.cached === true && callCount() === 3, J({ c: aAged.cached, calls: callCount() }))
check('V4: age_days ≈ 1.04 (25h)', aAged.age_days === 1.04, 'age=' + aAged.age_days)
check('V4: cached hint carries the age', aAged.next_step_hint === 'cached: already stored (age 1.04d). Use mission_find, or pass force: true to re-fetch.', aAged.next_step_hint)

// --- V5 ------------------------------------------------------------------------
const bl1 = await fetchTool({ url: base + '/blocked' })
check('V5: blocked fresh (miss, no chunks)', bl1.cached === false && bl1.page_quality === 'blocked' && bl1.chunk_count === 0, J({ c: bl1.cached, q: bl1.page_quality, s: bl1.quality_signals }))
check('V5: one new batch', callCount() === 4, 'calls=' + callCount())
const bl2 = await fetchTool({ url: base + '/blocked' })
check('V5: blocked re-fetch cached:true + quality blocked', bl2.cached === true && bl2.page_quality === 'blocked' && bl2.artifact_id === bl1.artifact_id, J({ c: bl2.cached, q: bl2.page_quality, a: [bl1.artifact_id, bl2.artifact_id] }))
check('V5: zero batch on blocked hit', callCount() === 4, 'calls=' + callCount())
check('V5: blocked cached hint wording', bl2.next_step_hint === 'cached: stored as blocked (age 0d). Re-fetch with force: true if you expect new content.', bl2.next_step_hint)

// --- V6 ------------------------------------------------------------------------
const r1 = await fetchTool({ url: base + '/redir' })
check('V6: redirect fetch followed to final_url /a (miss)', r1.cached === false && r1.final_url === base + '/a', J({ c: r1.cached, f: r1.final_url, e: r1.error }))
check('V6: collapse reuses /a artifact in place', r1.artifact_id === a1.artifact_id, J([a1.artifact_id, r1.artifact_id]))
check('V6: one new batch', callCount() === 5, 'calls=' + callCount())
const r2 = await fetchTool({ url: base + '/redir' })
check('V6: redirect-equivalent re-fetch → cache hit, same artifact', r2.cached === true && r2.artifact_id === a1.artifact_id, J({ c: r2.cached, a: r2.artifact_id }))
check('V6: zero batch on redirect-alias hit', callCount() === 5, 'calls=' + callCount())
const stV6 = await status()
const rowFinal = stV6.visited.find((r) => r.artifact_id === a1.artifact_id)
check('V6: row still keyed on the final URL /a', !!rowFinal && rowFinal.url === base + '/a', J(rowFinal))
check('V6: ledger has exactly 3 rows (one per normalized URL)', stV6.visited.length === 3, 'rows=' + stV6.visited.length)

// --- live :3090 cross-check -----------------------------------------------------
const liveBase = 'http://127.0.0.1:3090'
const health = await (await fetch(liveBase + '/api/web-missions/health')).json()
check('live: :3090 health ok', health.ok === true && health.name === 'dsh-local-web-missions', J(health))
const list = await (await fetch(liveBase + '/api/web-missions/missions')).json()
const liveRow = (list.active || []).find((m) => m.mission_id === mid)
check('live: acceptance mission visible via live routes', !!liveRow && liveRow.status === 'active', J(liveRow))
if (liveRow) {
  check('live: 3 rows / 3 artifacts visible on live route', liveRow.visited === 3 && liveRow.pages === 3, J({ visited: liveRow.visited, pages: liveRow.pages }))
  const byId = await (await fetch(liveBase + '/api/web-missions/missions/' + mid)).json()
  check('live: by-id route serves ledger', Array.isArray(byId.visited) && byId.visited.length === 3, 'visited=' + (byId.visited || []).length)
}

console.log(fail === 0 ? 'M3 ACCEPTANCE: all checks passed' : 'M3 ACCEPTANCE: ' + fail + ' FAILURES')
server.close()
rmSync(work, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
