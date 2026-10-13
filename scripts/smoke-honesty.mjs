// Honesty gate + maxBytes smoke (M5 5.6).
//
// Two harnesses:
//   A — pure logic (no network, fake fetcher + deterministic fake browser39
//       binary):
//         honesty gate — every fresh/hit/consent thin|blocked receipt carries
//         the deterministic DO_NOT_CLAIM text in next_step_hint; full receipts
//         never do (the receipt choke point enforces it, not each hint path);
//         truncateToBytes — byte-exact UTF-8 char-boundary truncation matrix;
//         Browser39Fetcher + fake watch binary — maxBytes cap applied in
//         toFetchedPage (signal `truncated`, byteLength capped, valid UTF-8).
//   B — live transport (real browser39 + local server, hermetic sessions):
//         V7 — fetch a 404 → blocked receipt, hint carries do-not-claim;
//         V8 — maxBytes truncation on a large page → quality_signals contains
//         `truncated`, stored content ≤ limit;
//         live thin page (no CMP) + its cache hit both carry the gate text.
//
// Exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const abs = (p) => join(here, p).split(/[\\/]/).join('/')
const outerRequire = createRequire(import.meta.url)

// --- locate the real platform binary -----------------------------------------
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

// ---------------------------------------------------------------------------
// HARNESS A — pure logic (honesty matrix + truncation)
// ---------------------------------------------------------------------------
const harnessA = `
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DO_NOT_CLAIM } from '${abs('../src/shared/types.ts')}'
import { runFetch } from '${abs('../src/host/fetch-service.ts')}'
import { startMission } from '${abs('../src/host/store.ts')}'
import { readArtifact } from '${abs('../src/host/artifacts.ts')}'
import { Browser39Fetcher, truncateToBytes } from '${abs('../src/host/fetcher.ts')}'

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name) }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')) }
}

// ---- A: honesty gate over runFetch (fake fetcher, no browser39) -------------
const root = mkdtempSync(join(tmpdir(), 'honesty-root-'))
writeFileSync(join(root, 'config.json'), JSON.stringify({ allowlist: 'off' }))
const mission = startMission(root, { note: 'honesty smoke' })
const mid = mission.mission_id
const H = 'http://fake.local'

// each page carries its own url/finalUrl (rows collapse onto finalUrl)
const mkPage = (u, over = {}) => ({
  url: u, finalUrl: u, status: 200, contentType: '', title: 't',
  content: 'x'.repeat(500), links: [], byteLength: 500,
  fetchedAt: new Date().toISOString(),
  quality: 'full', qualitySignals: [], consentAttempted: false, consentImproved: false,
  ...over,
})
const mkFetcher = (page, consentPage) => ({
  fetch: async () => page,
  ...(consentPage !== undefined ? { consentAttempt: async () => ({ clicked: true, page: consentPage }) } : {}),
})
const thinCmp = { quality: 'thin', qualitySignals: ['text<300chars', 'cmp-marker:cookie'] }

// A1 fresh thin
{
  const r = await runFetch(root, mkFetcher(mkPage(H + '/t1', { ...thinCmp, content: 'x'.repeat(50) })), { url: H + '/t1', mission_id: mid })
  ok('A1a fresh thin → quality thin', r.page_quality === 'thin')
  ok('A1b fresh thin → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A2 fresh blocked (404)
{
  const r = await runFetch(root, mkFetcher(mkPage(H + '/t2', { status: 404, quality: 'blocked', qualitySignals: ['http-404'], content: 'nope' })), { url: H + '/t2', mission_id: mid })
  ok('A2a fresh blocked → quality blocked', r.page_quality === 'blocked')
  ok('A2b fresh blocked → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A3 fresh full
{
  const r = await runFetch(root, mkFetcher(mkPage(H + '/t3')), { url: H + '/t3', mission_id: mid })
  ok('A3 fresh full → no do-not-claim', !r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A4 hit thin (cache hit on the thin page)
{
  const r = await runFetch(root, mkFetcher(mkPage(H + '/t1')), { url: H + '/t1', mission_id: mid })
  ok('A4a hit thin → cached', r.cached === true)
  ok('A4b hit thin → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A5 hit blocked
{
  const r = await runFetch(root, mkFetcher(mkPage(H + '/t2')), { url: H + '/t2', mission_id: mid })
  ok('A5 hit blocked → do-not-claim', r.cached === true && r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A6 hit full
{
  const r = await runFetch(root, mkFetcher(mkPage(H + '/t3')), { url: H + '/t3', mission_id: mid })
  ok('A6 hit full → no do-not-claim', r.cached === true && !r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A7 consent attempted, wall persists (still thin)
{
  const initial = mkPage(H + '/t4', { ...thinCmp, content: 'x'.repeat(50) })
  const failed = mkPage(H + '/t4', { ...thinCmp, content: 'x'.repeat(40), consentAttempted: true, consentImproved: false })
  const r = await runFetch(root, mkFetcher(initial, failed), { url: H + '/t4', mission_id: mid })
  ok('A7a consent attempted, not improved', r.consent_attempted === true && r.consent_improved === false, 'attempted=' + r.consent_attempted + ' improved=' + r.consent_improved)
  ok('A7b consent failed → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A8 consent improved but still thin
{
  const initial = mkPage(H + '/t5', { ...thinCmp, content: 'x'.repeat(50) })
  const partial = mkPage(H + '/t5', { quality: 'thin', qualitySignals: ['still-small'], content: 'x'.repeat(400), consentAttempted: true, consentImproved: true })
  const r = await runFetch(root, mkFetcher(initial, partial), { url: H + '/t5', mission_id: mid })
  ok('A8a improved but thin', r.consent_improved === true && r.page_quality === 'thin')
  ok('A8b improved-but-thin → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// A9 consent improved to full
{
  const initial = mkPage(H + '/t6', { ...thinCmp, content: 'x'.repeat(50) })
  const full = mkPage(H + '/t6', { content: 'x'.repeat(5000), consentAttempted: true, consentImproved: true })
  const r = await runFetch(root, mkFetcher(initial, full), { url: H + '/t6', mission_id: mid })
  ok('A9a improved to full', r.consent_improved === true && r.page_quality === 'full')
  ok('A9b improved to full → no do-not-claim', !r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
rmSync(root, { recursive: true, force: true })

// ---- B: truncateToBytes — byte-exact, char-boundary safe ---------------------
{
  const ascii = 'a'.repeat(10)
  ok('B1 within cap → unchanged', (() => { const t = truncateToBytes(ascii, 10); return !t.truncated && t.content === ascii && t.bytes === 10 })())
  ok('B2 over cap → cut', truncateToBytes(ascii, 7).content === 'aaaaaaa' && truncateToBytes(ascii, 7).bytes === 7)
  // two-byte char: é = C3 A9. 3×é = 6 bytes.
  const acc = 'ééé'
  const t5 = truncateToBytes(acc, 5)
  ok('B3 cut inside 2-byte char steps back', t5.truncated && t5.content === 'éé' && t5.bytes === 4, 'got ' + JSON.stringify(t5.content))
  ok('B4 cap 1 on é → empty', truncateToBytes('é', 1).content === '' && truncateToBytes('é', 1).truncated)
  ok('B5 cap 2 on é → exact', !truncateToBytes('é', 2).truncated && truncateToBytes('é', 2).content === 'é')
  // four-byte char: 😀 = F0 9F 98 80
  const gr = 'ab😀' // 2 + 4 = 6 bytes
  const t1 = truncateToBytes(gr, 1)
  const t3 = truncateToBytes(gr, 3)
  ok('B6 cut before 4-byte char', t1.content === 'a' && t1.bytes === 1 && t3.content === 'ab' && t3.bytes === 2)
  ok('B7 cap 6 on ab😀 → exact', !truncateToBytes(gr, 6).truncated)
  ok('B8 empty content, cap 0 → not truncated', !truncateToBytes('', 0).truncated && truncateToBytes('', 0).bytes === 0)
  // mixed: boundary lands mid-sequence → valid UTF-8 prefix, no replacement char
  const mixed = 'aaéb' // 2 + 2 + 1 = 5 bytes
  const t4 = truncateToBytes(mixed, 4)
  ok('B9 mixed boundary', t4.truncated && t4.content === 'aaé' && t4.bytes === 4, 'got ' + JSON.stringify(t4.content))
  ok('B10 no U+FFFD anywhere', !t4.content.includes('\\uFFFD') && !truncateToBytes(mixed, 3).content.includes('\\uFFFD'))
}

// ---- C: Browser39Fetcher + fake watch binary — cap in toFetchedPage ----------
// The fake (path via BROWSER39_BIN, set by the outer runner) always emits
// markdown = 100000 × 'B' + 'é' = 100001 bytes / 100001 chars.
const fakeFetcher = (maxBytes) => new Browser39Fetcher({ maxBytes, persistSessions: false, fetchTimeoutMs: 15000 })
{
  const full = await fakeFetcher(undefined).fetch('http://big.local/')
  ok('C1 default cap (2MB) → no truncation', !full.qualitySignals.includes('truncated') && full.content.length === 100001 && full.byteLength === 100002,
     'len=' + full.content.length + ' bytes=' + full.byteLength + ' signals=' + full.qualitySignals.join(','))
  ok('C1b quality full', full.quality === 'full')

  // cut lands exactly on the é lead byte (0xC3, not a continuation byte) → keep 100000 B's
  const t100k = await fakeFetcher(100000).fetch('http://big.local/')
  ok('C2 cap 100000 → cut at é lead byte', t100k.qualitySignals.includes('truncated') && t100k.content.length === 100000 && t100k.byteLength === 100000,
     'len=' + t100k.content.length + ' bytes=' + t100k.byteLength)
  ok('C2b valid UTF-8 prefix (all B)', /^B*$/.test(t100k.content))

  // cut lands on the é continuation byte (0xA9) → steps back to the lead byte
  const t100001 = await fakeFetcher(100001).fetch('http://big.local/')
  ok('C3 cap 100001 → step back over continuation byte', t100001.qualitySignals.includes('truncated') && t100001.content.length === 100000 && t100001.byteLength === 100000,
     'len=' + t100001.content.length + ' bytes=' + t100001.byteLength)

  const t99999 = await fakeFetcher(99999).fetch('http://big.local/')
  ok('C4 cap 99999 → cut mid-B-run', t99999.qualitySignals.includes('truncated') && t99999.content.length === 99999 && t99999.byteLength === 99999,
     'len=' + t99999.content.length + ' bytes=' + t99999.byteLength)

  // the cap is what gets STORED — round-trip through the artifact store
  const root2 = mkdtempSync(join(tmpdir(), 'honesty-store-'))
  writeFileSync(join(root2, 'config.json'), JSON.stringify({ allowlist: 'off' }))
  const m2 = startMission(root2, { note: 'store cap' })
  const r = await runFetch(root2, fakeFetcher(100000), { url: 'http://big.local/store', mission_id: m2.mission_id })
  ok('C5 receipt signals', r.quality_signals.includes('truncated'), r.quality_signals.join(','))
  const stored = readArtifact(root2, m2.mission_id, r.artifact_id)
  ok('C6 stored content ≤ cap', stored.page.content.length <= 100000 && Buffer.byteLength(stored.page.content, 'utf8') <= 100000,
     'len=' + stored.page.content.length)
  ok('C7 stored content capped at 100000', stored.page.content.length === 100000)
  rmSync(root2, { recursive: true, force: true })
}

console.log(fail === 0 ? 'smoke-honesty A: all checks passed (' + pass + ')' : 'smoke-honesty A: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// ---------------------------------------------------------------------------
// HARNESS B — live transport (V7 honesty on 404, V8 maxBytes, live thin)
// ---------------------------------------------------------------------------
const harnessB = `
import http from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DO_NOT_CLAIM } from '${abs('../src/shared/types.ts')}'
import { runFetch } from '${abs('../src/host/fetch-service.ts')}'
import { startMission } from '${abs('../src/host/store.ts')}'
import { readArtifact } from '${abs('../src/host/artifacts.ts')}'
import { Browser39Fetcher } from '${abs('../src/host/fetcher.ts')}'

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name) }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')) }
}

