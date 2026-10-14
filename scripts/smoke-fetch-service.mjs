// Fetch service smoke (M2 slices 2.4 + 2.5, M3 cache):
//   A) service-level harness (tmpdir bundle, child process): splitContent,
//      dedupeLinks, storeArtifact (full + blocked), appendFetchedRow,
//      hostSessionKey, runFetch with a fake counting fetcher (M3 cache-hit /
//      force / hint_find_first / ageDays assertions, zero-spawn) and with the
//      REAL Browser39Fetcher against a local HTTP server (incl. M3 hit,
//      backdated-row age_days with an injected clock, force overwrite, and a
//      redirect alias /redir → /target).
//   B) tool-level harness (repo-context bundle, child process): applies the
//      BUILT lib, asserts 6 tools + the web-mission-workflow skill registered
//      (incl. mission_fetch), runs mission_start + mission_fetch end-to-end
//      (receipt + on-disk artifacts), M3 tool-level cache hit + force (one row
//      per URL), 404 → blocked receipt, unparsable → normalize_failed (no
//      ledger row), dead BROWSER39_BIN → spawn_failed, empty cwd → no_mission.
// Exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const abs = (p) => join(here, p).split(/[\\/]/).join('/')

const outerRequire = createRequire(import.meta.url)
let platformBin = null
for (const name of [
  '@aquintanar/browser39-linux-x64',
  '@aquintanar/browser39-linux-arm64',
  '@aquintanar/browser39-darwin-x64',
  '@aquintanar/browser39-darwin-arm64',
  '@aquintanar/browser39-win32-x64',
]) {
  try {
    const pkgJson = outerRequire.resolve(`${name}/package.json`)
    const candidate = join(dirname(pkgJson), 'bin', 'browser39')
    if (existsSync(candidate)) { platformBin = candidate; break }
  } catch { /* not installed */ }
}
if (!platformBin) {
  console.error('FATAL: platform browser39 binary not found in node_modules')
  process.exit(1)
}

// --- shared local server (embedded in each harness string) --------------------
const serverCode = `
const pages = {
  '/target': {
    body: '<html><head><title>Target Page</title></head><body>' +
      '<h1>Target</h1><p>' + 'SENTINEL-FULL-TEXT ' + 'lorem ipsum dolor sit amet '.repeat(120) + '</p>' +
      '<a href="/other">the other page</a><a href="/target#dup">self link</a>' +
      '</body></html>',
  },
  '/missing': { status: 404, body: '<html><head><title>404 Not Found</title></head><body>Not Found Here</body></html>' },
}
const server = http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  if (path === '/redir') { res.writeHead(302, { Location: '/target' }); res.end(); return }
  const spec = pages[path]
  if (!spec) { res.writeHead(404); res.end('nope'); return }
  res.writeHead(spec.status || 200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(spec.body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
`

