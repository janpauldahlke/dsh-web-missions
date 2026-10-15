// Consent v0 smoke (M5 5.5, C10 tactic seam).
//
// Two harnesses:
//   A — pure logic, bundled into a TOP-LEVEL repo subdir (.smoke-consent/) so
//       import.meta.url resolves exactly like the production bundle
//       (<pkg>/lib/index.js → <pkg>/assets/consent_profiles.toml):
//         parser (valid + malformed → consent_profiles_invalid, line numbers),
//         labelsForHost merge/dedupe, matchLink, isConsentWall, runConsent over
//         a FAKE attempt (threshold stop, all-fail, batch-null, flags),
//         loadConsentProfiles (override precedence, asset fallback, fail-loud),
//         consentNextStepHint wording.
//   B — live transport (real browser39 + local synthetic CMP server, hermetic
//       BROWSER39_SESSIONS_DIR): V5 end-to-end — a thin CMP wall with an
//       "Accept all" link → consent batch improves it; receipt carries
//       consent_attempted:true + consent_improved:true; batch invocations =
//       initial + ≤ consentMaxAttempts (counting BROWSER39_BIN wrapper); the
//       budget is charged exactly ONCE for the whole call.
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
// HARNESS A — pure logic + production asset resolution
// ---------------------------------------------------------------------------
const harnessA = `
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  parseConsentProfiles, loadConsentProfiles, labelsForHost, matchLink,
  isConsentWall, runConsent, consentNextStepHint, TACTICS,
  ConsentProfilesError,
} from '${abs('../src/host/consent.ts')}'

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name) }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')) }
}
const throws = (fn, code, frag) => {
  try { fn(); return null } catch (e) {
    return e
  }
}

// ---- A1 valid parse ---------------------------------------------------------
const valid = [
  '# comment line',
  'generic = [',
  '  "Accept all",',
  '  "Alle akzeptieren",',  // trailing comment after comma
  ']',
  '',
  "[[hosts]]",
  'host = "Kicker.de"',
  'acceptLabels = ["Alle akzeptieren", "Zustimmen"]',
  '',
  "[[hosts]]",
  "host = 'bbc.com'",
  'acceptLabels = ["Yes, I agree"]',
  '',
].join('\\n')
{
  const p = parseConsentProfiles(valid, 'valid.toml')
  ok('A1a parse: generic', p.generic.length === 2 && p.generic[0] === 'Accept all')
  ok('A1b parse: hosts', p.hosts.length === 2)
  ok('A1c parse: host value', p.hosts[0].host === 'Kicker.de')
  ok('A1d parse: acceptLabels', p.hosts[0].acceptLabels.join('|') === 'Alle akzeptieren|Zustimmen')
  ok('A1e parse: literal single-quoted host', p.hosts[1].host === 'bbc.com')
}
{
  const p = parseConsentProfiles('generic = ["a", "b",]\\n', 'tc.toml')
  ok('A1f trailing comma allowed', p.generic.join('|') === 'a|b')
}

// ---- A2 malformed → ConsentProfilesError, code + line number ----------------
const malformedCases = [
  ['unknown top-level key', 'bogus = "x"'],
  ['unknown host key', '[[hosts]]\\nhost = "a.de"\\nfoo = "bar"'],
  ['missing host', '[[hosts]]\\nacceptLabels = ["x"]'],
  ['empty host', '[[hosts]]\\nhost = ""'],
  ['non-string in array', 'generic = [1, 2]'],
  ['unterminated array', 'generic = ["a"'],
  ['missing value', 'generic ='],
  ['bad key', '123abc = "x"'],
  ['bad table name', '[[weird name]]'],
]
for (const [name, text] of malformedCases) {
  const e = throws(() => parseConsentProfiles(text, 'bad.toml'))
  ok('A2 ' + name, e instanceof ConsentProfilesError && e.code === 'consent_profiles_invalid' && /line \\d+/.test(e.message),
     e ? (e.code + ': ' + e.message) : 'did not throw')
}
{
  // line number points at the offending line
  const e = throws(() => parseConsentProfiles('generic = ["a"]\\n\\nbogus = 1', 'ln.toml'))
  ok('A2 line number', e instanceof ConsentProfilesError && /line 3/.test(e.message), e && e.message)
}

// ---- A3 escapes in double-quoted strings ------------------------------------
{
  const p = parseConsentProfiles('generic = ["A\\\\\\\\B", "C\\\\nD", "E\\\\"F"]', 'esc.toml')
  ok('A3a backslash escape', p.generic[0] === 'A\\\\B')
  ok('A3b newline escape', p.generic[1] === 'C\\nD')
  ok('A3c quote escape', p.generic[2] === ['E', '"', 'F'].join(''))
}

// ---- A4 labelsForHost merge + dedupe ----------------------------------------
{
  const p = { generic: ['Accept all', 'Zustimmen'], hosts: [{ host: 'kicker.de', acceptLabels: ['Alle akzeptieren', 'accept ALL'] }] }
  const labels = labelsForHost(p, 'kicker.de')
  ok('A4a host labels first', labels[0] === 'Alle akzeptieren')
  ok('A4b generic appended', labels.includes('Zustimmen'))
  ok('A4c case-insensitive dedupe', labels.filter((l) => l.toLowerCase() === 'accept all').length === 1)
  ok('A4d dedupe keeps first (host) casing', labels.includes('accept ALL') && !labels.includes('Accept all'))
  // host match is case-insensitive
  ok('A4e host match ci', labelsForHost(p, 'KICKER.DE')[0] === 'Alle akzeptieren')
  // unknown host → generic only
  ok('A4f unknown host → generic', labelsForHost(p, 'other.de').join('|') === 'Accept all|Zustimmen')
}

// ---- A5 matchLink ------------------------------------------------------------
{
  const links = [{ url: 'http://x/accept', text: '  Accept All  ' }, { url: 'http://x/no', text: 'No' }]
  const m = matchLink(links, 'accept all')
  ok('A5a ci + trim match', m !== null && m.url === 'http://x/accept')
  ok('A5b no match → null', matchLink(links, 'maybe') === null)
  ok('A5c empty label → null', matchLink(links, '   ') === null)
}

// ---- A6 isConsentWall ---------------------------------------------------------
{
  const thinCmp = { quality: 'thin', qualitySignals: ['text<300chars', 'cmp-marker:cookie'] }
  const thinPlain = { quality: 'thin', qualitySignals: ['text<300chars'] }
  const fullCmp = { quality: 'full', qualitySignals: ['cmp-marker:consent'] }
  ok('A6a thin + cmp → wall', isConsentWall(thinCmp) === true)
  ok('A6b thin no cmp → not wall', isConsentWall(thinPlain) === false)
  ok('A6c full → not wall', isConsentWall(fullCmp) === false)
}

// ---- A7 runConsent over a FAKE attempt ---------------------------------------
const mkPage = (chars, signals) => ({
  url: 'http://x/', finalUrl: 'http://x/', status: 200, contentType: '', title: 't',
  content: 'x'.repeat(chars), links: [], byteLength: chars, fetchedAt: new Date().toISOString(),
  quality: signals ? 'thin' : 'full', qualitySignals: signals ?? [], consentAttempted: false, consentImproved: false,
})
const baseDeps = (overrides) => ({
  host: 'x', url: 'http://x/', labels: ['Accept all', 'Zustimmen'],
  links: [{ url: 'http://x/accept', text: 'Accept all' }],
  thinThreshold: 300, maxAttempts: 2, attempt: async () => ({ clicked: true, page: null }),
  ...overrides,
})
{
  // no labels → not attempted
  const r0 = await runConsent(mkPage(50, ['cmp-marker:cookie']), baseDeps({ labels: [] }))
  ok('A7a no labels → not attempted', r0.outcome.attempted === false && r0.outcome.improved === false)
  ok('A7a2 original page returned', r0.page.content.length === 50)

  // maxAttempts 0 → not attempted
  const r0b = await runConsent(mkPage(50, ['cmp-marker:cookie']), baseDeps({ maxAttempts: 0 }))
  ok('A7b maxAttempts 0 → not attempted', r0b.outcome.attempted === false)

  // first label improves past threshold → improved, stop (only 1 attempt)
  let calls = 0
  const r1 = await runConsent(mkPage(50, ['cmp-marker:cookie']), baseDeps({
    attempt: async (label) => { calls++; return { clicked: true, page: mkPage(5000, null) } },
  }))
  ok('A7c improved', r1.outcome.attempted === true && r1.outcome.improved === true)
  ok('A7d best page kept', r1.page.content.length === 5000)
  ok('A7e flags set', r1.page.consentAttempted === true && r1.page.consentImproved === true)
  ok('A7f stop at threshold (1 attempt)', calls === 1)

  // all clicks fail → not improved, allClicksFailed, original kept
  const r2 = await runConsent(mkPage(50, ['cmp-marker:cookie']), baseDeps({
    links: [], attempt: async (label, linkUrl) => ({ clicked: linkUrl !== null, page: mkPage(40, ['cmp-marker:cookie']) }),
  }))
  ok('A7g all fail → not improved', r2.outcome.improved === false)
  ok('A7h allClicksFailed', r2.outcome.allClicksFailed === true)
  ok('A7i original kept (shorter)', r2.page.content.length === 50)
  ok('A7j flags: attempted, not improved', r2.page.consentAttempted === true && r2.page.consentImproved === false)

  // batch null (spawn failure) → counted, loop continues, allClicksFailed
  const r3 = await runConsent(mkPage(50, ['cmp-marker:cookie']), baseDeps({ attempt: async () => null }))
  ok('A7k batch null → allClicksFailed', r3.outcome.allClicksFailed === true && r3.outcome.improved === false)

  // best-by-char-count across labels (first shorter, second longer)
  let i = 0
  const r4 = await runConsent(mkPage(100, ['cmp-marker:cookie']), baseDeps({
    thinThreshold: 100000, // force both attempts
    attempt: async () => { i++; return { clicked: true, page: mkPage(i === 1 ? 200 : 900, null) } },
  }))
  ok('A7l best by char count', r4.page.content.length === 900 && r4.outcome.improved === true)
}

// ---- A8 consentNextStepHint wording ------------------------------------------
{
  const thin = mkPage(50, ['cmp-marker:cookie'])
  const notAttempted = consentNextStepHint(thin, { attempted: false, improved: false, allClicksFailed: false })
  ok('A8a not attempted → thin hint', /thin/.test(notAttempted))
  const failed = consentNextStepHint(thin, { attempted: true, improved: false, allClicksFailed: true })
  ok('A8b failed → do not claim', /do not claim content from/.test(failed))
  ok('A8b2 failed → preload escape', /preload the accepted cookies/.test(failed))
  const improved = consentNextStepHint(mkPage(4000, null), { attempted: true, improved: true, allClicksFailed: false })
  ok('A8c improved → accept worked', /accept worked/.test(improved))
  ok('A8c2 improved → mission_find', /mission_find/.test(improved))
}

// ---- A9 loadConsentProfiles: override precedence + fail-loud ----------------
{
  const root = mkdtempSync(join(tmpdir(), 'consent-override-'))
  writeFileSync(join(root, 'consent_profiles.toml'), 'generic = ["OverrideOnly"]\\n')
  const ov = loadConsentProfiles(root)
  ok('A9a override wins', ov.generic.join('|') === 'OverrideOnly' && ov.hosts.length === 0)

  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })
  // empty root (no override) → shipped asset (generic vocabulary; hosts optional)
  const asset = loadConsentProfiles(root)
  ok('A9b no override → shipped asset', asset.generic.length > 0)
  ok('A9b2 asset has DE/EN generics', asset.generic.includes('Einverstanden') && asset.generic.includes('Accept all'))

  // malformed override → fail loud
  writeFileSync(join(root, 'consent_profiles.toml'), 'bogus_key = 1\\n')
  const e = throws(() => loadConsentProfiles(root))
  ok('A9c malformed override → fail loud', e instanceof ConsentProfilesError && e.code === 'consent_profiles_invalid',
     e ? (e.code + ': ' + e.message) : 'did not throw')

  rmSync(root, { recursive: true, force: true })
}

// ---- A10 production asset resolution (import.meta.url → repo assets/) -------
{
  // This bundle lives at <repo>/.smoke-consent/harness.mjs, mirroring the
  // production <pkg>/lib/index.js layout — so a missing override must load
  // the real shipped asset from <repo>/assets/consent_profiles.toml.
  const p = loadConsentProfiles('/nonexistent-root-12345')
  ok('A10a production asset resolves', p.generic.length > 0)
  ok('A10b production asset = repo asset', p.generic.includes('Einverstanden') && p.generic.includes('Accept'))
}

// ---- A11 TACTICS seam shape ---------------------------------------------------
{
  ok('A11a TACTICS non-empty', TACTICS.length >= 1)
  ok('A11b v0 = label-click', TACTICS[0].id === 'label-click')
  ok('A11c tactic has run', typeof TACTICS[0].run === 'function')
}

console.log(fail === 0 ? 'smoke-consent A: all checks passed (' + pass + ')' : 'smoke-consent A: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// ---------------------------------------------------------------------------
// HARNESS B — live transport (V5)
// ---------------------------------------------------------------------------
const harnessB = `
import http from 'node:http'
import { Browser39Fetcher } from '${abs('../src/host/fetcher.ts')}'
import { labelsForHost, runConsent, isConsentWall } from '${abs('../src/host/consent.ts')}'

