#!/usr/bin/env node
// M8 8.5 — S2 news dig + S3 chart snapshot driver (secondary smoke, "nice while the
// machine is warm"). Runs the BUILT lib's tools IN-PROCESS against the LIVE repo
// store (cwd = repo root), exactly like the operator's :3090 board would.
//
// S2 (news dig, model-owned outcome: depth + citations):
//   - seed the DKB homepage (depth 0, host-exempt) so its stored links.json is the
//     lineage source, then fetch the two DKB news surfaces AS DISCOVERED LINKS:
//       * dkb.de/presse                                          -> depth 1
//       * dkb.de/finanzwissen/finanznews-oktober?wt_mc=...        -> depth 1
//     (The exact stored link URLs are used because v0 normalizeUrl KEEPS tracking
//     params — a param-less fetch would not match the stored link and would be a
//     fresh root, not depth 1.)
// S3 (chart/data snapshot, fixture OK, no parsing):
//   - seed + fetch the ING Zinsspiegel (ing-diba.de/zinsen/) — a rates-mirror
//     data page, stored as an artifact (no chart parsing).
//
// Budget 5, 4 fetches (1 headroom -> clean non-exhausted stop). Does NOT stop the
// mission — the model then writes mission.md (S2 digest + S3 note, with [p-...](url)
// citations) and stops via scripts/stop-s2s3.mjs. Receipts -> /tmp/s2s3-receipts.json,
// mission id -> /tmp/s2s3-mission.json.
//
// Usage: node scripts/run-s2s3-smoke.mjs
import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
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

// Exact URLs. Seeds (depth 0, host-exempt) first; discovered news links must be the
// EXACT stored link URLs (tracking param kept) to match the DKB homepage lineage.
const SEEDS = [
  'https://www.dkb.de/',
  'https://www.ing-diba.de/zinsen/',
]
const FETCHES = [
  { tag: 'S1-dkb-home', url: 'https://www.dkb.de/' },
  { tag: 'S2-dkb-presse', url: 'https://www.dkb.de/presse' },
  { tag: 'S2-dkb-finanznews', url: 'https://www.dkb.de/finanzwissen/finanznews-oktober?wt_mc=pk.fw_hp_st_okt' },
  { tag: 'S3-ing-zinsen', url: 'https://www.ing-diba.de/zinsen/' },
]
const BUDGET = 5

const results = []
try {
  const m = await byName.mission_start.execute({
    note: 'aggregiere PartnerDaten: S2 News-Digest (DKB) + S3 Zinsspiegel (ING)',
    budget: BUDGET,
    seeds: SEEDS,
    cwd: repoRoot,
  }, exec())
  if (!m.mission_id || m.error) { console.error('FATAL: start failed', JSON.stringify(m)); process.exit(2) }
  const mid = m.mission_id
  writeFileSync('/tmp/s2s3-mission.json', JSON.stringify({ mission_id: mid, budget: m.budget }, null, 2))
  console.log(`started ${mid} budget ${JSON.stringify(m.budget)} seeds ${SEEDS.length}\n`)

  for (const f of FETCHES) {
    const r = await byName.mission_fetch.execute({ url: f.url, mission_id: mid, cwd: repoRoot }, exec())
    const rec = {
      tag: f.tag,
      requested: f.url,
      artifact_id: r.artifact_id ?? null,
      final_url: r.final_url ?? r.url ?? null,
      normalized_url: r.normalized_url ?? null,
      page_quality: r.page_quality ?? null,
      chunk_count: r.chunk_count ?? null,
      depth: r.depth ?? null,
      parent_artifact_id: r.parent_artifact_id ?? null,
      budget: r.budget ?? null,
      cached: r.cached ?? null,
      preview_head: r.preview_head ?? null,
      error: r.error ?? null,
    }
    results.push(rec)
    const q = rec.error
      ? `ERR ${rec.error}`
      : `quality=${rec.page_quality} depth=${rec.depth} art=${rec.artifact_id} cached=${rec.cached} spent=${rec.budget ? rec.budget.spent : '?'}`
    console.log(`[${rec.tag}] ${rec.requested}\n    -> ${q}\n    final=${rec.final_url}\n    preview=${(rec.preview_head || '').slice(0, 150)}\n`)
  }
} catch (err) {
  console.error('FATAL: ' + (err && err.stack ? err.stack : err))
  process.exit(3)
} finally {
  writeFileSync('/tmp/s2s3-receipts.json', JSON.stringify({ results }, null, 2))
}

const ok = results.filter((r) => !r.error)
const full = results.filter((r) => r.page_quality === 'full')
const thin = results.filter((r) => r.page_quality === 'thin')
const blocked = results.filter((r) => r.page_quality === 'blocked')
const errs = results.filter((r) => r.error)
const depth1 = results.filter((r) => r.depth === 1)
console.log('=== SUMMARY ===')
console.log(`fetched ${results.length} | ok ${ok.length} | full ${full.length} | thin ${thin.length} | blocked ${blocked.length} | errors ${errs.length}`)
console.log(`S2 depth-1 discovered news fetches: ${depth1.length} (expect 2)`)
const last = results[results.length - 1]
console.log(`final budget: ${JSON.stringify(last && last.budget)}`)
console.log('receipts -> /tmp/s2s3-receipts.json | mission -> /tmp/s2s3-mission.json')
process.exit(errs.length > 0 ? 1 : 0)
