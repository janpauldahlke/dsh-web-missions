// M6 acceptance (slice 6.5): V1–V6 per plan/M_6_pane.md, run mechanically
// against the live :3090 (repo cwd = the store root the live routes serve) +
// on-disk fixture seeding. V7's browser half (client HMR + hard refresh) and
// V8 (operator pass) need a human — everything else is the mechanical half.
//
// Layout:
//   Seed  F1 active (budget max 5 / spent 3 → remaining 2) with 3 visited
//         rows (full today; thin + improved 1d; thin + attempted + NOT
//         improved 2d) and F2 stopped — "2 missions on disk" (V1) with the
//         hint-condition row present (V6)
//   V1    GET /missions lists both; GET /missions/F1 → 3 visited rows with
//         correct qualities, consent flags, artifact ids, parseable ages
//   V2    budget line data: remaining 2 / max 5 in the list + detail payloads
//   V6    the exact hint condition (thin && attempted && !improved) holds for
//         the first matching row in F1 (the pane shows the exact line —
//         proven by the render smoke); F2 carries no such row (disappears)
//   V3    POST /missions/F1/stop → manifest status 'stopped' on disk,
//         mission.md gains the footer, GET /missions lists it stopped
//         (the board's next poll sees it)
//   V4    POST /recents/clear → index.json empty, mission dirs intact,
//         board source empty (active + recents)
//   V5    POST /clear-all {confirm:false} → 400 confirm_required, store
//         untouched; {confirm:true} → mission dirs gone,
//         ~/.dsh/browser39/sessions empty, /sessions empty
//   V7m   the built client bundle carries the poller dispose + visibility
//         wiring (the HMR/hard-refresh browser half is the operator's)
//   Leave  re-seed the two fixtures so the operator's morning pass (V8) sees
//         a populated board, exactly V1's "2 missions on disk"
//
// Live routes are tokenless (plugin prefix). Exit 0 iff every check passes.
// Never touches :3080/:8080.
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const STORE = join(root, '.dsh', 'web-missions')
const INDEX = join(STORE, 'index.json')
const SESSIONS = join(homedir(), '.dsh', 'browser39', 'sessions')
const BASE = 'http://127.0.0.1:3090/api/web-missions'

const F1 = 'm-6a111111'
const F2 = 'm-6b222222'
const now = Date.now()
const iso = (msAgo = 0) => new Date(now - msAgo).toISOString()
const day = 86_400_000

let fail = 0
let pass = 0
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + label) }
  else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) }
}
const J = (v) => JSON.stringify(v)

// --- fixture seeding -------------------------------------------------------------
const row = (over) => ({
  normalized_url: 'https://example.com/',
  url: 'https://example.com/',
  artifact_id: 'p-aaaa0001',
  quality: 'full',
  fetched_at: iso(),
  consent_attempted: false,
  consent_improved: false,
  requested_keys: ['https://example.com/'],
  budget_charged: true,
  depth: 0,
  parent_artifact_id: null,
  ...over,
})
const f1Rows = [
  row({ fetched_at: iso(0) }),
  row({
    normalized_url: 'https://thinhost.example/p', url: 'https://thinhost.example/p',
    artifact_id: 'p-aaaa0002', quality: 'thin', fetched_at: iso(day),
    consent_attempted: true, consent_improved: true,
    requested_keys: ['https://thinhost.example/p'],
  }),
  row({
    normalized_url: 'https://thinhost.example/q', url: 'https://thinhost.example/q',
    artifact_id: 'p-aaaa0003', quality: 'thin', fetched_at: iso(2 * day),
    consent_attempted: true, consent_improved: false,
    requested_keys: ['https://thinhost.example/q'],
  }),
]

