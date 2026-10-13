// M2 acceptance (slice 2.6): V1–V6 per plan/M_2_fetcher.md, run against the
// live :3090 server (routes) with tools applied in-process from the BUILT lib
// (repo cwd — the same store root the live routes serve, per M1 acceptance
// idiom). Real browser39 spawns go through a COUNTING BROWSER39_BIN wrapper
// (V3: assert zero batch invocation on normalize_failed).
//
// Layout:
//   V1  fetch fixture /good (full page)      → receipt + on-disk artifacts + ledger row
//   V2  fetch fixture /missing (404)         → blocked, no chunks, ledger row quality blocked
//   V3  fetch unparsable url                 → normalize_failed, batch counter unchanged
//   V4  fetch /good again                    → M3: immediate cache hit (cached:true,
//        same artifact, no new row, zero new batch) — M2 pre-state (two rows)
//        superseded by D-M3.2
//   V5  BROWSER39_BIN → dead path, fetch NOT-yet-stored url → spawn_failed;
//        mission still usable after (re-fetch /good is now a zero-spawn hit)
//   V6  fetch /redir (302 → /redir2 → 302 → /good?arrived=1)
//       → final_url recorded; ledger key = normalized FINAL url; a direct fetch
//         of the final url shares the same key
// Live:  :3090 /health 200; /missions + /missions/<id> (live routes) show the
//        acceptance mission with the rows the in-process tools wrote.
// Exit 0 iff every check passes. Never touches :3080 / :8080.
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readdirSync, rmSync } from 'node:fs'
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
    if (existsSync(candidate)) { platformBin = candidate; break }
  } catch { /* not installed */ }
}
if (!platformBin) {
  console.error('FATAL: platform browser39 binary not found in node_modules')
  process.exit(1)
}

// --- counting wrapper for BROWSER39_BIN ---------------------------------------
const work = mkdtempSync(join(tmpdir(), 'accept-m2-'))
const callLog = join(work, 'b39-calls.log')
writeFileSync(callLog, '')
const wrapper = join(work, 'b39-count.sh')
writeFileSync(wrapper, `#!/bin/sh\necho "call" >> ${JSON.stringify(callLog)}\nexec ${JSON.stringify(platformBin)} "$@"\n`)
chmodSync(wrapper, 0o755)
const callCount = () => require('node:fs').readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length
process.env.BROWSER39_BIN = wrapper

// --- fixture server (full page, 404, redirect chain) ---------------------------
const FILLER = 'lorem ipsum dolor sit amet '.repeat(120) // → ~3240 chars
const pages = {
  '/good': {
    status: 200,
    body: '<html><head><title>Acceptance Good Page</title></head><body>' +
      '<h1>Good</h1><p>SENTINEL-M2-ACCEPT ' + FILLER + '</p>' +
      '<a href="/other">other page</a><a href="/good#self">self</a>' +
      '</body></html>',
  },
  '/other': { status: 200, body: '<html><head><title>Other</title></head><body><p>other content ' + 'o'.repeat(400) + '</p></body></html>' },
  '/missing': { status: 404, body: '<html><head><title>404</title></head><body>Nothing Here</body></html>' },
  '/redir': { status: 302, location: '/redir2' },
  '/redir2': { status: 302, location: '/good?arrived=1' },
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

const started = await byName.mission_start.execute({ note: 'M2 acceptance', cwd: repoRoot }, exec())
check('setup: mission started', !!started.mission_id, J(started))
const mid = started.mission_id
// M5 5.2: egress allowlist (deny-all default) — permit the local fixture server.
mkdirSync(join(repoRoot, '.dsh'), { recursive: true })
writeFileSync(join(repoRoot, '.dsh', 'allowlist.txt'), '127.0.0.1\n')
const artDir = (aid) => join(repoRoot, '.dsh', 'web-missions', mid, 'pages', aid)

// --- V1 ------------------------------------------------------------------------
const v1 = await byName.mission_fetch.execute({ url: base + '/good', mission_id: mid, cwd: repoRoot }, exec())
check('V1: receipt clean (no error)', !v1.error, J(v1))
check('V1: cached:false + full + chunks ≥1', v1.cached === false && v1.page_quality === 'full' && v1.chunk_count >= 1, J({ c: v1.cached, q: v1.page_quality, n: v1.chunk_count, s: v1.quality_signals }))
check('V1: page.json on disk', existsSync(artDir(v1.artifact_id) + '/page.json'), v1.artifact_id)
check('V1: chunks on disk', existsSync(artDir(v1.artifact_id) + '/chunks') && readdirSync(artDir(v1.artifact_id) + '/chunks').length === v1.chunk_count, readdirSync(artDir(v1.artifact_id) + '/chunks').join(','))
check('V1: links.json on disk', existsSync(artDir(v1.artifact_id) + '/links.json'))
check('V1: preview_head ≤300 w/ sentinel', v1.preview_head.length <= 300 && v1.preview_head.includes('SENTINEL-M2-ACCEPT'), v1.preview_head.slice(0, 40))
const stV1 = await byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())
check('V1: ledger row present', stV1.visited.length === 1 && stV1.visited[0].quality === 'full', J(stV1.visited.map((r) => [r.normalized_url, r.quality])))
check('V1: exactly one browser39 batch ran', callCount() === 1, 'calls=' + callCount())