let pass = 0, fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + name) }
  else { fail++; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')) }
}

const FULL = 'Full article body. '.repeat(30) // > 300 chars
const WALL = [
  '<!doctype html><html><head><title>cookie consent</title></head><body>',
  '<p>This site uses cookies (cookie consent).</p>',
  '<a href="/accept">Accept all</a>',
  '</body></html>',
].join('')

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  const cookie = req.headers.cookie ?? ''
  if (url.pathname === '/accept') {
    res.writeHead(302, { 'Set-Cookie': 'consent=accepted; path=/', Location: '/cmp' })
    res.end()
    return
  }
  if (url.pathname === '/cmp') {
    if (/consent=accepted/.test(cookie)) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<!doctype html><html><head><title>Story</title></head><body><p>' + FULL + '</p></body></html>')
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(WALL)
    }
    return
  }
  res.writeHead(404); res.end('nope')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const base = 'http://127.0.0.1:' + port
const url = base + '/cmp'

const fetcher = new Browser39Fetcher({ fetchTimeoutMs: 20000, thinThresholdChars: 300, persistSessions: true })

// B1: initial fetch is a thin CMP wall
const wall = await fetcher.fetch(url, { sessionKey: 'cmp.local' })
ok('B1a initial thin', wall.quality === 'thin', 'quality=' + wall.quality + ' signals=' + wall.qualitySignals.join(','))
ok('B1b cmp marker present', isConsentWall(wall), wall.qualitySignals.join(','))
ok('B1c accept link found', wall.links.some((l) => l.text.toLowerCase() === 'accept all'), JSON.stringify(wall.links))

