#!/usr/bin/env node
// M8 8.4 — S1-specific zero-batch cache proof (supplements scripts/accept-cache.mjs,
// the M3-built formal A3 DoD check, per D-M3.4 "M8 reuses it"). While accept-cache
// proves the mechanism on a hermetic fixture, THIS re-runs the second-fetch-of-a-
// stored-URL assertion against the ACTUAL S1 smoke data (mission m-3808dcd8, the
// partner_daten store on :3090): a `mission_fetch` of an already-stored S1 URL must
// return cached:true with the SAME artifact_id and NO new browser39 batch.
//
// Design (self-contained, hermetic control):
//   1. A counting BROWSER39_BIN wrapper (same idiom as accept-cache.mjs) makes
//      batch-invocation counts exact.
//   2. CONTROL: a fresh mission in an ISOLATED temp cwd fetches a local fixture
//      page → wrapper count 0→1, proving the wrapper is live in this process (so
//      a later "0 new batches" is meaningful, not a silent no-op).
//   3. S1 RE-FETCH (repo cwd = live :3090 store): re-fetch two stored S1 URLs
//      (dkb.de, allianz.de) on m-3808dcd8 → both cached:true, same artifact_id as
//      the 8.3 fetch, wrapper count unchanged (no new batch).
//   4. Ledger UNCHANGED: the S1 manifest still has exactly its 10 rows / artifacts
//      (cache hits mutate nothing; no refetch, no budget).
// Read-only w.r.t. the S1 store (hitFree path returns before any spawn/charge).
// Exit 0 iff every check passes. Never touches :3080 / :8080.
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const MISSION = process.argv[2] || 'm-3808dcd8'
const require = createRequire(import.meta.url)

// --- platform browser39 binary (the real one, wrapped for counting) -------------
let platformBin = null
for (const name of [
  '@aquintanar/browser39-linux-x64', '@aquintanar/browser39-linux-arm64',
  '@aquintanar/browser39-darwin-x64', '@aquintanar/browser39-darwin-arm64',
  '@aquintanar/browser39-win32-x64',
]) {
  try {
    const pkgJson = require.resolve(`${name}/package.json`)
    const candidate = join(dirname(pkgJson), 'bin', 'browser39')
    if (require('node:fs').existsSync(candidate)) { platformBin = candidate; break }
  } catch { /* not installed */ }
}
if (!platformBin) { console.error('FATAL: platform browser39 binary not found'); process.exit(1) }

const work = mkdtempSync(join(tmpdir(), 'prove-s1-cache-'))
const callLog = join(work, 'b39-calls.log')
writeFileSync(callLog, '')
const wrapper = join(work, 'b39-count.sh')
writeFileSync(wrapper, `#!/bin/sh\necho "call" >> ${JSON.stringify(callLog)}\nexec ${JSON.stringify(platformBin)} "$@"\n`)
chmodSync(wrapper, 0o755)
const callCount = () => readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length
process.env.BROWSER39_BIN = wrapper
process.env.BROWSER39_SESSIONS_DIR = join(work, 'b39-sessions')

// --- local fixture server (one page, for the hermetic control fetch) -------------
const FILLER = 'lorem ipsum dolor sit amet '.repeat(120)
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<html><head><title>Ctrl</title></head><body><h1>C</h1><p>SENTINEL-CTRL ' + FILLER + '</p></body></html>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

// --- built lib, tools in-process --------------------------------------------------
const lib = require(join(repoRoot, 'lib', 'index.js'))
const tools = []
lib.apply({
  tools: { register: (def) => { tools.push(def); return () => {} } },
  effect: () => {}, inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
})
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
const exec = () => ({})

let fail = 0
const check = (label, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + label + (detail && !cond ? '  ::  ' + detail : '')); if (!cond) fail++ }

// manifest snapshot (for the "ledger unchanged" check)
const manifestBefore = JSON.parse(readFileSync(join(repoRoot, '.dsh', 'web-missions', MISSION, 'manifest.json'), 'utf8'))
const rowsBefore = (manifestBefore.fetched || []).map((r) => r.artifact_id + '|' + r.normalized_url).sort()

// --- CONTROL: prove the counting wrapper is live ---------------------------------
const iso = mkdtempSync(join(tmpdir(), 'prove-s1-iso-'))
mkdirSync(join(iso, '.dsh'), { recursive: true })
writeFileSync(join(iso, '.dsh', 'allowlist.txt'), '127.0.0.1\n')
const ctrl = await byName.mission_start.execute({ note: 'S1-cache control (isolated)', budget: 3, cwd: iso }, exec())
check('control: mission started', !!ctrl.mission_id, JSON.stringify(ctrl))
const c0 = callCount()
const ctrlFetch = await byName.mission_fetch.execute({ url: base + '/', mission_id: ctrl.mission_id, cwd: iso }, exec())
check('control: fresh fetch is NOT cached (real spawn)', ctrlFetch && !ctrlFetch.error && ctrlFetch.cached === false, JSON.stringify(ctrlFetch))
check('control: wrapper counted exactly one batch (live)', callCount() === c0 + 1, `before=${c0} after=${callCount()}`)

// --- S1 RE-FETCH: second fetch of a stored S1 URL → cached, no new batch ---------
const live = (missionId, url, artifact, name) => byName.mission_fetch.execute({ url, mission_id: missionId, cwd: repoRoot }, exec())
const b0 = callCount()
const dkb = await live(MISSION, 'https://www.dkb.de/', 'p-903f7dc9', 'DKB')
check('S1 dkb.de: cached:true (zero-spawn)', dkb && !dkb.error && dkb.cached === true, JSON.stringify(dkb))
check('S1 dkb.de: same artifact_id as the 8.3 fetch', dkb && dkb.artifact_id === 'p-903f7dc9', `artifact=${dkb && dkb.artifact_id}`)
const ali = await live(MISSION, 'https://www.allianz.de/', 'p-b16dfaba', 'Allianz')
check('S1 allianz.de: cached:true (zero-spawn)', ali && !ali.error && ali.cached === true, JSON.stringify(ali))
check('S1 allianz.de: same artifact_id as the 8.3 fetch', ali && ali.artifact_id === 'p-b16dfaba', `artifact=${ali && ali.artifact_id}`)
check('S1 re-fetches: NO new browser39 batch (counter unchanged)', callCount() === b0, `before=${b0} after=${callCount()}`)

// --- ledger UNCHANGED (cache hits mutate nothing) --------------------------------
const manifestAfter = JSON.parse(readFileSync(join(repoRoot, '.dsh', 'web-missions', MISSION, 'manifest.json'), 'utf8'))
const rowsAfter = (manifestAfter.fetched || []).map((r) => r.artifact_id + '|' + r.normalized_url).sort()
check('S1 ledger unchanged: same 10 rows', rowsBefore.length === 10 && rowsAfter.length === 10, `before=${rowsBefore.length} after=${rowsAfter.length}`)
check('S1 ledger unchanged: same artifact/URL set', JSON.stringify(rowsBefore) === JSON.stringify(rowsAfter), JSON.stringify(rowsAfter))
check('S1 ledger unchanged: budget still 10/10 (no re-charge)', manifestAfter.budget.spent === manifestBefore.budget.spent && manifestAfter.budget.spent === 10, JSON.stringify(manifestAfter.budget))

console.log(fail === 0 ? `\nS1 zero-batch cache proof: ALL GREEN (second fetch of stored URLs → cached:true, 0 new batches, ledger intact)` : `\nS1 cache proof: ${fail} FAILURE(S)`)
server.close()
rmSync(work, { recursive: true, force: true })
rmSync(iso, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
