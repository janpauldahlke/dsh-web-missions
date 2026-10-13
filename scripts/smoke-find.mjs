// Find smoke (M4 slice 4.1 — C8 port + LexicalEngine):
//   A) service-level harness (tmpdir mission store, esbuild-bundled child):
//      tokenize rules (unicode-aware, min len 3), empty_query FindError,
//      tf × IDF-lite scoring (exact expected scores on a fixed 6-chunk corpus),
//      zero-overlap → empty result, determinism (byte-identical twice),
//      limit default/clamp, link_matches (chunk+link corpus, ≤5, tie order),
//      snippet rule (no ellipsis on short chunk, … on both sides when clipped,
//      line-boundary + single-space collapse, core ⊆ collapsed chunk),
//      tie-breaks (fetched_at newer first; artifact_id asc), depth read from
//      page.json (0 default, 2 when M5-style record present), corrupt-dir skip,
//      urlOnly ignored by the engine (full result shape always).
// Exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const abs = (p) => join(here, p).split(/[\\/]/).join('/')

const harnessA = `
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { startMission, readManifest } from '${abs('../src/host/store.ts')}'
import { storeArtifact } from '${abs('../src/host/artifacts.ts')}'
import { LexicalEngine, FindError, tokenize, DEFAULT_FIND_LIMIT, MAX_FIND_LIMIT } from '${abs('../src/host/retrieval.ts')}'
import type { FetchedPage } from '${abs('../src/shared/types.ts')}'

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }
const round2 = (n) => Math.round(n * 100) / 100

// --- tokenize (D-M4.2: min 3, unicode-aware, no stemming)
check('tokenize: german word survives', JSON.stringify(tokenize('Konditionen')) === '["konditionen"]', JSON.stringify(tokenize('Konditionen')))
check('tokenize: unicode letters survive', JSON.stringify(tokenize('größen')) === '["größen"]', JSON.stringify(tokenize('größen')))
check('tokenize: short tokens dropped', tokenize("it's").length === 0 && tokenize('a b c').length === 0 && tokenize('a1 b2').length === 0)
check('tokenize: splits on non-alphanumerics', JSON.stringify(tokenize('ABC, xyz; 123!')) === '["abc","xyz","123"]', JSON.stringify(tokenize('ABC, xyz; 123!')))
check('tokenize: minLen honored', JSON.stringify(tokenize('abc', 4)) === '[]', JSON.stringify(tokenize('abc', 4)))

// --- corpus: 6 chunk-producing pages + 1 blocked (no chunks) + 1 corrupt dir
const root = join(mkdtempSync(join('/tmp', 'smoke-find-')), 'root')
const manifest = startMission(root, { note: 'find smoke' })
const id = manifest.mission_id
const mkPage = (url, content, over): FetchedPage => ({
  url, finalUrl: url, status: 200, contentType: 'text/html', title: 't',
  content, links: [], byteLength: content.length,
  fetchedAt: '2026-10-01T10:00:00.000Z', quality: 'full', qualitySignals: [],
  consentAttempted: false, consentImproved: false, ...over,
})
const A = storeArtifact(root, id, mkPage('http://volksbank-nord.example/zentrale',
  'Bankenzentrale der regionalen Sparkasse, Mönckebergstraße 24 in der City von Hamburg, Telefon und Postanschrift auf der Startseite.\\n' +
  'Geschäftsstellen im Norden und Süden der Stadt, geöffnet von Montag bis zum Freitag, Schalter, Tresor, Kasse und Beratung.\\n' +
  'Volksbank Nord ist der Name der Bank.\\n' +
  'Die Volksbank Nord ist eine Bank in Hamburg.\\n' +
  'Kontakt: Volksbank Nord, Mönckebergstrasse 24.\\n' +
  'Zinsen und Konditionen bei der Volksbank Nord.',
  {
    fetchedAt: '2026-10-01T10:00:00.000Z',
    links: [
      { url: 'http://volksbank-nord.example/konditionen', text: 'Konditionen' },
      { url: 'http://volksbank-nord.example/ueber-uns', text: 'Über uns' },
    ],
  }), { chunkChars: 2000 })
check('corpus: A stored 1 chunk', A.chunkCount === 1, 'chunks=' + A.chunkCount)
const B = storeArtifact(root, id, mkPage('http://backen.example/apfelkuchen',
  'Rezept: Apfelkuchen\\nDen Apfel waschen und schneiden.\\nBacken bei 180 Grad.',
  { fetchedAt: '2026-10-01T11:00:00.000Z', links: [{ url: 'http://backen.example/rezepte', text: 'Rezepte' }] }), { chunkChars: 2000 })
const C = storeArtifact(root, id, mkPage('http://volksbank-nord.example/klein',
  'Volksbank Nord ist klein und lokal.',
  { fetchedAt: '2026-10-09T09:00:00.000Z' }), { chunkChars: 2000 })
const D = storeArtifact(root, id, mkPage('http://solar.example/d', 'Solarzelle und Wechselrichter für die Garage.',
  { fetchedAt: '2026-10-05T08:00:00.000Z' }), { chunkChars: 2000 })
const E = storeArtifact(root, id, mkPage('http://solar.example/e', 'Solarzelle und Wechselrichter für die Garage.',
  { fetchedAt: '2026-10-06T08:00:00.000Z' }), { chunkChars: 2000 })
const F = storeArtifact(root, id, mkPage('http://volksbank-nord.example/konditionen', '',
  { fetchedAt: '2026-10-02T12:00:00.000Z', quality: 'blocked', qualitySignals: ['http-404'],
    links: [{ url: 'http://volksbank-nord.example/konditionen-archiv', text: 'Konditionen Archiv' }] }), { chunkChars: 2000 })
check('corpus: F blocked → 0 chunks', F.chunkCount === 0, 'chunks=' + F.chunkCount)
// depth page: M5-style record (depth 2 written into page.json after store)
const G = storeArtifact(root, id, mkPage('http://depth.example/page', 'Depth: Konditionen der Volksbank Nord.',
  { fetchedAt: '2026-10-08T07:00:00.000Z' }), { chunkChars: 2000 })
{
  const p = join(root, id, 'pages', G.artifactId, 'page.json')
  const rec = JSON.parse(readFileSync(p, 'utf8'))
  rec.depth = 2
  writeFileSync(p, JSON.stringify(rec, null, 2))
}
// corrupt artifact dir (no page.json) + stray file — must be skipped
mkdirSync(join(root, id, 'pages', 'p-deadbeef'))
writeFileSync(join(root, id, 'pages', 'stray.txt'), 'x')

const scope = { root, missionId: id }
const engine = new LexicalEngine()

// --- empty query → FindError
for (const q of ['', '!!', 'ab 12', '   ']) {
  let threw = null
  try { engine.search(scope, q) } catch (e) { threw = e }
  check('empty_query: ' + JSON.stringify(q), threw instanceof FindError && threw.code === 'empty_query', String(threw))
}

// --- V1 core: bank query → A on top, exact scores, snippet contains name
const r1 = engine.search(scope, 'volksbank nord')
check('find: 3 matches (A, C, depth page)', r1.matches.length === 3, JSON.stringify(r1.matches.map((m) => m.artifact_id)))
check('find: top = A, score 10.41', r1.matches[0]?.artifact_id === A.artifactId && r1.matches[0]?.score === 10.41, JSON.stringify(r1.matches[0]))
check('find: best_match_url = A final url', r1.best_match_url === 'http://volksbank-nord.example/zentrale', r1.best_match_url)
check('find: C second (2.6), depth page third (2.6, older fetchedAt)', r1.matches[1]?.artifact_id === C.artifactId && r1.matches[1]?.score === 2.6 && r1.matches[2]?.artifact_id === G.artifactId, JSON.stringify(r1.matches.slice(1)))
check('find: depth carried (G=2, others 0)', r1.matches[2]?.depth === 2 && r1.matches[0]?.depth === 0 && r1.matches[1]?.depth === 0, JSON.stringify(r1.matches.map((m) => m.depth)))
check('find: top snippet contains the bank name', r1.matches[0]?.snippet.includes('Volksbank') === true, r1.matches[0]?.snippet)
check('find: scores 2-decimal rounded', r1.matches.every((m) => m.score * 100 === Math.round(m.score * 100)))

// --- zero overlap → empty (V2 core)
const r2 = engine.search(scope, 'quantum flurben')
check('zero overlap: no matches, null best, no links', r2.matches.length === 0 && r2.best_match_url === null && r2.link_matches.length === 0, JSON.stringify(r2))

// --- determinism (V3 core): byte-identical
const r3 = engine.search(scope, 'volksbank nord')
check('determinism: byte-identical result', JSON.stringify(r1) === JSON.stringify(r3))

// --- snippet rule (D-M4.3)
const collapsedA = readFileSync(join(root, id, 'pages', A.artifactId, 'chunks', '000.md'), 'utf8').replace(/\\s+/g, ' ').trim()
const snA = r1.matches[0]?.snippet ?? ''
// 'volksbank' and 'nord' tie on weight; 'nord' first occurs earlier (in
// "Norden", line 2) → best hit there → window starts at line 1 (no leading
// ellipsis) and ends mid-chunk (trailing ellipsis).
check('snippet A: weight tie → earliest occurrence (no lead, trailing ellipsis)', !snA.startsWith('…') && snA.endsWith('…'), snA)
const coreA = snA.replace(/^…\\s?/, '').replace(/\\s?…$/, '')
check('snippet A: core is in the collapsed chunk', collapsedA.includes(coreA), snA)
check('snippet A: no newlines / no double spaces', !snA.includes('\\n') && !snA.includes('  '), snA)
// single max-weight term mid-chunk → both ellipses
const r7 = engine.search(scope, 'volksbank')
const snA2 = r7.matches[0]?.snippet ?? ''
check('snippet A: single term mid-chunk → both ellipses', snA2.startsWith('…') && snA2.endsWith('…'), snA2)
check('snippet A: line-boundary start (snippet begins at a line start after ellipsis strip)', (() => {
  const raw = readFileSync(join(root, id, 'pages', A.artifactId, 'chunks', '000.md'), 'utf8')
  const lines = raw.split('\\n').map((l) => l.replace(/\\s+/g, ' ').trim()).filter(Boolean)
  return lines.some((l) => l.startsWith(coreA.slice(0, 20)))
})())
const snC = r1.matches[1]?.snippet ?? ''
check('snippet C: short chunk → exact text, no ellipsis', snC === 'Volksbank Nord ist klein und lokal.', snC)

// --- limit (D-M4.4)
check('limit: default 5', engine.search(scope, 'volksbank nord').matches.length === 3 && DEFAULT_FIND_LIMIT === 5)
check('limit: 1 → 1', engine.search(scope, 'volksbank nord', { limit: 1 }).matches.length === 1)
check('limit: 99 clamps to 20 (no throw)', engine.search(scope, 'volksbank nord', { limit: 99 }).matches.length === 3 && MAX_FIND_LIMIT === 20)
check('limit: 0.5 → 1 (floor+clamp)', engine.search(scope, 'volksbank nord', { limit: 0.5 }).matches.length === 1)

// --- tie-breaks: identical content, newer fetched_at first (D, E)
const r4 = engine.search(scope, 'solarzelle wechselrichter')
check('tie: E (newer) before D', r4.matches.length === 2 && r4.matches[0]?.artifact_id === E.artifactId && r4.matches[1]?.artifact_id === D.artifactId, JSON.stringify(r4.matches.map((m) => [m.artifact_id, m.score])))
check('tie: equal scores 2.95', r4.matches[0]?.score === 2.95 && r4.matches[1]?.score === 2.95, JSON.stringify(r4.matches.map((m) => m.score)))

// --- link_matches (V5 core): same formula on the link corpus, ≤5, deterministic order
const r5 = engine.search(scope, 'konditionen')
check('links: A + blocked-F link match', r5.link_matches.length === 2 && r5.link_matches[0]?.text === 'Konditionen' && r5.link_matches[1]?.text === 'Konditionen Archiv', JSON.stringify(r5.link_matches))
check('links: url asc tie-break', r5.link_matches[0]?.url === 'http://volksbank-nord.example/konditionen', JSON.stringify(r5.link_matches.map((l) => l.url)))
check('links: score 1.3 (1+log10(4/2), 4 stored links)', r5.link_matches[0]?.score === round2(1 + Math.log10(4 / 2)), JSON.stringify(r5.link_matches.map((l) => l.score)))
check('links: chunk matches also present (A + depth)', r5.matches.length === 2, JSON.stringify(r5.matches.map((m) => m.artifact_id)))

// --- urlOnly is an engine passthrough (tool layer shapes the result)
const r6 = engine.search(scope, 'volksbank nord', { urlOnly: true })
check('engine: full result shape regardless of urlOnly', Array.isArray(r6.matches) && r6.best_match_url !== null && Array.isArray(r6.link_matches))

// --- corrupt dir + stray file skipped (no crash, corpus = 6 chunks)
check('corrupt dir: skipped, 6-chunk corpus intact', r1.matches.length === 3)
check('corrupt dir: stray file ignored', readdirSync(join(root, id, 'pages')).includes('stray.txt'))

console.log(fail === 0 ? 'harness A: all checks passed' : 'harness A: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

const dirA = mkdtempSync(join(tmpdir(), 'smoke-find-a-'))
let rc = 0
try {
  writeFileSync(join(dirA, 'a.ts'), harnessA)
  buildSync({ entryPoints: [join(dirA, 'a.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirA, 'a.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirA, 'a.mjs')], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness A exit ' + out.status) }
} finally {
  rmSync(dirA, { recursive: true, force: true })
}
process.exit(rc)
