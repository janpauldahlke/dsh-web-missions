#!/usr/bin/env node
// M8 8.4 — scripted DoD assertions A1/A2/A4/A5/A6 for the S1 smoke
// (plan/M_8_smoke.md "Acceptance assertions"). Reads the S1 mission's LEDGER
// (manifest.json) + its model-written mission.md + the frozen fixture, and
// asserts each named property. Read-only — no fetches, no spawns, no budget.
// A3 (zero-batch cache) is proven separately by scripts/accept-cache.mjs
// (the M3-built formal DoD check) + a targeted S1 re-fetch below.
//
// Usage: node scripts/check-s1-dod.mjs [mission_id]   (default: newest S1)
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(process.cwd())
const MISSION = process.argv[2] || 'm-3808dcd8'
const dir = join(repoRoot, '.dsh', 'web-missions', MISSION)
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
const missionMd = readFileSync(join(dir, 'mission.md'), 'utf8')
const fixture = JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'partner-daten.json'), 'utf8'))
const entities = fixture.entities

// --- helpers -------------------------------------------------------------------
const norm = (u) => u.toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
const host = (u) => norm(u).split('/')[0]
const rows = manifest.fetched || []
const byArtifact = Object.fromEntries(rows.map((r) => [r.artifact_id, r]))
// entity → its ledger row, by matching the entity homepage (requested) against
// the row's requested_keys (pre-redirect), then falling back to host.
function rowForEntity(e) {
  const home = e.urls[0]
  const homeKey = norm(home)
  const homeHost = host(home)
  return rows.find((r) =>
    (r.requested_keys || []).some((k) => norm(k) === homeKey) ||
    (r.requested_keys || []).some((k) => host(k) === homeHost) ||
    host(r.url) === homeHost
  ) || null
}
// markdown-link source citations [p-…](url) — the ACTUAL sources (the ledger
// table + thin note reference p-… as plain text, intentionally NOT a source).
const mdCites = [...missionMd.matchAll(/\[(p-[a-f0-9]{6,})\]\([^)]*\)/g)].map((m) => m[1])
// per-entity sections (### headings, matched by the fixture's verbatim name)
const sections = []
{
  const lines = missionMd.split('\n')
  let cur = null
  for (const ln of lines) {
    if (ln.startsWith('### ')) { if (cur) sections.push(cur); cur = { heading: ln.slice(4).trim(), body: '' } }
    else if (cur) cur.body += ln + '\n'
  }
  if (cur) sections.push(cur)
}
const sectionFor = (e) => sections.find((s) => s.heading.includes(e.name)) || null

let fail = 0
const check = (label, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + label + (detail && !cond ? '  ::  ' + detail : '')); if (!cond) fail++ }

console.log(`\nS1 DoD assertions — mission ${MISSION} (${rows.length} rows, ${entities.length} entities)\n`)

// --- A1: ≥8/10 entities have a stored `full` page ---------------------------------
{
  const per = entities.map((e) => { const r = rowForEntity(e); return { name: e.name, quality: r ? r.quality : 'missing' } })
  const full = per.filter((p) => p.quality === 'full').length
  for (const p of per) console.log(`    ${p.quality.padEnd(8)} ${p.name}`)
  check(`A1: ≥8/10 entities have a stored full page`, full >= 8, `full=${full}/10`)
}

// --- A2: no Kurzprofil cites a thin/blocked page as its source -------------------
{
  const bad = mdCites.filter((a) => byArtifact[a] && byArtifact[a].quality !== 'full')
  const unknown = mdCites.filter((a) => !byArtifact[a])
  check('A2: every source citation resolves to a ledger artifact', unknown.length === 0, `unresolved=${JSON.stringify(unknown)}`)
  check('A2: no thin/blocked page cited as a source', bad.length === 0, `bad=${JSON.stringify(bad.map((a) => [a, byArtifact[a]?.quality]))}`)
  console.log(`    ${mdCites.length} markdown-link source citations; all ${mdCites.length === bad.length + unknown.length ? 'full' : '—'}`)
}

// --- A4: no refetch loops --------------------------------------------------------
{
  // (a) ≤1 non-forced row per normalized URL
  const nonForced = rows.filter((r) => r.forced !== true)
  const seen = new Set()
  const dups = []
  for (const r of nonForced) { if (seen.has(r.normalized_url)) dups.push(r.normalized_url); seen.add(r.normalized_url) }
  check('A4a: ≤1 non-forced row per normalized URL', dups.length === 0, `dups=${JSON.stringify(dups)}`)
  // (b) total fetch-call (budget-charged) batches ≤ budget max (consent batches
  //     are extra browser39 invocations but never count against budget)
  const charged = rows.filter((r) => r.budget_charged === true).length
  check(`A4b: fetch-call batches (${charged}) ≤ budget (${manifest.budget.max})`, charged <= manifest.budget.max, `charged=${charged} max=${manifest.budget.max}`)
  const forcedCount = rows.filter((r) => r.forced === true).length
  console.log(`    rows=${rows.length} forced=${forcedCount} consent_attempted=${rows.filter((r) => r.consent_attempted).length}`)
}

// --- A5: budget never exhausted (or exhaustion handled cleanly) ------------------
{
  const { max, spent } = manifest.budget
  const cleanStop = manifest.status === 'stopped' && manifest.stop_reason && !/budget/i.test(manifest.stop_reason)
  const exhausted = spent >= max
  const pass = spent <= max && (!exhausted || cleanStop)
  check('A5: budget not overrun AND (not exhausted OR clean explicit stop)', pass, `spent=${spent} max=${max} status=${manifest.status} stop_reason=${manifest.stop_reason}`)
  console.log(`    spent ${spent}/${max}${exhausted ? ' (exactly exhausted) — ' + (cleanStop ? 'handled cleanly (explicit stop, not budget_exhausted)' : 'NOT clean') : ' (not exhausted)'}`)
}

// --- A6: per-entity blocks + citations for all A1 entities -----------------------
{
  const missingSection = entities.filter((e) => !sectionFor(e)).map((e) => e.name)
  check('A6a: mission.md has a section per entity (10)', missingSection.length === 0, `missing=${JSON.stringify(missingSection)}`)
  const a1 = entities.filter((e) => { const r = rowForEntity(e); return r && r.quality === 'full' })
  const noCite = a1.filter((e) => { const s = sectionFor(e); return !s || !/\[p-[a-f0-9]{6,}\]\([^)]*\)/.test(s.body) }).map((e) => e.name)
  check(`A6b: every A1 (${a1.length}) entity's section has ≥1 p-… source citation`, noCite.length === 0, `no_citation=${JSON.stringify(noCite)}`)
}

console.log(fail === 0 ? `\nS1 DoD A1/A2/A4/A5/A6: ALL GREEN` : `\nS1 DoD: ${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)