// --- V2 ------------------------------------------------------------------------
const v2 = await byName.mission_fetch.execute({ url: base + '/missing', mission_id: mid, cwd: repoRoot }, exec())
check('V2: blocked receipt', v2.page_quality === 'blocked' && !v2.error, J({ q: v2.page_quality, s: v2.quality_signals, e: v2.error }))
check('V2: no chunks', v2.chunk_count === 0 && !existsSync(artDir(v2.artifact_id) + '/chunks'))
check('V2: page.json stored (dead URL is known)', existsSync(artDir(v2.artifact_id) + '/page.json'))
const stV2 = await byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())
check('V2: ledger row quality blocked', stV2.visited.length === 2 && stV2.visited.some((r) => r.quality === 'blocked'), J(stV2.visited.map((r) => r.quality)))

// --- V3 ------------------------------------------------------------------------
const callsBeforeV3 = callCount()
const v3 = await byName.mission_fetch.execute({ url: 'not a url at all', mission_id: mid, cwd: repoRoot }, exec())
check('V3: error normalize_failed', v3.ok === false && v3.error.startsWith('normalize_failed:'), J(v3))
check('V3: NO batch invocation', callCount() === callsBeforeV3, 'calls ' + callsBeforeV3 + '->' + callCount())
const stV3 = await byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())
check('V3: no ledger row added', stV3.visited.length === 2, 'visited=' + stV3.visited.length)

// --- V4 (M2 pre-state superseded by M3: a re-fetch is now a cache hit) --------
const v4 = await byName.mission_fetch.execute({ url: base + '/good', mission_id: mid, cwd: repoRoot }, exec())
check('V4: second fetch is a cache hit', !v4.error && v4.cached === true, J(v4.error || { c: v4.cached }))
check('V4: same artifact (no overwrite, no new id)', v4.artifact_id === v1.artifact_id, J([v1.artifact_id, v4.artifact_id]))
const stV4 = await byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())
check('V4: still one row for the key (D-M3.2)', stV4.visited.filter((r) => r.normalized_url === stV4.visited[0].normalized_url).length === 1, 'rows=' + stV4.visited.length)
check('V4: total batches = 2 (v1,v2 — v4 was zero-spawn)', callCount() === 2, 'calls=' + callCount())

// --- V5 ------------------------------------------------------------------------
// /good?dead=1 serves the /good page (query is a distinct normalized URL) and
// is NOT yet stored — stored URLs would be cache hits, not spawns (M3).
const deadBin = join(work, 'definitely-missing-browser39')
process.env.BROWSER39_BIN = deadBin
const v5 = await byName.mission_fetch.execute({ url: base + '/good?dead=1', mission_id: mid, cwd: repoRoot }, exec())
check('V5: error spawn_failed', v5.ok === false && v5.error.startsWith('spawn_failed:'), J(v5))
process.env.BROWSER39_BIN = wrapper
const v5b = await byName.mission_fetch.execute({ url: base + '/good', mission_id: mid, cwd: repoRoot }, exec())
check('V5: mission still usable after failure (zero-spawn hit)', !v5b.error && v5b.cached === true && v5b.page_quality === 'full', J(v5b.error || { c: v5b.cached, q: v5b.page_quality }))
const stV5 = await byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())
check('V5: no row for failed fetch', stV5.visited.length === 2, 'visited=' + stV5.visited.length) // v1,v2 only

// --- V6 ------------------------------------------------------------------------
const v6 = await byName.mission_fetch.execute({ url: base + '/redir', mission_id: mid, cwd: repoRoot }, exec())
const finalUrl = base + '/good?arrived=1'
check('V6: redirect chain followed to final_url', v6.final_url === finalUrl, J({ final: v6.final_url, requested: v6.url }))
check('V6: receipt clean + full', !v6.error && v6.page_quality === 'full', J({ q: v6.page_quality, e: v6.error }))
const v6b = await byName.mission_fetch.execute({ url: finalUrl, mission_id: mid, cwd: repoRoot }, exec())
const stV6 = await byName.mission_status.execute({ mission_id: mid, cwd: repoRoot }, exec())
const keyRedirect = stV6.visited.find((r) => r.artifact_id === v6.artifact_id)?.normalized_url
const keyDirect = stV6.visited.find((r) => r.artifact_id === v6b.artifact_id)?.normalized_url
check('V6: ledger key = normalized FINAL url', keyRedirect !== undefined && keyRedirect === keyDirect, J({ keyRedirect, keyDirect }))
check('V6: both normalize equal (share a key)', keyRedirect === new URL(finalUrl).protocol + '//' + new URL(finalUrl).host + '/good?arrived=1', J(keyRedirect))

// --- live :3090 cross-check -----------------------------------------------------
const liveBase = 'http://127.0.0.1:3090'
const health = await (await fetch(liveBase + '/api/web-missions/health')).json()
check('live: :3090 health ok', health.ok === true && health.name === 'dsh-local-web-missions', J(health))
const list = await (await fetch(liveBase + '/api/web-missions/missions')).json()
const liveRow = (list.active || []).find((m) => m.mission_id === mid)
check('live: acceptance mission visible via live routes', !!liveRow && liveRow.status === 'active', J(liveRow))
if (liveRow) {
  const totalRows = 3 // /good (v1), /missing (v2), /good?arrived=1 (v6); v4/v5b/v6b are M3 cache hits (no rows)
  check('live: rows written in-process visible on live route', liveRow.visited === totalRows && liveRow.pages === totalRows, J({ visited: liveRow.visited, pages: liveRow.pages, expected: totalRows }))
  const byId = await (await fetch(liveBase + '/api/web-missions/missions/' + mid)).json()
  check('live: by-id route serves ledger', Array.isArray(byId.visited) && byId.visited.length === totalRows, 'visited=' + (byId.visited || []).length)
}

console.log(fail === 0 ? 'M2 ACCEPTANCE: all checks passed' : 'M2 ACCEPTANCE: ' + fail + ' FAILURES')
server.close()
rmSync(work, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
