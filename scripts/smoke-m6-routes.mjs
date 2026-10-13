// M6 6.1 smoke — the new pane routes, driven in-process against the BUILT
// lib. A fake ctx captures the registered webServer routes; synthetic
// Readable/ServerResponse-style objects drive the handlers, mirroring the
// webserver's dispatch (exact wins, then prefix: p matches p and p/<any>).
//
// Hermetic: temp cwd (mission root = <T>/.dsh/web-missions) and
// BROWSER39_SESSIONS_DIR=<T>/sessions — never touches the real store or
// ~/.dsh. Missions are created through the real tools (cwd=<T>); ledger rows
// for the consent scan are written directly to the manifests (the store
// layout is frozen; the consent EXECUTION itself is proven in M5 acceptance).
//
// --live (after :3090 restarts on the new build): real dispatch proof —
//   health + GET /sessions + POST /missions/:id/stop on a throwaway mission
//   in the live store (repoRoot). Never kills :3080/:8080, never clears the
//   live recents (destructive; covered hermetically).
//
// Exit 0 iff every check passes.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'

const LIVE = process.argv.includes('--live')
const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = dirname(here)
const require_ = createRequire(import.meta.url)

let fail = 0
const check = (label, cond, detail) => {
  if (cond) console.log('ok   ' + label)
  else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- hermetic sandbox ---------------------------------------------------------
const T = mkdtempSync(join(tmpdir(), 'm6-routes-'))
process.chdir(T)
process.env.BROWSER39_SESSIONS_DIR = join(T, 'sessions')
mkdirSync(join(T, 'sessions'), { recursive: true })

const lib = require_(join(repoRoot, 'lib', 'index.js'))
const tools = []
const routes = []
const webCtx = {
  webServer: { register: (r) => { routes.push(r); return () => {} } },
  effect: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
}
lib.apply({
  tools: { register: (def) => { tools.push(def); return () => {} } },
  effect: () => {},
  inject: (keys, cb) => { if (String(keys).includes('webServer')) cb(webCtx) },
  logger: () => ({ warn: () => {}, error: () => {} }),
})
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
if (!byName.mission_start || !byName.mission_stop) {
  console.error('FATAL: mission tools not registered in built lib')
  process.exit(1)
}
if (routes.length !== 6) {
  console.error('FATAL: expected 6 registered routes, got ' + routes.length)
  process.exit(1)
}

// --- dispatch (exact wins, then prefix — mirrors the harness webserver) ------
async function dispatch(method, urlPath, body) {
  const pathname = new URL(urlPath, 'http://127.0.0.1').pathname
  let route
  for (const r of routes) if (r.kind === 'exact' && r.path === pathname) { route = r; break }
  if (!route) for (const r of routes) if (r.kind === 'prefix' && (pathname === r.path || pathname.startsWith(r.path + '/'))) { route = r; break }
  if (!route) return { status: 404, body: { ok: false, error: 'not found (smoke dispatcher)' } }
  const req = new Readable({ read() {} })
  req.method = method
  req.url = urlPath
  req.headers = { host: '127.0.0.1' }
  if (body !== undefined) req.push(typeof body === 'string' ? body : Buffer.from(body))
  req.push(null)
  const res = {
    statusCode: 0,
    headers: null,
    data: null,
    writeHead(s, h) { this.statusCode = s; this.headers = h },
    end(b) { this.data = b === undefined ? null : b; return this },
  }
  const finished = new Promise((resolve) => {
    const origEnd = res.end.bind(res)
    res.end = (b) => { origEnd(b); resolve() }
  })
  route.handler(req, res)
  const timeout = sleep(3000).then(() => { throw new Error('handler did not respond: ' + method + ' ' + urlPath) })
  await Promise.race([finished, timeout])
  return { status: res.statusCode, body: res.data === null ? null : JSON.parse(res.data) }
}

const P = '/api/web-missions'
const readManifest = (id) => JSON.parse(readFileSync(join(T, '.dsh', 'web-missions', id, 'manifest.json'), 'utf8'))

// --- seed: two missions (via real tools) + ledger rows + session dirs --------
const ma = await byName.mission_start.execute({ note: 'M6 smoke A', budget: 2, cwd: T }, { })
const mb = await byName.mission_start.execute({ note: 'M6 smoke B', budget: 3, cwd: T }, { })
check('setup: two missions started', !!ma.mission_id && !!mb.mission_id && ma.mission_id !== mb.mission_id)

// Ledger rows for the consent scan:
//  - m-a: example.com attempted+improved @09:00, then a LATER row (11:00)
//    WITHOUT consent_attempted (M5-era shape) — must not displace the last
//    consent outcome.
//  - m-b: otherhost attempted, NOT improved @10:00.
const rowsA = [
  {
    normalized_url: 'https://example.com/', url: 'https://example.com/',
    artifact_id: 'p-01020304', quality: 'full', fetched_at: '2026-10-13T09:00:00.000Z',
    consent_attempted: true, consent_improved: true, budget_charged: true,
  },
  {
    normalized_url: 'https://example.com/deep', url: 'https://example.com/deep',
    artifact_id: 'p-05060708', quality: 'full', fetched_at: '2026-10-13T11:00:00.000Z',
    budget_charged: true, // no consent fields (M5-era row)
  },
]
const manifestA = readManifest(ma.mission_id)
manifestA.fetched = rowsA
writeFileSync(join(T, '.dsh', 'web-missions', ma.mission_id, 'manifest.json'), JSON.stringify(manifestA, null, 2) + '\n')
const manifestB = readManifest(mb.mission_id)
manifestB.fetched = [{
  normalized_url: 'https://otherhost.example/', url: 'https://otherhost.example/',
  artifact_id: 'p-090a0b0c', quality: 'thin', fetched_at: '2026-10-13T10:00:00.000Z',
  consent_attempted: true, consent_improved: false, budget_charged: true,
}]
writeFileSync(join(T, '.dsh', 'web-missions', mb.mission_id, 'manifest.json'), JSON.stringify(manifestB, null, 2) + '\n')

mkdirSync(join(T, 'sessions', 'example.com'), { recursive: true })
writeFileSync(join(T, 'sessions', 'example.com', 'config.toml'), '[session]\n')
writeFileSync(join(T, 'sessions', 'example.com', 'session.enc'), 'x')
mkdirSync(join(T, 'sessions', 'otherhost.example'), { recursive: true })
writeFileSync(join(T, 'sessions', 'otherhost.example', 'config.toml'), '[session]\n')
check('setup: ledger rows + two session dirs written', existsSync(join(T, 'sessions', 'example.com', 'session.enc')))

// --- R1: mission list + status (regression through the new handler code) -----
let r = await dispatch('GET', P + '/missions')
check('R1 list: 200 with 2 active + 2 recents', r.status === 200 && r.body.active?.length === 2 && r.body.recents?.length === 2, JSON.stringify(r))
r = await dispatch('GET', P + '/missions/' + ma.mission_id)
check('R1 status: 200, budget view + visited', r.status === 200 && r.body.budget?.max === 2 && r.body.visited?.length === 2 && r.body.budget?.remaining === 2, JSON.stringify(r.body?.budget))
r = await dispatch('GET', P + '/missions/m-deadbeef')
check('R1 status unknown id: 404 unknown_mission', r.status === 404 && /unknown_mission/.test(r.body.error), JSON.stringify(r))
r = await dispatch('GET', P + '/missions')
check('R1 bare prefix via exact route: 200 list (not 404)', r.status === 200 && Array.isArray(r.body.recents))
r = await dispatch('PUT', P + '/missions/' + ma.mission_id)
check('R1 status PUT: 405', r.status === 405, JSON.stringify(r))
r = await dispatch('GET', P + '/missions/m-nope/extra')
check('R1 status extra segment: 404 unknown_mission', r.status === 404 && /unknown_mission/.test(r.body.error), JSON.stringify(r))

// --- R2: /sessions (D-M6.4 visibility) ----------------------------------------
r = await dispatch('GET', P + '/sessions')
const sess = r.body.sessions ?? []
const ex = sess.find((s) => s.host === 'example.com')
const oh = sess.find((s) => s.host === 'otherhost.example')
check('R2 sessions: 200 with both hosts', r.status === 200 && sess.length === 2, JSON.stringify(r))
check('R2 example.com: attempted+improved @09:00 (later non-attempted row ignored)', !!ex && ex.last_consent?.improved === true && ex.last_consent?.fetched_at === '2026-10-13T09:00:00.000Z' && ex.last_consent?.mission_id === ma.mission_id, JSON.stringify(ex))
check('R2 example.com: last_modified present + dir path', !!ex && typeof ex.last_modified === 'string' && ex.dir === join(T, 'sessions', 'example.com'), JSON.stringify(ex))
check('R2 otherhost: attempted, NOT improved', !!oh && oh.last_consent?.improved === false && oh.last_consent?.mission_id === mb.mission_id, JSON.stringify(oh))
r = await dispatch('POST', P + '/sessions')
check('R2 sessions POST: 405', r.status === 405, JSON.stringify(r))

// --- R3: POST /missions/:id/stop (D-M6.3) --------------------------------------
r = await dispatch('POST', P + '/missions/' + ma.mission_id + '/stop')
check('R3 stop: 200 stopped, not already, manifest stop_reason echoed', r.status === 200 && r.body.status === 'stopped' && r.body.already_stopped === false && r.body.stop_reason === 'no reason given', JSON.stringify(r))
check('R3 stop: manifest status + footer in mission.md', readManifest(ma.mission_id).status === 'stopped' && readFileSync(join(T, '.dsh', 'web-missions', ma.mission_id, 'mission.md'), 'utf8').includes('— stopped: no reason given —'))
r = await dispatch('POST', P + '/missions/' + ma.mission_id + '/stop')
check('R3 stop again: already_stopped true', r.status === 200 && r.body.already_stopped === true && r.body.status === 'stopped', JSON.stringify(r))
r = await dispatch('POST', P + '/missions/' + mb.mission_id + '/stop', JSON.stringify({ reason: 'm6 smoke stop' }))
check('R3 stop with reason: stop_reason set + manifest', r.status === 200 && r.body.stop_reason === 'm6 smoke stop' && readManifest(mb.mission_id).stop_reason === 'm6 smoke stop', JSON.stringify(r))
r = await dispatch('POST', P + '/missions/m-deadbeef/stop')
check('R3 stop unknown id: 404 unknown_mission', r.status === 404 && /unknown_mission/.test(r.body.error), JSON.stringify(r))
r = await dispatch('POST', P + '/missions/m-deadbeef/other')
check('R3 POST non-stop suffix: 404 unknown_mission', r.status === 404 && /unknown_mission/.test(r.body.error), JSON.stringify(r))

// --- R4: POST /recents/clear (D7) ----------------------------------------------
r = await dispatch('GET', P + '/recents/clear')
check('R4 recents/clear GET: 405', r.status === 405, JSON.stringify(r))
r = await dispatch('POST', P + '/recents/clear')
check('R4 recents/clear: 200 cleared 2', r.status === 200 && r.body.ok === true && r.body.cleared === 2, JSON.stringify(r))
check('R4 mission dirs intact (forget the list, not the data)', existsSync(join(T, '.dsh', 'web-missions', ma.mission_id, 'manifest.json')) && existsSync(join(T, '.dsh', 'web-missions', mb.mission_id, 'manifest.json')))
r = await dispatch('GET', P + '/missions')
check('R4 list after clear: empty state', r.status === 200 && r.body.active?.length === 0 && r.body.recents?.length === 0, JSON.stringify(r))

// --- R5: POST /clear-all (D-M6.2) ----------------------------------------------
r = await dispatch('GET', P + '/clear-all')
check('R5 clear-all GET: 405', r.status === 405, JSON.stringify(r))
r = await dispatch('POST', P + '/clear-all', 'not json{')
check('R5 clear-all invalid JSON: 400 invalid_body', r.status === 400 && /invalid_body/.test(r.body.error), JSON.stringify(r))
r = await dispatch('POST', P + '/clear-all', JSON.stringify({ confirm: 'yes' }))
check('R5 clear-all confirm not true: 400 confirm_required', r.status === 400 && /confirm_required/.test(r.body.error), JSON.stringify(r))
r = await dispatch('POST', P + '/clear-all')
check('R5 clear-all empty body: 400 confirm_required', r.status === 400 && /confirm_required/.test(r.body.error), JSON.stringify(r))
r = await dispatch('POST', P + '/clear-all', JSON.stringify({ confirm: true }))
check('R5 clear-all: 200 with counts', r.status === 200 && r.body.ok === true && r.body.missions === 2 && r.body.index_rows === 0 && r.body.session_hosts === 2, JSON.stringify(r))
const missionDir = join(T, '.dsh', 'web-missions')
check('R5 mission dirs gone + index gone', !existsSync(join(missionDir, ma.mission_id)) && !existsSync(join(missionDir, mb.mission_id)) && !existsSync(join(missionDir, 'index.json')))
check('R5 session host dirs gone (root kept)', !existsSync(join(T, 'sessions', 'example.com')) && !existsSync(join(T, 'sessions', 'otherhost.example')) && existsSync(join(T, 'sessions')))
r = await dispatch('GET', P + '/sessions')
check('R5 sessions after wipe: empty', r.status === 200 && (r.body.sessions ?? []).length === 0, JSON.stringify(r))

// --- live cross-check (only with --live, :3090 on the new build) ---------------
if (LIVE) {
  const liveBase = 'http://127.0.0.1:3090'
  const h = await fetch(liveBase + '/api/web-missions/health')
  const hb = await h.json()
  check('LIVE health: 200 ok', h.status === 200 && hb.ok === true, JSON.stringify(hb))
  const s = await fetch(liveBase + '/api/web-missions/sessions')
  const sb = await s.json()
  check('LIVE sessions: 200 ok + sessions array (real dispatch)', s.status === 200 && sb.ok === true && Array.isArray(sb.sessions), JSON.stringify(sb).slice(0, 300))
  const throwaway = await byName.mission_start.execute({ note: 'M6 live smoke throwaway', budget: 1, cwd: repoRoot }, { })
  const stop = await fetch(liveBase + '/api/web-missions/missions/' + throwaway.mission_id + '/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'm6 live smoke' }),
  })
  const stopBody = await stop.json()
  check('LIVE stop (real prefix dispatch): 200 stopped', stop.status === 200 && stopBody.status === 'stopped' && stopBody.stop_reason === 'm6 live smoke', JSON.stringify(stopBody))
  const st = await fetch(liveBase + '/api/web-missions/missions/' + throwaway.mission_id)
  const stBody = await st.json()
  check('LIVE status shows stopped', st.status === 200 && stBody.status === 'stopped', JSON.stringify({ status: stBody.status }))
}

// --- cleanup + verdict ---------------------------------------------------------
process.env.BROWSER39_SESSIONS_DIR = ''
process.chdir(repoRoot)
rmSync(T, { recursive: true, force: true })
if (fail > 0) { console.error('M6 6.1 SMOKE: ' + fail + ' check(s) FAILED'); process.exit(1) }
console.log('M6 6.1 SMOKE: all checks passed' + (LIVE ? ' (incl. live :3090 cross-check)' : ''))