// B2: consent over a real browser39 batch
const profiles = { generic: ['Accept all'], hosts: [] }
const labels = labelsForHost(profiles, 'cmp.local')
let attempts = 0
const res = await runConsent(wall, {
  host: 'cmp.local', url, labels, links: wall.links,
  thinThreshold: 300, maxAttempts: 2,
  attempt: async (label, linkUrl) => {
    attempts++
    return await fetcher.consentAttempt(url, label, linkUrl, { sessionKey: 'cmp.local' })
  },
})
ok('B2a consent attempted', res.outcome.attempted === true)
ok('B2b consent improved', res.outcome.improved === true, 'signals=' + res.page.qualitySignals.join(',') + ' len=' + res.page.content.length)
ok('B2c page now full', res.page.quality === 'full', 'quality=' + res.page.quality)
ok('B2d flags on page', res.page.consentAttempted === true && res.page.consentImproved === true)
ok('B2e one batch (stopped at threshold)', attempts === 1, 'attempts=' + attempts)

// B3: a SECOND fetch of the same host is already full (cookie persisted in the
//     host session by the consent batch's SIGTERM save) → no wall, no consent.
const again = await fetcher.fetch(url, { sessionKey: 'cmp.local' })
ok('B3a session persisted → full on re-fetch', again.quality === 'full', 'quality=' + again.quality + ' signals=' + again.qualitySignals.join(','))
ok('B3b no consent re-trigger', isConsentWall(again) === false)