// --- Harness A: service level --------------------------------------------------
const harnessA = `
import http from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Browser39Fetcher } from '${abs('../src/host/fetcher.ts')}'
import { normalizeUrl } from '${abs('../src/host/normalize.ts')}'
import { splitContent, dedupeLinks, storeArtifact, PREVIEW_HEAD_CHARS } from '${abs('../src/host/artifacts.ts')}'
import { runFetch, hostSessionKey, findLedgerRow, ageDays } from '${abs('../src/host/fetch-service.ts')}'
import { startMission, readManifest, appendFetchedRow, StoreError } from '${abs('../src/host/store.ts')}'
import type { FetchedPage } from '${abs('../src/shared/types.ts')}'

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

// --- splitContent (content = 1900 chars + '\\n' + 500 chars; newline at index
// 1900, inside the ±20% window [1600, 2400] of the 2000 limit)
const c1 = 'x'.repeat(1900) + '\\n' + 'y'.repeat(500)
const s1 = splitContent(c1, 2000)
check('split: newline boundary at 1901', s1.length === 2 && s1[0].length === 1901 && s1[1].length === 500, JSON.stringify(s1.map((c) => c.length)))
// no newline in window → hard cut at limit
const c2 = 'z'.repeat(2500)
const s2 = splitContent(c2, 2000)
check('split: hard cut without newline', s2.length === 2 && s2[0].length === 2000 && s2[1].length === 500, JSON.stringify(s2.map((c) => c.length)))
// short content → single chunk
check('split: short → 1 chunk', splitContent('hello', 2000).length === 1)
// exactly at limit → single chunk
check('split: exact limit → 1 chunk', splitContent('q'.repeat(2000), 2000).length === 1)
// 2001 → 2000 + 1
check('split: limit+1', splitContent('q'.repeat(2001), 2000).map((c) => c.length).join(',') === '2000,1')
// empty
check('split: empty → []', splitContent('', 2000).length === 0)
// content reassembles
check('split: lossless reassembly', s1.join('') === c1 && s2.join('') === c2)

// --- dedupeLinks
const dl = dedupeLinks([
  { url: 'http://a.com/1?b=2&a=1', text: 'first' },
  { url: 'http://a.com/1?a=1&b=2', text: 'second' }, // same normalized key
  { url: 'http://a.com/2', text: 'two' },
])
check('dedupe: first-seen text wins', dl.length === 2 && dl[0].text === 'first' && dl[1].url === 'http://a.com/2', JSON.stringify(dl))

// --- storeArtifact (fabricated pages)
const root = join(mkdtempSync(join('/tmp', 'smoke-svc-')), 'root')
mkdirSync(root, { recursive: true })
// M5 5.2: permit the local fixture host — the deny-all default allowlist
// would gate every fetch below; this suite tests fetch/cache mechanics.
writeFileSync(join(root, '..', 'allowlist.txt'), '127.0.0.1')
const manifest = startMission(root, { note: 'smoke' })
const id = manifest.mission_id
const mkPage = (over): FetchedPage => ({
  finalUrl: 'http://example.com/page',
  status: 200,
  title: 'T',
  content: 'abc',
  links: [],
  quality: 'full',
  qualitySignals: [],
  consentAttempted: false,
  consentImproved: false,
  byteLength: 3,
  fetchedAt: new Date().toISOString(),
  ...over,
})
const longContent = 'K'.repeat(1900) + '\\n' + 'M'.repeat(500)
const stFull = storeArtifact(root, id, mkPage({ content: longContent, links: [
  { url: 'http://example.com/a', text: 'A' },
  { url: 'http://example.com/a/', text: 'A dup' },
  { url: 'http://example.com/b', text: 'B' },
] }))
const artDir = join(root, id, 'pages', stFull.artifactId)
const pj = JSON.parse(readFileSync(join(artDir, 'page.json'), 'utf8'))
check('store: artifact id p-<8hex>', /^p-[0-9a-f]{8}$/.test(stFull.artifactId), stFull.artifactId)
check('store: page.json meta', pj.artifact_id === stFull.artifactId && pj.mission_id === id && pj.normalized_url === normalizeUrl('http://example.com/page') && !!pj.stored_at, JSON.stringify(pj.normalized_url))
check('store: chunk files', readdirSync(join(artDir, 'chunks')).join(',') === '000.md,001.md', readdirSync(join(artDir, 'chunks')).join(','))
check('store: chunk content', readFileSync(join(artDir, 'chunks', '000.md'), 'utf8').length === 1901)
check('store: links deduped', JSON.parse(readFileSync(join(artDir, 'links.json'), 'utf8')).length === 2)
check('store: preview head', stFull.previewHead === 'K'.repeat(PREVIEW_HEAD_CHARS), 'len=' + stFull.previewHead.length)
check('store: chunkCount 2', stFull.chunkCount === 2, 'n=' + stFull.chunkCount)

const stBlocked = storeArtifact(root, id, mkPage({ status: 404, quality: 'blocked', qualitySignals: ['http-404'], content: 'Not Found Here', links: [{ url: 'http://example.com/home', text: 'home' }] }))
const bDir = join(root, id, 'pages', stBlocked.artifactId)
check('store: blocked has page.json', existsSync(join(bDir, 'page.json')))
check('store: blocked has NO chunks dir', !existsSync(join(bDir, 'chunks')))
check('store: blocked links stored', JSON.parse(readFileSync(join(bDir, 'links.json'), 'utf8')).length === 1)
check('store: blocked chunkCount 0', stBlocked.chunkCount === 0)

// --- appendFetchedRow
const before = readManifest(root, id).fetched.length
appendFetchedRow(root, id, {
  normalized_url: normalizeUrl('http://example.com/x'),
  url: 'http://example.com/x',
  artifact_id: stFull.artifactId,
  quality: 'full',
  fetched_at: new Date().toISOString(),
})
const after = readManifest(root, id).fetched.length
check('ledger: append grows', after === before + 1, before + '->' + after)
try {
  appendFetchedRow(root, 'm-deadbeef', { normalized_url: 'k', url: 'u', artifact_id: 'p-01234567', quality: 'full', fetched_at: '' })
  check('ledger: unknown mission throws', false)
} catch (e) {
  check('ledger: unknown mission throws', e instanceof StoreError && e.code === 'unknown_mission', String(e))
}

// --- hostSessionKey
check('sessionKey: lowercased hostname no port', hostSessionKey('http://Example.COM:8080/x') === 'example.com', hostSessionKey('http://Example.COM:8080/x'))

${serverCode}

// --- runFetch with FAKE counting fetcher (zero-spawn proof)
let fetchCalls = 0
const fakePage: FetchedPage = mkPage({
  finalUrl: base + '/target?final=1',
  content: 'fake ' + 'f'.repeat(2500),
  links: [{ url: base + '/target?final=1/x', text: 'x' }],
})
const fakeFetcher = {
  async fetch() { fetchCalls++; return fakePage },
}
let receipt
try {
  receipt = await runFetch(root, fakeFetcher, { url: base + '/redirect-ish' })
} catch (e) {
  // base + '/redirect-ish' is a valid URL; fake returns a page with a different final URL
  check('fake: unexpected throw', false, String(e))
  receipt = null
}
if (receipt) {
  check('fake: receipt base', receipt.cached === false && receipt.age_days === 0 && receipt.depth === 0 && receipt.parent_artifact_id === null, JSON.stringify(receipt))
  check('fake: final_url recorded', receipt.final_url === base + '/target?final=1', receipt.final_url)
  check('fake: ledger key = normalized FINAL url', findLedgerRow(readManifest(root, id), normalizeUrl(base + '/target?final=1')) !== undefined)
  check('fake: visited_count 2 (after manual row)', receipt.visited_count === 2, 'v=' + receipt.visited_count)
  check('fake: sample_links ≤5', receipt.sample_links.length === 1, JSON.stringify(receipt.sample_links))
  check('fake: chunk_count', receipt.chunk_count === 2, 'n=' + receipt.chunk_count)
}
// M3: second fetch of the SAME requested URL → cache hit, ZERO spawn
const rowsBefore = readManifest(root, id).fetched.length
const hitR = await runFetch(root, fakeFetcher, { url: base + '/redirect-ish' })
const rowsAfter = readManifest(root, id).fetched.length
check('M3: hit cached:true, same artifact, age 0', hitR.cached === true && hitR.artifact_id === receipt.artifact_id && hitR.age_days === 0, JSON.stringify({ c: hitR.cached, a: hitR.artifact_id, first: receipt.artifact_id, age: hitR.age_days }))
check('M3: hit zero spawn', fetchCalls === 1, 'calls=' + fetchCalls)
check('M3: hit adds no row', rowsAfter === rowsBefore, 'rows ' + rowsBefore + '->' + rowsAfter)
check('M3: cached hint wording', hitR.next_step_hint.startsWith('cached: already stored'), hitR.next_step_hint)
check('M3: first fresh receipt had no hint', receipt.hint_find_first === undefined, JSON.stringify(receipt.hint_find_first))

// M3: ageDays arithmetic (S4: 25h → 1.04; floor at 0)
check('M3: ageDays 25h → 1.04', ageDays(new Date(Date.now() - 25 * 3600e3).toISOString(), Date.now()) === 1.04)
check('M3: ageDays floors at 0', ageDays(new Date(Date.now() + 1000).toISOString(), Date.now()) === 0)

// M3: force → same artifact id, row refreshed in place (one row per URL)
const forceR = await runFetch(root, fakeFetcher, { url: base + '/redirect-ish', force: true })
check('M3: force fresh receipt, same artifact', forceR.cached === false && forceR.age_days === 0 && forceR.artifact_id === receipt.artifact_id, JSON.stringify({ c: forceR.cached, a: forceR.artifact_id }))
check('M3: force kept one row', readManifest(root, id).fetched.length === rowsBefore, 'rows=' + readManifest(root, id).fetched.length)
const rowAfterForce = readManifest(root, id).fetched.find((r) => r.normalized_url === normalizeUrl(base + '/target?final=1'))
check('M3: force row refreshed, alias kept', !!rowAfterForce && rowAfterForce.artifact_id === receipt.artifact_id && (rowAfterForce.requested_keys ?? []).includes(normalizeUrl(base + '/redirect-ish')), JSON.stringify(rowAfterForce))

// M3: hint_find_first on same-host miss (a stored page exists on this host)
appendFetchedRow(root, id, {
  normalized_url: normalizeUrl(base + '/first-stored'),
  url: base + '/first-stored',
  artifact_id: receipt.artifact_id,
  quality: 'full',
  fetched_at: new Date().toISOString(),
})
const hintR = await runFetch(root, fakeFetcher, { url: base + '/new-path' })
check('M3: hint_find_first on same-host miss', hintR.hint_find_first === 'this host has 1 stored pages — consider mission_find before fetching a new path' || (typeof hintR.hint_find_first === 'string' && hintR.hint_find_first.includes('stored pages') && hintR.hint_find_first.includes('mission_find')), JSON.stringify(hintR.hint_find_first))

// normalize_failed → zero fetch calls (V3)
const callsBefore = fetchCalls
let normErr = null
try {
  await runFetch(root, fakeFetcher, { url: 'not a url' })
} catch (e) { normErr = e }
check('V3: normalize_failed thrown', normErr instanceof StoreError && normErr.code === 'normalize_failed', String(normErr))
check('V3: zero fetch calls', fetchCalls === callsBefore, 'calls=' + fetchCalls)

// no_mission on empty root
const emptyRoot = join(mkdtempSync(join('/tmp', 'smoke-svc2-')), 'root')
let noM = null
try { await runFetch(emptyRoot, fakeFetcher, { url: base + '/target' }) } catch (e) { noM = e }
check('no_mission error', noM instanceof StoreError && noM.code === 'no_mission', String(noM))

// --- runFetch with REAL Browser39Fetcher (live local server)
const realFetcher = new Browser39Fetcher()
const full = await runFetch(root, realFetcher, { url: base + '/target' })
check('real: full receipt', full.page_quality === 'full' && full.cached === false, JSON.stringify({ q: full.page_quality, c: full.cached, s: full.quality_signals }))
{
  const d = join(root, id, 'pages', full.artifact_id)
  check('real: on-disk artifacts', existsSync(join(d, 'page.json')) && existsSync(join(d, 'chunks', '000.md')) && existsSync(join(d, 'links.json')), d)
  const pjf = JSON.parse(readFileSync(join(d, 'page.json'), 'utf8'))
  const recomputed = splitContent(pjf.content, 2000).length
  check('real: chunk_count consistent with stored content', full.chunk_count === recomputed, 'receipt=' + full.chunk_count + ' stored=' + recomputed)
  check('real: preview ≤300', full.preview_head.length <= 300 && full.preview_head.includes('SENTINEL-FULL-TEXT'), full.preview_head.slice(0, 60))
  check('real: sample_links has absolute /other', full.sample_links.some((l) => l === base + '/other'), JSON.stringify(full.sample_links))
}
const blocked = await runFetch(root, realFetcher, { url: base + '/missing' })
check('real: 404 → blocked receipt (ok, not error)', blocked.page_quality === 'blocked' && blocked.chunk_count === 0, JSON.stringify(blocked.quality_signals))
check('real: blocked ledger row quality', readManifest(root, id).fetched.some((r) => r.normalized_url === normalizeUrl(base + '/missing') && r.quality === 'blocked'))
check('real: no chunks dir for blocked', !existsSync(join(root, id, 'pages', blocked.artifact_id, 'chunks')))

// --- M3 real: cache hit (receipt served from disk, zero spawn)
const hit2 = await runFetch(root, realFetcher, { url: base + '/target' })
check('real M3: hit cached, same artifact, age 0', hit2.cached === true && hit2.artifact_id === full.artifact_id && hit2.age_days === 0 && hit2.final_url === base + '/target', JSON.stringify({ c: hit2.cached, a: hit2.artifact_id, age: hit2.age_days }))
check('real M3: hit preview from stored page', hit2.preview_head.includes('SENTINEL-FULL-TEXT'), hit2.preview_head.slice(0, 40))
check('real M3: hit sample_links from stored links', hit2.sample_links.includes(base + '/other'), JSON.stringify(hit2.sample_links))
check('real M3: hit chunk_count from chunks dir', hit2.chunk_count === full.chunk_count, 'hit=' + hit2.chunk_count + ' full=' + full.chunk_count)

// --- M3 real: age_days via backdated row + injected clock (V4, 25h → 1.04)
const nowMs = Date.now()
{
  const m = readManifest(root, id)
  const r = m.fetched.find((x) => x.normalized_url === normalizeUrl(base + '/target'))
  r.fetched_at = new Date(nowMs - 25 * 3600e3).toISOString()
  writeFileSync(join(root, id, 'manifest.json'), JSON.stringify(m, null, 2))
}
const aged = await runFetch(root, realFetcher, { url: base + '/target' }, { now: () => nowMs })
check('real M3: aged hit age_days 1.04', aged.cached === true && aged.age_days === 1.04, JSON.stringify({ c: aged.cached, age: aged.age_days }))
check('real M3: aged cached hint carries age', typeof aged.next_step_hint === 'string' && aged.next_step_hint.startsWith('cached: already stored (age 1.04d)') && (aged.next_step_hint.includes('mission_find') || aged.next_step_hint.includes('mission_read') || aged.next_step_hint.includes('force')), aged.next_step_hint)

// --- M3 real: force overwrite in place (same artifact id, one row)
const forced2 = await runFetch(root, realFetcher, { url: base + '/target', force: true })
check('real M3: force fresh, same artifact', forced2.cached === false && forced2.age_days === 0 && forced2.artifact_id === full.artifact_id, JSON.stringify({ c: forced2.cached, a: forced2.artifact_id }))
check('real M3: force row back to fresh fetched_at', readManifest(root, id).fetched.find((x) => x.normalized_url === normalizeUrl(base + '/target')).fetched_at === forced2.fetched_at)
check('real M3: force kept one row per url', readManifest(root, id).fetched.filter((x) => x.normalized_url === normalizeUrl(base + '/target')).length === 1)

// --- M3 real: redirect alias (/redir → /target) collapses onto the row
const redir = await runFetch(root, realFetcher, { url: base + '/redir' })
check('real M3: redirect miss reuses row in place', redir.cached === false && redir.artifact_id === full.artifact_id, JSON.stringify({ c: redir.cached, a: redir.artifact_id }))
const redirHit = await runFetch(root, realFetcher, { url: base + '/redir' })
check('real M3: redirect alias re-fetch → hit', redirHit.cached === true && redirHit.artifact_id === full.artifact_id, JSON.stringify({ c: redirHit.cached, a: redirHit.artifact_id }))

console.log(fail === 0 ? 'harness A: all checks passed' : 'harness A: ' + fail + ' FAILURES')
server.close()
process.exit(fail === 0 ? 0 : 1)
`

