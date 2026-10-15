#!/usr/bin/env node
/**
 * Refactor 4 hermetic smoke — conclusion gate, XOR board, host cooldown,
 * empty JSON quality, verify 0-cites, budget wrap hint, goal amend.
 * No browser39 / no :3090 required.
 */
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const abs = (p) => join(here, p).split(/[\\/]/).join('/')

const harness = `
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  startMission,
  stopMission,
  listMissions,
  missionStatus,
  amendMissionGoal,
  missionMdPath,
  StoreError,
  PANE_CONCLUSION_STUB,
  conclusionLooksStructured,
  CONCLUSION_SHORT_MAX,
} from '${abs('../src/host/store.ts')}'
import { assessQuality, emptyJsonSignal } from '${abs('../src/host/fetcher.ts')}'
import {
  hostOnCooldown,
  isNonRetriable,
  recordHostOutcome,
  liftHostCooldown,
} from '${abs('../src/host/host-cooldown.ts')}'
import { checkMissionClaims } from '${abs('../src/host/claims.ts')}'
import { runFetch } from '${abs('../src/host/fetch-service.ts')}'
import { writeHostCooldowns } from '${abs('../src/host/store.ts')}'

let fail = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label + (detail && !cond ? '  ::  ' + detail : ''))
  if (!cond) fail++
}

const root = join(mkdtempSync(join('/tmp', 'smoke-r4-')), 'wm')
mkdirSync(root, { recursive: true })
writeFileSync(join(root, 'config.json'), JSON.stringify({
  allowlist: 'off',
  hostCooldownK: 2,
  hostCooldownLiftAfterM: 2,
  defaultFetchBudget: 5,
}))

// --- R4.9 empty JSON ---------------------------------------------------------
check('emptyJson: {}', emptyJsonSignal('{}') === 'empty_json')
check('emptyJson: []', emptyJsonSignal('[]') === 'zero_hits')
check('emptyJson: results empty', emptyJsonSignal(JSON.stringify({ results: [] })) === 'zero_hits')
check('emptyJson: real object null', emptyJsonSignal(JSON.stringify({ a: 1 })) === null)
const eq = assessQuality({ status: 200, title: 'API', content: '{}', thinThresholdChars: 300 })
check('assess: empty JSON → thin+empty_json', eq.quality === 'thin' && eq.qualitySignals.includes('empty_json'), JSON.stringify(eq))
const maint = assessQuality({
  status: 200,
  title: 'Site Maintenance',
  content: 'Cloudflare Site Maintenance — be right back. ' + 'x'.repeat(400),
  thinThresholdChars: 300,
})
check('assess: CF maintenance → thin+site_maintenance', maint.quality === 'thin' && maint.qualitySignals.includes('site_maintenance'), JSON.stringify(maint))
check('nonRetriable: maintenance', isNonRetriable(maint.quality, maint.qualitySignals) === true)

// --- R4.1 XOR + R4.3 conclusion ----------------------------------------------
const a = startMission(root, { note: 'alpha', budget: 3 })
const b = startMission(root, { note: 'beta', budget: 3 })
let list = listMissions(root)
check('XOR: 2 active', list.active.length === 2)
check('XOR: 0 recents while both active', list.recents.length === 0)

try {
  stopMission(root, a.mission_id, { reason: 'no conclusion test' })
  check('stop without conclusion throws', false)
} catch (e) {
  check('stop without conclusion → conclusion_required', e instanceof StoreError && e.code === 'conclusion_required', String(e))
}

check('structured: short OK', conclusionLooksStructured('Alpha answer: 42'))
check('structured: two sentences OK', conclusionLooksStructured('First point. Second point.'))
check(
  'structured: three sentences under cap still need bullets',
  !conclusionLooksStructured('One. Two. Three more words here for density.'),
)
check('structured: heading OK', conclusionLooksStructured('### Answer\\n- **x:** y'))
check(
  'structured: wall rejected',
  !conclusionLooksStructured('x'.repeat(CONCLUSION_SHORT_MAX + 40)),
)

const wall = Array(80).fill('word').join(' ') + ' end.'
try {
  stopMission(root, a.mission_id, { reason: 'wall', conclusion: wall })
  check('stop wall throws', false)
} catch (e) {
  check(
    'stop wall → conclusion_format',
    e instanceof StoreError && e.code === 'conclusion_format' && String(e).includes('### Answer'),
    String(e).slice(0, 160),
  )
}

const structured =
  '### Answer\\n- **Alpha:** 42 [p-aaaaaaaa](https://example.com/)\\n### Notes\\n- done'
const stopped = stopMission(root, a.mission_id, {
  reason: 'done',
  conclusion: structured,
})
check('stop with structured conclusion', stopped.manifest.status === 'stopped' && stopped.manifest.conclusion && stopped.manifest.conclusion.includes('### Answer'))
const md = readFileSync(missionMdPath(root, a.mission_id), 'utf8')
check('mission.md _status: stopped_', /_status:\\s*stopped_/.test(md), md.slice(0, 120))
check('mission.md has ## Conclusion', /## Conclusion/.test(md) && md.includes('### Answer'))

list = listMissions(root)
check('XOR after stop: 1 active', list.active.length === 1 && list.active[0].mission_id === b.mission_id)
check('XOR after stop: 1 recent (alpha only)', list.recents.length === 1 && list.recents[0].mission_id === a.mission_id)
const st = missionStatus(root, a.mission_id)
check('status: conclusion field', st.conclusion && st.conclusion.includes('### Answer'))

// pane stub
const stubbed = stopMission(root, b.mission_id, { allowStubConclusion: true, reason: 'pane' })
check('pane stub conclusion', stubbed.manifest.conclusion === PANE_CONCLUSION_STUB)

// --- R4.6 goal amend ---------------------------------------------------------
const c = startMission(root, { note: 'pivot-me', goal: 'Find JNJ dividend', budget: 2 })
amendMissionGoal(root, c.mission_id, 'Find KO dividend instead')
const cSt = missionStatus(root, c.mission_id)
check('goal amend', cSt.goal === 'Find KO dividend instead')
stopMission(root, c.mission_id, { conclusion: 'Pivoted to KO; answer TBD', goal: 'KO dividend (final)' })
check('goal at stop', missionStatus(root, c.mission_id).goal === 'KO dividend (final)')

// --- R4.4 host cooldown ------------------------------------------------------
let map = undefined
map = recordHostOutcome(map, 'sec.gov', { nonRetriable: true, successfulFull: false, K: 2, M: 2 })
check('cooldown: not yet after 1', map['sec.gov'].cooldown === false)
map = recordHostOutcome(map, 'sec.gov', { nonRetriable: true, successfulFull: false, K: 2, M: 2 })
check('cooldown: on after K=2', map['sec.gov'].cooldown === true)
map = recordHostOutcome(map, 'example.com', { nonRetriable: false, successfulFull: true, K: 2, M: 2 })
map = recordHostOutcome(map, 'example.com', { nonRetriable: false, successfulFull: true, K: 2, M: 2 })
check('cooldown: lifts after M other fulls', map['sec.gov'].cooldown === false, JSON.stringify(map['sec.gov']))
map = recordHostOutcome(map, 'bad.host', { nonRetriable: true, successfulFull: false, K: 2, M: 2 })
map = recordHostOutcome(map, 'bad.host', { nonRetriable: true, successfulFull: false, K: 2, M: 2 })
map = liftHostCooldown(map, 'bad.host')
check('cooldown: force lift', map['bad.host'].cooldown === false)

// integrate with fake fetcher + runFetch
const d = startMission(root, { note: 'cooldown-fetch', budget: 8 })
const fake = {
  async fetch(url) {
    const host = new URL(url).hostname
    return {
      url,
      finalUrl: url,
      status: 403,
      contentType: 'text/html',
      title: 'Forbidden',
      content: 'enable javascript',
      links: [],
      byteLength: 20,
      fetchedAt: new Date().toISOString(),
      quality: 'blocked',
      qualitySignals: ['http-403', 'js_required'],
      consentAttempted: false,
      consentImproved: false,
      // assessQuality would set these; fake short-circuits by returning ready page
    }
  },
}
// Monkey: Browser39Fetcher sets quality; our fake already has quality. runFetch uses page as-is from fetcher.
// Actually runFetch uses fetcher.fetch result — and storeArtifact uses page.quality from fetcher.
// Fake returns blocked — good.
await runFetch(root, fake, { url: 'https://blocked.example/a' })
await runFetch(root, fake, { url: 'https://blocked.example/b' })
const dMan = missionStatus(root, d.mission_id)
check('fetch cooldown armed', dMan.host_cooldowns?.['blocked.example']?.cooldown === true, JSON.stringify(dMan.host_cooldowns))
try {
  await runFetch(root, fake, { url: 'https://blocked.example/c' })
  check('host_cooldown refuses', false)
} catch (e) {
  check('host_cooldown refuses', e instanceof StoreError && e.code === 'host_cooldown', String(e))
}
// force lifts
await runFetch(root, fake, { url: 'https://blocked.example/c', force: true })
check('force lifts once', true)

// --- R4.7 budget exhausted on status ----------------------------------------
const e = startMission(root, { note: 'budget-out', budget: 1 })
const spendFake = {
  async fetch(url) {
    return {
      url, finalUrl: url, status: 200, contentType: 'text/html', title: 'Ok',
      content: 'Enough text here for a full page. '.repeat(40),
      links: [], byteLength: 800, fetchedAt: new Date().toISOString(),
      quality: 'full', qualitySignals: [], consentAttempted: false, consentImproved: false,
    }
  },
}
const receipt = await runFetch(root, spendFake, { url: 'https://ok.example/page' })
check('budget remaining 0', receipt.budget.remaining === 0 && receipt.budget_exhausted === true, JSON.stringify(receipt.budget))
check('wrap_up_hint on receipt', typeof receipt.wrap_up_hint === 'string' && /budget exhausted/.test(receipt.wrap_up_hint), receipt.wrap_up_hint)
const eSt = missionStatus(root, e.mission_id)
check('status budget_exhausted', eSt.budget_exhausted === true && /budget exhausted/.test(eSt.wrap_up_hint || ''), eSt.wrap_up_hint)
stopMission(root, e.mission_id, { conclusion: 'done under budget', reason: 'budget_exhausted' })
check('stop_reason budget_exhausted', missionStatus(root, e.mission_id).stop_reason === 'budget_exhausted')

// --- R4.8 verify honesty already covered in smoke-read-claims; quick check ---
writeFileSync(missionMdPath(root, e.mission_id), '# Mission\\n\\nno cites\\n')
const claims = checkMissionClaims(root, e.mission_id)
check('verify 0 cites fails', claims.ok === false, claims.summary)

console.log(fail === 0 ? 'smoke-r4: ALL GREEN' : 'smoke-r4: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

const dir = mkdtempSync(join(tmpdir(), 'smoke-r4-build-'))
try {
  writeFileSync(join(dir, 'h.ts'), harness)
  buildSync({
    entryPoints: [join(dir, 'h.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile: join(dir, 'h.mjs'),
    packages: 'external',
  })
  const r = spawnSync(process.execPath, [join(dir, 'h.mjs')], { stdio: 'inherit' })
  process.exit(r.status ?? 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
