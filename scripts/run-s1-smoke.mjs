#!/usr/bin/env node
// M8 8.3 — S1 Kurzprofile run driver (model-driven ritual, step 1: fetch).
// Runs the BUILT lib's tools IN-PROCESS against the LIVE repo store
// (cwd = repo root), exactly like the operator's :3090 board would.
//
// Ritual (plan/M_8_smoke.md "The run"):
//   1. mission_start  note 'aggregiere PartnerDaten: Kurzprofile 10 Partner',
//      budget 10, ALL 15 fixture URLs as seeds (depth 0, host-exempt).
//   2. Fetch each entity's homepage (urls[0]) — one fetch call each = exactly
//      budget 10. Capture the receipt (page_quality, artifact_id, preview,
//      sample_links, budget, visited_count, error).
//
// It does NOT stop the mission — the model then mission_find's for specifics
// (step 2 driver) and writes mission.md (step 3) before stopping (step 4).
// Receipts are dumped to /tmp/s1-receipts.json + a table printed to stdout.
//
// Usage: node scripts/run-s1-smoke.mjs
import { createRequire } from 'node:module'
import { writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const repoRoot = resolve(process.cwd())
const req = createRequire(join(repoRoot, 'noop.js'))
const lib = req(join(repoRoot, 'lib', 'index.js'))

const tools = []
lib.apply({
  tools: { register: (def) => { tools.push(def); return () => {} } },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
})
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
const exec = () => ({})

const fixture = JSON.parse(readFileSync(join(repoRoot, 'fixtures', 'partner-daten.json'), 'utf8'))
const entities = fixture.entities
const allSeeds = entities.flatMap((e) => e.urls)
console.log(`fixture: ${entities.length} entities, ${allSeeds.length} seed URLs`)

const results = []
try {
  const m = await byName.mission_start.execute({
    note: 'aggregiere PartnerDaten: Kurzprofile 10 Partner',
    budget: 10,
    seeds: allSeeds,
    cwd: repoRoot,
  }, exec())
  if (!m.mission_id || m.error) { console.error('FATAL: start failed', JSON.stringify(m)); process.exit(2) }
  const mid = m.mission_id
  console.log(`started ${mid} budget ${JSON.stringify(m.budget)} seeds ${allSeeds.length}\n`)

  for (const e of entities) {
    const url = e.urls[0] // homepage
    const r = await byName.mission_fetch.execute({ url, mission_id: mid, cwd: repoRoot }, exec())
    const rec = {
      entity: e.id,
      name: e.name,
      type: e.type,
      requested: url,
      artifact_id: r.artifact_id ?? null,
      final_url: r.final_url ?? r.url ?? null,
      page_quality: r.page_quality ?? null,
      chunk_count: r.chunk_count ?? null,
      preview_head: r.preview_head ?? null,
      sample_links: r.sample_links ?? [],
      depth: r.depth ?? null,
      budget_spent: r.budget ? r.budget.spent : null,
      budget_remaining: r.budget ? r.budget.remaining : null,
      visited_count: r.visited_count ?? null,
      error: r.error ?? null,
    }
    results.push(rec)
    const q = rec.error ? `ERR ${rec.error}` : `quality=${rec.page_quality} chunks=${rec.chunk_count} art=${rec.artifact_id} spent=${rec.budget_spent}`
    console.log(`[${rec.entity}] ${rec.requested}\n    -> ${q}\n    final=${rec.final_url}\n    preview=${(rec.preview_head || '').slice(0, 160)}\n`)
  }
} catch (err) {
  console.error('FATAL: ' + (err && err.stack ? err.stack : err))
  process.exit(3)
} finally {
  writeFileSync('/tmp/s1-receipts.json', JSON.stringify({ results }, null, 2))
}

const ok = results.filter((r) => !r.error)
const full = results.filter((r) => r.page_quality === 'full')
const thin = results.filter((r) => r.page_quality === 'thin')
const blocked = results.filter((r) => r.page_quality === 'blocked')
const errs = results.filter((r) => r.error)
console.log('=== SUMMARY ===')
console.log(`fetched ${results.length} | ok ${ok.length} | full ${full.length} | thin ${thin.length} | blocked ${blocked.length} | errors ${errs.length}`)
console.log(`A1 (>=8 full): ${full.length >= 8 ? 'PASS' : 'CHECK'} (${full.length}/10)`)
console.log('receipts -> /tmp/s1-receipts.json')
process.exit(errs.length > 0 ? 1 : 0)