function seedFixtures() {
  for (const [id, status, rows, note] of [
    [F1, 'active', f1Rows, 'M6 V-verify fixture — active'],
    [F2, 'stopped', [], 'M6 V-verify fixture — stopped'],
  ]) {
    const dir = join(STORE, id)
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
    const manifest = {
      mission_id: id,
      note,
      budget: { max: 5, spent: 3 },
      status,
      created_at: iso(),
      updated_at: iso(),
      ...(status === 'stopped' ? { stop_reason: 'fixture' } : {}),
      fetched: rows,
    }
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    for (const r of rows) {
      const pdir = join(dir, 'pages', r.artifact_id)
      mkdirSync(join(pdir, 'chunks'), { recursive: true })
      writeFileSync(join(pdir, 'page.json'), JSON.stringify({
        url: r.url, finalUrl: r.url, status: 200, contentType: 'text/html',
        title: r.url, content: 'fixture', links: [], byteLength: 7,
        fetchedAt: r.fetched_at, quality: r.quality, qualitySignals: [],
        consentAttempted: r.consent_attempted, consentImproved: r.consent_improved,
        artifact_id: r.artifact_id, mission_id: id, normalized_url: r.normalized_url,
        stored_at: r.fetched_at, depth: r.depth,
      }, null, 2) + '\n')
    }
    const md = status === 'active'
      ? `# Mission: ${note}\n\n_status: active_\n\n## Sources\n`
      : `# Mission: ${note}\n\n_status: stopped_\n\n## Sources\n\n— stopped: fixture —\n`
    writeFileSync(join(dir, 'mission.md'), md)
  }
  let rows = []
  try { rows = JSON.parse(readFileSync(INDEX, 'utf8')) } catch { /* no index yet */ }
  rows = [
    { mission_id: F1, note: 'M6 V-verify fixture — active', status: 'active', started_at: iso(), updated_at: iso() },
    { mission_id: F2, note: 'M6 V-verify fixture — stopped', status: 'stopped', started_at: iso(day), updated_at: iso(day) },
    ...rows.filter((r) => r.mission_id !== F1 && r.mission_id !== F2),
  ]
  writeFileSync(INDEX, JSON.stringify(rows, null, 2) + '\n')
}
seedFixtures()

// --- live: health ----------------------------------------------------------------
const health = await (await fetch(BASE + '/health')).json()
check('live: :3090 health ok', health.ok === true, J(health))

// --- V1: 2 missions on disk → board + detail -------------------------------------
const list = await (await fetch(BASE + '/missions')).json()
check('V1: board lists F1 (active)', list.active.some((m) => m.mission_id === F1), J(list.active))
check('V1: board lists F2 (recents, stopped)', list.recents.some((m) => m.mission_id === F2 && m.status === 'stopped'), J(list.recents))
const d1 = await (await fetch(BASE + '/missions/' + F1)).json()
check('V1: detail has 3 visited rows', d1.visited?.length === 3, J(d1.visited?.length))
check('V1: qualities full/thin/thin', d1.visited?.map((r) => r.quality).join(',') === 'full,thin,thin', J(d1.visited?.map((r) => r.quality)))
check('V1: artifact ids carried (full id in payload)', d1.visited?.map((r) => r.artifact_id).join(',') === 'p-aaaa0001,p-aaaa0002,p-aaaa0003')
check('V1: fetched_at parseable, strictly older', Number.isFinite(Date.parse(d1.visited?.[0]?.fetched_at)) && Date.parse(d1.visited[0].fetched_at) > Date.parse(d1.visited[1].fetched_at) && Date.parse(d1.visited[1].fetched_at) > Date.parse(d1.visited[2].fetched_at))
const d2 = await (await fetch(BASE + '/missions/' + F2)).json()
check('V1: F2 detail stopped + no visited', d2.status === 'stopped' && (d2.visited?.length ?? 0) === 0, J({ status: d2.status, n: d2.visited?.length }))

// --- V2: budget line data (remaining/max matches manifest) ------------------------
check('V2: list row budget remaining 2 / max 5', (() => {
  const b = list.active.find((m) => m.mission_id === F1)?.budget
  return b?.max === 5 && b?.remaining === 2 && b?.unit === 'fetch_calls'
})(), J(list.active.find((m) => m.mission_id === F1)))
check('V2: detail budget view matches manifest', d1.budget?.max === 5 && d1.budget?.spent === 3 && d1.budget?.remaining === 2, J(d1.budget))

// --- V6: hint condition (data level) -----------------------------------------------
const hintRows = d1.visited?.filter((r) => r.quality === 'thin' && r.consent_attempted === true && r.consent_improved === false)
check('V6: exactly one hint-condition row (first = 2d row)', hintRows?.length === 1 && hintRows[0].artifact_id === 'p-aaaa0003', J(hintRows))
check('V6: improved row does not trigger (attempted + improved)', d1.visited?.[1]?.consent_attempted === true && d1.visited?.[1]?.consent_improved === true)
check('V6: F2 has no hint-condition row (disappears)', (d2.visited?.filter((r) => r.quality === 'thin' && r.consent_attempted && !r.consent_improved).length ?? 0) === 0)
check('V6: hint host derives to thinhost.example (port-stripped, lowercased)', hintRows?.[0] && new URL(hintRows[0].url).hostname.toLowerCase() === 'thinhost.example', J(hintRows?.[0]?.url))