server.close()
console.log(fail === 0 ? 'smoke-consent B: all checks passed (' + pass + ')' : 'smoke-consent B: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// ---------------------------------------------------------------------------
// RUN A — pure logic + asset (bundle into a top-level repo subdir)
// ---------------------------------------------------------------------------
const { spawnSync } = await import('node:child_process')
let rc = 1
let outerPass = 0
const ok = (name, cond, detail) => {
  if (cond) { outerPass++; console.log('ok   ' + name) }
  else { rc = 1; console.log('FAIL ' + name + (detail ? ' — ' + detail : '')) }
}

// counting BROWSER39_BIN wrapper (counts every browser39 spawn for the V5 assert)
const work = mkdtempSync(join(tmpdir(), 'smoke-consent-'))
const callLog = join(work, 'b39-calls.log')
writeFileSync(callLog, '')
const wrapper = join(work, 'b39-count.sh')
writeFileSync(wrapper, `#!/bin/sh\necho "call" >> ${JSON.stringify(callLog)}\nexec ${JSON.stringify(platformBin)} "$@"\n`)
chmodSync(wrapper, 0o755)
const callCount = () => {
  const fs = outerRequire('node:fs')
  return fs.readFileSync(callLog, 'utf8').split('\n').filter(Boolean).length
}

const dirA = join(repoRoot, '.smoke-consent')
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
    env: { ...process.env, BROWSER39_SESSIONS_DIR: join(work, 'a-sessions') },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (out.status !== 0) { console.error('harness A exit ' + out.status); rc = 1 }
  else rc = 0
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
    // counting wrapper as BROWSER39_BIN → every spawn is logged
    env: {
      ...process.env,
      BROWSER39_BIN: wrapper,
      BROWSER39_SESSIONS_DIR: join(work, 'b-sessions'),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  if (out.status !== 0) { console.error('harness B exit ' + out.status); rc = 1 }
  else {
    // V5 budget/invocation invariant: the whole consent flow = initial fetch +
    //   ≤ consentMaxAttempts consent batches. Here: 1 initial + 1 consent batch
    //   (stopped at threshold) + 1 persisted re-fetch = 3 browser39 spawns.
    const calls = callCount()
    ok('B4 batch invocations bounded', calls === 3, 'browser39 spawns=' + calls + ' (want 3: initial + 1 consent + 1 re-fetch)')
  }
} catch (e) {
  console.error('harness B build/run error: ' + (e && e.stack || e))
  rc = 1
} finally {
  rmSync(work, { recursive: true, force: true })
}

process.exit(rc)
