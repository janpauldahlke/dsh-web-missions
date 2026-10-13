// M4 acceptance (slice 4.5): V1–V7 per plan/M_4_find.md.
//
// Tools run in-process from the BUILT lib with the repo cwd — the same store
// root the live :3090 routes serve (M1/M2/M3 acceptance idiom). The V1–V5
// corpus is produced by REAL browser39 fetches (counting BROWSER39_BIN
// wrapper, so batch invocations are exact) against a local fixture server, so
// mission_find is exercised on genuine stored artifacts, not fabricated ones.
// V6 is a named check on the skill + kurzprofil template (built lib registers
// on ctx.skills; body = on-disk file; resourceBase is the real directory).
// V7 builds a synthetic 500-chunk mission in a temp cwd and asserts the
// end-to-end find time against the 1 s budget (recorded).
//
// Layout:
//   V1  fetch bank page + 2 unrelated pages (3 batches) →
//       mission_find(bank name): top = bank page, snippet contains the name,
//       best_match_url = that page
//   V2  zero-overlap query → matches: [], best_match_url: null, hint present
//   V3  same query twice → byte-identical results
//   V4  url_only: true → exactly { best_match_url, link_matches }
//   V5  link text "Konditionen" → appears in link_matches
//   V6  skill web-mission-workflow registered on ctx.skills with body =
//       skills/web-mission-workflow/SKILL.md (frontmatter stripped),
//       kurzprofil template present, resourceBase = real on-disk dir;
//       live :3090 profile (this build) reports health ok
//   V7  synthetic mission, 5 pages × 100 chunks = 500 chunks →
//       mission_find < 1000 ms (measured + recorded)
// Live:  :3090 health 200; acceptance mission visible with 3 rows / 3 pages.
// Exit 0 iff every check passes. Never touches :3080 / :8080.
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, readFileSync, rmSync, existsSync } from 'node:fs'
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

const work = mkdtempSync(join(tmpdir(), 'accept-find-'))
const callLog = join(work, 'b39-calls.log')
writeFileSync(callLog, '')
const wrapper = join(work, 'b39-count.sh')
writeFileSync(wrapper, `#!/bin/sh\necho "call" >> ${JSON.stringify(callLog)}\nexec ${JSON.stringify(platformBin)} "$@"\n`)
chmodSync(wrapper, 0o755)
const callCount = () => readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length
process.env.BROWSER39_BIN = wrapper