// --- V3: stop → manifest + footer + board (next poll) ------------------------------
const stopRes = await fetch(BASE + '/missions/' + F1 + '/stop', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ reason: 'M6 V3 check' }),
})
const stopBody = await stopRes.json()
check('V3: stop accepted', stopRes.status === 200 && stopBody.ok !== false && stopBody.status === 'stopped', stopRes.status + ' ' + J(stopBody))
const f1Manifest = JSON.parse(readFileSync(join(STORE, F1, 'manifest.json'), 'utf8'))
check('V3: manifest status stopped + reason', f1Manifest.status === 'stopped' && f1Manifest.stop_reason === 'M6 V3 check', J({ s: f1Manifest.status, r: f1Manifest.stop_reason }))
const f1Md = readFileSync(join(STORE, F1, 'mission.md'), 'utf8')
check('V3: mission.md footer appended', f1Md.includes('— stopped: M6 V3 check —'), f1Md.slice(-120))
const listAfterStop = await (await fetch(BASE + '/missions')).json()
check('V3: board source now lists F1 stopped (next poll shows it)', !listAfterStop.active.some((m) => m.mission_id === F1) && listAfterStop.recents.some((m) => m.mission_id === F1 && m.status === 'stopped'), J(listAfterStop))

// --- V4: clear recents → index empty, dirs intact, board empty ---------------------
const dirsBefore = readdirSync(STORE).filter((n) => /^m-[0-9a-f]{8}$/.test(n))
const clearRes = await fetch(BASE + '/recents/clear', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({}),
})
check('V4: clear recents accepted', clearRes.status === 200, clearRes.status + ' ' + J(await clearRes.clone().json()))
const indexAfter = JSON.parse(readFileSync(INDEX, 'utf8'))
check('V4: index.json empty', Array.isArray(indexAfter) && indexAfter.length === 0, J(indexAfter))
const dirsAfter = readdirSync(STORE).filter((n) => /^m-[0-9a-f]{8}$/.test(n))
check('V4: mission dirs intact (count unchanged)', dirsAfter.length === dirsBefore.length && dirsBefore.every((n) => dirsAfter.includes(n)), J({ before: dirsBefore.length, after: dirsAfter.length }))
const listAfterClear = await (await fetch(BASE + '/missions')).json()
check('V4: board source empty (active + recents) → empty state', listAfterClear.active?.length === 0 && listAfterClear.recents?.length === 0, J(listAfterClear))

// --- V5: clear all (gate + wipe) ----------------------------------------------------
const gateRes = await fetch(BASE + '/clear-all', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ confirm: false }),
})
check('V5: gate refuses without confirm:true (400)', gateRes.status === 400, gateRes.status + ' ' + J(await gateRes.json()))
const dirsGate = readdirSync(STORE).filter((n) => /^m-[0-9a-f]{8}$/.test(n))
check('V5: refused clear-all left store untouched', dirsGate.length === dirsBefore.length, J({ before: dirsBefore.length, gate: dirsGate.length }))
const wipeRes = await fetch(BASE + '/clear-all', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ confirm: true }),
})
const wipeBody = await wipeRes.json()
check('V5: clear all accepted', wipeRes.status === 200 && wipeBody.ok === true, wipeRes.status + ' ' + J(wipeBody))
const dirsWiped = readdirSync(STORE).filter((n) => /^m-[0-9a-f]{8}$/.test(n))
check('V5: mission dirs gone', dirsWiped.length === 0, J(dirsWiped))
const sessionsLeft = existsSync(SESSIONS) ? readdirSync(SESSIONS).filter((n) => !n.startsWith('.')) : []
check('V5: ~/.dsh/browser39/sessions empty', sessionsLeft.length === 0, J(sessionsLeft))
const sessions = await (await fetch(BASE + '/sessions')).json()
const sessionList = Array.isArray(sessions) ? sessions : sessions.hosts ?? []
check('V5: /sessions empty after wipe', sessionList.length === 0, J(sessions))

// --- V7 (mechanical): bundle carries the 6.4 poller wiring --------------------------
const bundle = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
check('V7m: built client bundle carries visibilitychange + interval teardown',
  bundle.includes('visibilitychange') && bundle.includes('clearInterval'))
check('V7m: registration/dispose path present (no duplicate tabs on reload)',
  bundle.includes('sidebarRightTabs') && bundle.includes('dispose'))

// --- leave: re-seed for the operator's morning pass (V8) ----------------------------
seedFixtures()
const listLeft = await (await fetch(BASE + '/missions')).json()
check('leave: board re-seeded (F1 active + F2 stopped) for the V8 pass',
  listLeft.active.some((m) => m.mission_id === F1) && listLeft.recents.some((m) => m.mission_id === F2), J(listLeft))

// --- verdict -----------------------------------------------------------------------
if (fail > 0) { console.error('M6 ACCEPTANCE: ' + fail + ' check(s) FAILED'); process.exit(1) }
console.log('M6 ACCEPTANCE: all checks passed (' + pass + ' checks) — V7 browser half + V8 operator pass remain (plan/M_6_pane.md)')