// --- Harness B: tool level (applies the BUILT lib) -----------------------------
const harnessB = `
import http from 'node:http'
import { mkdtempSync, existsSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require2 = createRequire(import.meta.url)
const lib = require2(${JSON.stringify(join(repoRoot, 'lib', 'index.js'))})

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const tools = []
const skills = []
const ctx = {
  tools: { register: (def) => { tools.push(def); return () => {} } },
  skills: { register: (def) => { skills.push(def); return () => {} } },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
}
lib.apply(ctx)
const names = tools.map((t) => t.name)
check('tools: 8 registered (find/read/verify/stop)', names.length === 8 && names.includes('mission_find') && names.includes('mission_read') && names.includes('mission_verify') && names.includes('mission_stop'), JSON.stringify(names))
check('skill: web-mission-workflow registered', skills.length === 1 && skills[0].name === 'web-mission-workflow' && skills[0].content.includes('Template: kurzprofil'), JSON.stringify(skills.map((s) => s.name)))
check('tools: mission_fetch present', names.includes('mission_fetch'), JSON.stringify(names))
const find = (n) => tools.find((t) => t.name === n)

${serverCode}

const workdir = mkdtempSync(join('/tmp', 'smoke-tool-'))
const exec = () => ({})
const byName = {}
for (const t of tools) byName[t.name] = t

const started = await byName.mission_start.execute({ note: 'tool smoke', cwd: workdir }, exec())
check('tool: mission_start', !!started.mission_id, JSON.stringify(started))
const mid = started.mission_id
// M5 5.2: permit the local fixture host — the deny-all default allowlist
// would gate every fetch below; this suite tests tool wiring + cache.
mkdirSync(join(workdir, '.dsh'), { recursive: true })
writeFileSync(join(workdir, '.dsh', 'allowlist.txt'), '127.0.0.1')

const full = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool: fetch receipt ok', full.cached === false && full.page_quality === 'full' && full.chunk_count >= 1, JSON.stringify({ q: full.page_quality, c: full.chunk_count, e: full.error }))
if (full.artifact_id) {
  const d = join(workdir, '.dsh', 'web-missions', mid, 'pages', full.artifact_id)
  check('tool: artifacts on disk', existsSync(join(d, 'page.json')) && readdirSync(join(d, 'chunks')).length === full.chunk_count, d)
  const links = JSON.parse(readFileSync(join(d, 'links.json'), 'utf8'))
  check('tool: links deduped (self-link collapsed)', links.every((l) => l.url === base + '/other' || l.url.startsWith(base)), JSON.stringify(links))
}
const st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool: visited ledger has row', st.visited.length === 1 && st.visited[0].quality === 'full', JSON.stringify(st.visited))

// M3 tool-level: cache hit + force (one row per normalized URL)
const hit = await byName.mission_fetch.execute({ url: base + '/target', mission_id: mid, cwd: workdir }, exec())
check('tool M3: cache hit', hit.cached === true && hit.artifact_id === full.artifact_id && hit.age_days === 0 && hit.next_step_hint.startsWith('cached:'), JSON.stringify({ c: hit.cached, a: hit.artifact_id, h: hit.next_step_hint }))
const forced = await byName.mission_fetch.execute({ url: base + '/target', force: true, mission_id: mid, cwd: workdir }, exec())
check('tool M3: force re-fetch, same artifact', forced.cached === false && forced.age_days === 0 && forced.artifact_id === full.artifact_id, JSON.stringify({ c: forced.cached, a: forced.artifact_id }))
const stf = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool M3: one ledger row per url', stf.visited.length === 1, 'visited=' + stf.visited.length)

const b404 = await byName.mission_fetch.execute({ url: base + '/missing', mission_id: mid, cwd: workdir }, exec())
check('tool: 404 → blocked receipt', b404.page_quality === 'blocked' && b404.chunk_count === 0, JSON.stringify({ q: b404.page_quality, e: b404.error }))

const bad = await byName.mission_fetch.execute({ url: 'not a url', mission_id: mid, cwd: workdir }, exec())
check('tool: normalize_failed envelope', bad.ok === false && bad.error.startsWith('normalize_failed:'), JSON.stringify(bad))
const st2 = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool: no ledger row for bad url', st2.visited.length === 2, 'visited=' + st2.visited.length)

// /other is NOT yet stored (M3: stored URLs are cache hits, not spawns)
process.env.BROWSER39_BIN = '/nonexistent/b39'
const dead = await byName.mission_fetch.execute({ url: base + '/other', mission_id: mid, cwd: workdir }, exec())
check('tool: spawn_failed envelope', dead.ok === false && dead.error.startsWith('spawn_failed:'), JSON.stringify(dead))
delete process.env.BROWSER39_BIN

const none = await byName.mission_fetch.execute({ url: base + '/target', cwd: workdir + '-empty' }, exec())
check('tool: no_mission on empty cwd', none.ok === false && none.error.startsWith('no_mission:'), JSON.stringify(none))

console.log(fail === 0 ? 'harness B: all checks passed' : 'harness B: ' + fail + ' FAILURES')
server.close()
process.exit(fail === 0 ? 0 : 1)
`

// --- run both ------------------------------------------------------------------
// M5 5.4: hermetic host-scoped session dirs (never touch ~/.dsh/browser39/sessions).
process.env.BROWSER39_SESSIONS_DIR = mkdtempSync(join(tmpdir(), 'smoke-svc-sess-'))
let rc = 0

const dirA = mkdtempSync(join(tmpdir(), 'smoke-svc-a-'))
try {
  writeFileSync(join(dirA, 'a.ts'), harnessA)
  buildSync({ entryPoints: [join(dirA, 'a.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirA, 'a.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirA, 'a.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness A exit ' + out.status) }
} finally {
  rmSync(dirA, { recursive: true, force: true })
}

const dirB = join(repoRoot, '.smoke-fetch-service')
try {
  rmSync(dirB, { recursive: true, force: true })
  mkdirSync(dirB, { recursive: true })
  writeFileSync(join(dirB, 'b.ts'), harnessB)
  buildSync({ entryPoints: [join(dirB, 'b.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirB, 'b.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirB, 'b.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness B exit ' + out.status) }
} finally {
  rmSync(dirB, { recursive: true, force: true })
}

process.exit(rc)
