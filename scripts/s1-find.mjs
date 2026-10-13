#!/usr/bin/env node
// M8 8.3 — S1 ritual step 3: model mission_find's for the Kurzprofil specifics
// INSTEAD of refetching (plan/M_8_smoke.md "The run", step 3). find never
// fetches — it reads the mission's stored chunks + link text. Run against the
// LIVE repo store (the S1 mission, newest active). No budget cost, no spawn.
// Usage: node scripts/s1-find.mjs
import { createRequire } from 'node:module'
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

const queries = [
  'Tagesgeld Zinsen Prozent p.a.',
  'Haftpflicht Versicherung Beitrag',
  'Beamte Beamtenanwärter Krankenversicherung',
  'Reiserücktritt Reiseabbruch Reisekrankenversicherung',
  'Girokonto kostenlos Kontoführung',
]

for (const q of queries) {
  const r = await byName.mission_find.execute({ query: q, limit: 4, cwd: repoRoot }, exec())
  console.log(`\n### find: "${q}"`)
  if (r.error) { console.log('  ERROR: ' + r.error); continue }
  console.log(`  best_match_url: ${r.best_match_url}`)
  for (const m of r.matches || []) {
    console.log(`  [${m.score?.toFixed(2)}] ${m.artifact_id} (d${m.depth}) ${m.url}\n      "${(m.snippet || '').slice(0, 200)}"`)
  }
}
console.log('\n(S1-find done — find read stored content only; 0 fetches, 0 budget)')
