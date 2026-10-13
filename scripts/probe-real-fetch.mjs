#!/usr/bin/env node
// M8 8.2 de-risk / 8.3 prep — isolated real-fetch probe.
// Runs the BUILT plugin lib's tools IN-PROCESS against a throwaway temp root
// (never the live repo store, so the operator's M6 V8 fixtures stay clean).
// The temp root gets the SAME 11-host allowlist as the live .dsh/allowlist.txt.
// Proves end-to-end: real browser39 spawn is admitted for a fixture host and
// refused (zero-spawn, zero-budget) for a non-fixture host.
// Usage: node scripts/probe-real-fetch.mjs
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
for (const need of ['mission_start', 'mission_fetch', 'mission_stop']) {
  if (!byName[need]) { console.error('FATAL: missing tool ' + need); process.exit(2) }
}

// throwaway root + the SAME allowlist the live server now uses
const root = mkdtempSync(join(tmpdir(), 'm82-probe-'))
mkdirSync(join(root, '.dsh'), { recursive: true })
copyFileSync(join(repoRoot, '.dsh', 'allowlist.txt'), join(root, '.dsh', 'allowlist.txt'))
const allow = readFileSync(join(root, '.dsh', 'allowlist.txt'), 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#'))
console.log('allowlist hosts (' + allow.length + '): ' + allow.join(' '))

let fail = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'OK  ' : 'FAIL ') + label + (detail ? '  :: ' + detail : ''))
  if (!cond) fail++
}

try {
  const m = await byName.mission_start.execute({ note: 'M8 8.2 real-fetch probe', budget: 3, cwd: root }, exec())
  if (!m.mission_id || m.error) { console.error('FATAL: start failed', JSON.stringify(m)); process.exit(2) }
  console.log('mission ' + m.mission_id + ' budget ' + JSON.stringify(m.budget))

  // 1) FIXTURE host — real browser39 spawn, admitted
  const ok1 = await byName.mission_fetch.execute({ mission_id: m.mission_id, url: 'https://www.dkb.de/', cwd: root }, exec())
  console.log('fixture fetch -> ' + JSON.stringify(ok1).slice(0, 240))
  check('fixture host admitted (real fetch ok)', ok1.error === undefined, ok1.error || 'no error (success)')
  check('fixture fetch produced artifact_id', typeof ok1.artifact_id === 'string' && ok1.artifact_id.length > 0, 'artifact_id=' + ok1.artifact_id)

  // 2) NON-FIXTURE host — denied pre-spawn, zero budget
  const b0 = m.budget ? m.budget.spent : 0
  const bad = await byName.mission_fetch.execute({ mission_id: m.mission_id, url: 'https://duckduckgo.com/html/?q=test', cwd: root }, exec())
  console.log('denied fetch  -> ' + JSON.stringify(bad).slice(0, 240))
  check('non-fixture host denied', bad.ok === false && /allowlist_denied/.test(bad.error || ''), bad.error || 'ok=' + bad.ok)

  // budget: only the admitted fetch costs 1
  const st = await byName.mission_status.execute({ mission_id: m.mission_id, cwd: root }, exec())
  const spent = st.budget ? st.budget.spent : null
  check('budget: 1 spent (admitted only), denied was free', spent === 1, 'spent=' + spent)
  check('denied fetch added no page (1 visited = the fixture)', (st.visited || []).length === 1, 'visited=' + (st.visited || []).length)

  byName.mission_stop.execute({ mission_id: m.mission_id, reason: 'probe complete', cwd: root }, exec())
  console.log(fail === 0 ? '\nM8 8.2 REAL-FETCH PROBE: PASS' : '\nM8 8.2 REAL-FETCH PROBE: ' + fail + ' FAILURES')
} catch (e) {
  console.error('FATAL: ' + (e && e.stack ? e.stack : e))
  process.exitCode = 3
} finally {
  rmSync(root, { recursive: true, force: true })
}
process.exit(process.exitCode ?? (fail ? 1 : 0))