const THIN = '<!doctype html><html><head><title>Short</title></head><body><p>just a little text, nothing else.</p></body></html>'
const BIG_BODY = 'lorem ipsum dolor sit amet '.repeat(15000) // ~405 KB
const BIG = '<!doctype html><html><head><title>Big</title></head><body><p>' + BIG_BODY + '</p></body></html>'

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  if (url.pathname === '/404') { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('nope'); return }
  if (url.pathname === '/thin') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(THIN); return }
  if (url.pathname === '/big') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(BIG); return }
  res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<p>ok</p>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port

const root = mkdtempSync(join(tmpdir(), 'honesty-live-'))
writeFileSync(join(root, 'config.json'), JSON.stringify({ allowlist: 'off' }))
const mission = startMission(root, { note: 'honesty live' })
const mid = mission.mission_id

// B1 (V7): 404 → blocked receipt carries the do-not-claim text
{
  const r = await runFetch(root, new Browser39Fetcher({ fetchTimeoutMs: 20000, persistSessions: false }), { url: base + '/404', mission_id: mid })
  ok('B1a 404 → blocked', r.page_quality === 'blocked', 'quality=' + r.page_quality + ' signals=' + r.quality_signals.join(','))
  ok('B1b 404 → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
  ok('B1c http-404 signal', r.quality_signals.includes('http-404'), r.quality_signals.join(','))
}
// B2 (V8): large page + small cap → truncated, stored ≤ cap
{
  const r = await runFetch(root, new Browser39Fetcher({ fetchTimeoutMs: 30000, persistSessions: false, maxBytes: 50000 }), { url: base + '/big', mission_id: mid })
  ok('B2a large page → truncated signal', r.quality_signals.includes('truncated'), r.quality_signals.join(','))
  ok('B2b still full', r.page_quality === 'full', 'quality=' + r.page_quality)
  const stored = readArtifact(root, mid, r.artifact_id)
  ok('B2c stored content ≤ cap', Buffer.byteLength(stored.page.content, 'utf8') <= 50000, 'bytes=' + Buffer.byteLength(stored.page.content, 'utf8'))
  ok('B2d stored content actually large', stored.page.content.length >= 40000, 'len=' + stored.page.content.length)
}
// B3: live thin page (no CMP) → thin receipt carries the gate text
{
  const r = await runFetch(root, new Browser39Fetcher({ fetchTimeoutMs: 20000, persistSessions: false }), { url: base + '/thin', mission_id: mid })
  ok('B3a thin', r.page_quality === 'thin', 'quality=' + r.page_quality + ' signals=' + r.quality_signals.join(','))
  ok('B3b thin → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}
// B4: cache hit on the thin page → gate text on the hit receipt too
{
  const r = await runFetch(root, new Browser39Fetcher({ fetchTimeoutMs: 20000, persistSessions: false }), { url: base + '/thin', mission_id: mid })
  ok('B4a cached hit', r.cached === true)
  ok('B4b hit thin → do-not-claim', r.next_step_hint.includes(DO_NOT_CLAIM), r.next_step_hint)
}

server.close()
rmSync(root, { recursive: true, force: true })
console.log(fail === 0 ? 'smoke-honesty B: all checks passed (' + pass + ')' : 'smoke-honesty B: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// ---------------------------------------------------------------------------
// RUN A — pure logic (bundle into a top-level repo subdir; fake b39 binary)
// ---------------------------------------------------------------------------
const { spawnSync } = await import('node:child_process')
let rc = 1

const work = mkdtempSync(join(tmpdir(), 'smoke-honesty-'))

// fake watch binary: emits one deterministic result line for id f1 —
// markdown = 100000 × 'B' + é (U+00E9, 2 bytes) = 100002 bytes / 100001 chars.
const fakeBin = join(work, 'b39-fake.sh')
writeFileSync(
  fakeBin,
  [
    '#!/bin/sh',
    'out=""',
    'while [ $# -gt 0 ]; do',
    '  case "$1" in',
    '    --output) out="$2"; shift 2 ;;',
    '    *) shift ;;',
    '  esac',
    'done',
    'big=$(head -c 100000 /dev/zero | tr "\\\\0" "B")',
    'acc=$(printf "\\\\303\\\\251")',
    'printf \'{"id":"f1","ok":true,"url":"http://big.local/","status":200,"title":"Big","markdown":"%s%s","links":[]}\\n\' "$big" "$acc" > "$out"',
    'exit 0',
    '',
  ].join('\n'),
)
chmodSync(fakeBin, 0o755)

const dirA = join(repoRoot, '.smoke-honesty')
try {
  rmSync(dirA, { recursive: true, force: true })
  mkdirSync(dirA, { recursive: true })
  writeFileSync(join(dirA, 'harness.ts'), harnessA)
  buildSync({
    entryPoints: [join(dirA, 'harness.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: join(dirA, 'harness.mjs'),
    absWorkingDir: here,
  })
  const out = spawnSync(process.execPath, [join(dirA, 'harness.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BROWSER39_BIN: fakeBin,
      BROWSER39_SESSIONS_DIR: join(work, 'a-sessions'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  rc = out.status === 0 ? 0 : 1
  if (out.status !== 0) console.error('harness A exit ' + out.status)
} catch (e) {
  console.error('harness A build/run error: ' + (e && e.stack || e))
  rc = 1
} finally {
  rmSync(dirA, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// RUN B — live transport (bundle into a temp dir, hermetic sessions)
// ---------------------------------------------------------------------------
try {
  writeFileSync(join(work, 'harnessB.ts'), harnessB)
  buildSync({
    entryPoints: [join(work, 'harnessB.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: join(work, 'harnessB.mjs'),
    absWorkingDir: here,
  })
  const out = spawnSync(process.execPath, [join(work, 'harnessB.mjs')], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BROWSER39_BIN: platformBin,
      BROWSER39_SESSIONS_DIR: join(work, 'b-sessions'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (out.status !== 0) { console.error('harness B exit ' + out.status); rc = 1 }
  else if (rc === 0) rc = 0
} catch (e) {
  console.error('harness B build/run error: ' + (e && e.stack || e))
  rc = 1
} finally {
  rmSync(work, { recursive: true, force: true })
}

process.exit(rc)