// --- fixture server (bank page + two unrelated pages) -------------------------
const FILLER = 'lorem ipsum dolor sit amet '.repeat(120) // → ~3240 chars (full)
const pages = {
  '/bank': {
    status: 200,
    body: '<html><head><title>Volksbank Nord</title></head><body>' +
      '<h1>Volksbank Nord</h1>' +
      '<p>Die Volksbank Nord ist eine Bank in Hamburg. Bankenzentrale in der Mönckebergstraße. ' + FILLER + '</p>' +
      '<a href="/konditionen">Konditionen</a> ' +
      '<a href="/ueber-uns">Über uns</a>' +
      '</body></html>',
  },
  '/cooking': {
    status: 200,
    body: '<html><head><title>Apfelkuchen</title></head><body>' +
      '<h1>Apfelkuchen</h1>' +
      '<p>Rezept: Apfelkuchen. Den Apfel waschen und schneiden. Backen bei 180 Grad. ' + FILLER + '</p>' +
      '</body></html>',
  },
  '/news': {
    status: 200,
    body: '<html><head><title>Stadtzeitung</title></head><body>' +
      '<h1>Stadtzeitung</h1>' +
      '<p>Rathaus saniert den Marktplatz. Radfahrer freuen sich über die neue Spur. ' + FILLER + '</p>' +
      '</body></html>',
  },
}
const server = http.createServer((req, res) => {
  const spec = pages[req.url.split('?')[0]]
  if (!spec) { res.writeHead(404); res.end('nope'); return }
  res.writeHead(spec.status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(spec.body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

// --- built lib, tools in-process, repo cwd (shared store root w/ live :3090) --
const lib = require(join(repoRoot, 'lib', 'index.js'))
const tools = []
const skills = []
lib.apply({
  tools: { register: (def) => { tools.push(def); return () => {} } },
  skills: { register: (def) => { skills.push(def); return () => {} } },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
})
const byName = Object.fromEntries(tools.map((t) => [t.name, t]))
if (!byName.mission_find || !byName.mission_start) {
  console.error('FATAL: mission_find / mission_start not registered in built lib')
  process.exit(1)
}
const exec = () => ({})
const J = (v) => JSON.stringify(v)
let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label); else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const started = await byName.mission_start.execute({ note: 'M4 acceptance', cwd: repoRoot }, exec())
check('setup: mission started', !!started.mission_id, J(started))
const mid = started.mission_id
// M5 5.2: egress allowlist (deny-all default) — permit the local fixture server.
mkdirSync(join(repoRoot, '.dsh'), { recursive: true })
writeFileSync(join(repoRoot, '.dsh', 'allowlist.txt'), '127.0.0.1\n')
const findTool = (args) => byName.mission_find.execute({ mission_id: mid, cwd: repoRoot, ...args }, exec())
const fetchTool = (args) => byName.mission_fetch.execute({ mission_id: mid, cwd: repoRoot, ...args }, exec())

// corpus: three real fetches (bank + cooking + news)
const f1 = await fetchTool({ url: base + '/bank' })
const f2 = await fetchTool({ url: base + '/cooking' })
const f3 = await fetchTool({ url: base + '/news' })
check('setup: three real fetches stored (full quality)', f1.cached === false && f2.cached === false && f3.cached === false && [f1, f2, f3].every((r) => r.page_quality === 'full'), J([{ e: f1.error }, { e: f2.error }, { e: f3.error }]))
check('setup: exactly 3 batch invocations', callCount() === 3, 'calls=' + callCount())

// --- V1 ------------------------------------------------------------------------
const r1 = await findTool({ query: 'volksbank nord' })
check('V1: top match is the bank page', r1.matches?.[0]?.url === base + '/bank', J(r1.matches?.[0]))
check('V1: top match artifact_id surfaced', r1.matches?.[0]?.artifact_id === f1.artifact_id, J([r1.matches?.[0]?.artifact_id, f1.artifact_id]))
check('V1: snippet contains the name', r1.matches?.[0]?.snippet?.toLowerCase().includes('volksbank') === true, r1.matches?.[0]?.snippet)
check('V1: best_match_url = bank page', r1.best_match_url === base + '/bank', r1.best_match_url)
check('V1: result shape (mission_id, query, matches, link_matches, depth present)', r1.mission_id === mid && r1.query === 'volksbank nord' && Array.isArray(r1.matches) && Array.isArray(r1.link_matches) && typeof r1.matches?.[0]?.depth === 'number', J(Object.keys(r1)))
check('V1: no hint when matches exist', !('hint' in r1), J(Object.keys(r1)))

// --- V2 ------------------------------------------------------------------------
const r2 = await findTool({ query: 'quantum flurben' })
check('V2: empty matches, null best', r2.matches?.length === 0 && r2.best_match_url === null, J(r2))
check('V2: hint present, exact text', r2.hint === 'no matches: stored pages may not cover this — consider mission_fetch', r2.hint)

// --- V3 ------------------------------------------------------------------------
const r3 = await findTool({ query: 'volksbank nord' })
check('V3: byte-identical twice', JSON.stringify(r1) === JSON.stringify(r3))

// --- V4 ------------------------------------------------------------------------
const r4 = await findTool({ query: 'volksbank nord', url_only: true })
check('V4: url_only keys exact', JSON.stringify(Object.keys(r4).sort()) === JSON.stringify(['best_match_url', 'link_matches']), J(Object.keys(r4)))
check('V4: url_only best_match_url = bank page', r4.best_match_url === base + '/bank', r4.best_match_url)

// --- V5 ------------------------------------------------------------------------
const r5 = await findTool({ query: 'konditionen' })
check('V5: link text "Konditionen" in link_matches', r5.link_matches?.some((l) => l.text === 'Konditionen' && l.url === base + '/konditionen'), J(r5.link_matches))
check('V5: link cap ≤ 5', r5.link_matches?.length <= 5, 'n=' + r5.link_matches?.length)

// --- V6 ------------------------------------------------------------------------
// Named check: the built lib (the same apply() the live profile runs) registers
// the skill on ctx.skills with body = the on-disk file minus frontmatter.
const skillFile = join(repoRoot, 'skills', 'web-mission-workflow', 'SKILL.md')
check('V6: skill file on disk', existsSync(skillFile), skillFile)
const rawLines = readFileSync(skillFile, 'utf8').split('\n')
const fmEnd = rawLines.indexOf('---', 1)
const expectedBody = rawLines.slice(fmEnd + 1).join('\n').replace(/^\n+/, '')
const s = skills[0]
check('V6: exactly one skill registered', skills.length === 1, J(skills.map((x) => x.name)))
check('V6: skill name web-mission-workflow', s?.name === 'web-mission-workflow', s?.name)
check('V6: description from frontmatter', typeof s?.description === 'string' && s.description.length > 20, s?.description)
check('V6: whenToUse from frontmatter', typeof s?.whenToUse === 'string' && s.whenToUse.length > 10, s?.whenToUse)
check('V6: body = file content (frontmatter stripped)', s?.content === expectedBody)
check('V6: kurzprofil template resolvable by name', (s?.content || '').includes('Template: kurzprofil') && (s?.content || '').includes('**Sources:**'))
check('V6: resourceBase = real skills directory', s?.resourceBase?.kind === 'directory' && s.resourceBase.path === join(repoRoot, 'skills', 'web-mission-workflow') && existsSync(join(s.resourceBase.path, 'SKILL.md')), J(s?.resourceBase))
check('V6: invocable by model and user', s?.invocation?.modelInvocable === true && s?.invocation?.userInvocable === true, J(s?.invocation))

// --- V7: 500-chunk synthetic mission (temp cwd), < 1 s -------------------------
const perfCwd = mkdtempSync(join(tmpdir(), 'accept-find-perf-'))
const perf = await byName.mission_start.execute({ note: 'M4 acceptance perf', cwd: perfCwd }, exec())
check('V7: perf mission started', !!perf.mission_id, J(perf))
const perfPagesDir = join(perfCwd, '.dsh', 'web-missions', perf.mission_id, 'pages')
const POOL = ['bankhaus', 'kassentresor', 'filiale', 'guthaben', 'zinssatz', 'filialnetz', 'kunde', 'berater', 'schalter', 'kredit', 'hypothek', 'beteiligung', 'portfolio', 'dividende', 'aktie', 'anleihe', 'emission', 'rating', 'bonität', 'absicherung']
const CHUNKS_PER_PAGE = 100
const PAGES = 5
const MARKER = 'zebrafisch'
let chunkTotal = 0
for (let p = 0; p < PAGES; p++) {
  const artifactId = 'p-' + p.toString(16).padStart(8, '0')
  const d = join(perfPagesDir, artifactId)
  mkdirSync(join(d, 'chunks'), { recursive: true })
  const url = base + '/perf-' + p
  const content = Array.from({ length: CHUNKS_PER_PAGE }, (_, c) => {
    const words = Array.from({ length: 60 }, (_, i) => POOL[(i * 7 + c * 13 + p) % POOL.length])
    if (p === 2 && c === 42) words.push(MARKER)
    return words.join(' ')
  })
  for (let c = 0; c < CHUNKS_PER_PAGE; c++) {
    writeFileSync(join(d, 'chunks', String(c).padStart(3, '0') + '.md'), content[c])
    chunkTotal++
  }
  writeFileSync(join(d, 'page.json'), JSON.stringify({
    artifact_id: artifactId, mission_id: perf.mission_id,
    normalized_url: url, stored_at: new Date().toISOString(),
    url, finalUrl: url, status: 200, contentType: 'text/html', title: 'perf ' + p,
    content: content.join('\n'), links: [], byteLength: 1, fetchedAt: new Date().toISOString(),
    quality: 'full', qualitySignals: [], consentAttempted: false, consentImproved: false, depth: 0,
  }, null, 2))
  writeFileSync(join(d, 'links.json'), '[]')
}
check('V7: synthetic corpus = 500 chunks across 5 pages', chunkTotal === 500, 'chunks=' + chunkTotal)
const t0 = process.hrtime.bigint()
const r7 = await byName.mission_find.execute({ query: MARKER, cwd: perfCwd }, exec())
const ms = Number(process.hrtime.bigint() - t0) / 1e6
check('V7: 500-chunk mission_find < 1000 ms', ms < 1000, ms.toFixed(1) + ' ms')
check('V7: marker found (1 match, correct page/chunk)', r7.matches?.length === 1 && r7.matches[0].url === base + '/perf-2' && r7.matches[0].chunk === 42 && r7.matches[0].snippet.includes(MARKER), J(r7.matches?.[0]))
console.log('record: V7 measured ' + ms.toFixed(1) + ' ms (budget 1000 ms, 500 chunks)')

// --- live :3090 cross-check -----------------------------------------------------
const liveBase = 'http://127.0.0.1:3090'
const health = await (await fetch(liveBase + '/api/web-missions/health')).json()
check('live: :3090 health ok (M4 build running)', health.ok === true && health.name === 'dsh-local-web-missions', J(health))
const list = await (await fetch(liveBase + '/api/web-missions/missions')).json()
const liveRow = (list.active || []).find((m) => m.mission_id === mid)
check('live: acceptance mission visible via live routes', !!liveRow && liveRow.status === 'active', J(liveRow))
if (liveRow) {
  check('live: 3 rows / 3 pages visible on live route', liveRow.visited === 3 && liveRow.pages === 3, J({ visited: liveRow.visited, pages: liveRow.pages }))
  const byId = await (await fetch(liveBase + '/api/web-missions/missions/' + mid)).json()
  check('live: by-id route serves ledger', Array.isArray(byId.visited) && byId.visited.length === 3, 'visited=' + (byId.visited || []).length)
}

console.log(fail === 0 ? 'M4 ACCEPTANCE: all checks passed' : 'M4 ACCEPTANCE: ' + fail + ' FAILURES')
server.close()
rmSync(work, { recursive: true, force: true })
rmSync(perfCwd, { recursive: true, force: true })
process.exit(fail === 0 ? 0 : 1)
