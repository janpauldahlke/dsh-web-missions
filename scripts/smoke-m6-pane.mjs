// M6 6.2 smoke — the pane's display logic (src/client/paneModel.ts), pure
// and DOM-free: quality badge colors, age formatting, the cookie/session
// hint condition (the exact V6 matrix), budget line, artifact shortening.
// paneModel.ts is bundled with esbuild (a devDependency, already used by
// build.mjs) into a temp ESM file and unit-checked — no browser needed.
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const T = mkdtempSync(join(tmpdir(), 'm6-pane-'))
const out = join(T, 'paneModel.mjs')
await build({
  entryPoints: [join(root, 'src', 'client', 'paneModel.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  outfile: out,
})
const m = await import(out)

let fail = 0
let pass = 0
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + label) }
  else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) }
}

const NOW = new Date('2026-10-13T12:00:00Z')
const row = (over) => ({
  normalized_url: 'https://example.com/a',
  url: 'https://Example.com:8080/a',
  artifact_id: 'p-01020304',
  quality: 'full',
  fetched_at: '2026-10-13T10:00:00Z',
  ...over,
})

// --- hostOf (C7: lowercased hostname, no port) --------------------------------
check('hostOf: strips port + lowercases', m.hostOf('https://Example.com:8080/a') === 'example.com', m.hostOf('https://Example.com:8080/a'))
check('hostOf: no port', m.hostOf('http://127.0.0.1:3090/x') === '127.0.0.1')
check('hostOf: garbage → null', m.hostOf('not a url') === null)

// --- qualityBadge (V1 colors) --------------------------------------------------
check('badge full: subtle green', m.qualityBadge('full').level === 'full' && m.qualityBadge('full').color === '#3f6212')
check('badge thin: amber', m.qualityBadge('thin').label === 'thin' && m.qualityBadge('thin').color === '#92400e')
check('badge blocked: red', m.qualityBadge('blocked').level === 'blocked' && m.qualityBadge('blocked').color === '#991b1b')
check('badge unknown: neutral + label kept', m.qualityBadge('weird').level === 'unknown' && m.qualityBadge('weird').label === 'weird')

// --- age (V1 ages) --------------------------------------------------------------
check('age same day → 0/today', m.ageInDays('2026-10-13T01:00:00Z', NOW) === 0 && m.formatAge('2026-10-13T01:00:00Z', NOW) === 'today')
check('age 26h → 1d', m.formatAge('2026-10-12T10:00:00Z', NOW) === '1d', m.formatAge('2026-10-12T10:00:00Z', NOW))
check('age 3d', m.formatAge('2026-10-10T10:00:00Z', NOW) === '3d')
check('age 365d', m.formatAge('2025-10-13T11:00:00Z', NOW) === '365d')
check('age future (clock skew) clamps to today', m.formatAge('2026-10-14T10:00:00Z', NOW) === 'today')
check('age unparseable → today (no crash)', m.formatAge('nonsense', NOW) === 'today')
check('formatTime: HH:MM local shape', /^\d{1,2}:\d{2}$/.test(m.formatTime('2026-10-13T10:00:00Z')), m.formatTime('2026-10-13T10:00:00Z'))
check('formatTime: unparseable → dash', m.formatTime('nonsense') === '—')

// --- artifact shortening --------------------------------------------------------
check('artifact short: p-010203…', m.shortArtifact('p-01020304') === 'p-010203…', m.shortArtifact('p-01020304'))
check('artifact short: short ids untouched', m.shortArtifact('p-ab') === 'p-ab')

// --- budget line (V2) -----------------------------------------------------------
const b = { max: 10, spent: 3, remaining: 7, unit: 'fetch_calls' }
check('budget line 7/10', m.budgetLine(b) === '7/10 fetch_calls')
check('budget exhausted flag', m.budgetExhausted({ max: 2, spent: 2, remaining: 0, unit: 'fetch_calls' }) === true && m.budgetExhausted(b) === false)

// --- session hint (V6 matrix) -----------------------------------------------------
const THIN_HOST_HINT = 'session thin on example.com — export cookies or preload into ~/.dsh/browser39/sessions/example.com/'
check('hint: thin + attempted + NOT improved → exact line (host port-stripped, lowercased)',
  m.sessionHint([row({ quality: 'thin', consent_attempted: true, consent_improved: false })]) === THIN_HOST_HINT,
  m.sessionHint([row({ quality: 'thin', consent_attempted: true, consent_improved: false })]))
check('hint: improved → null', m.sessionHint([row({ quality: 'thin', consent_attempted: true, consent_improved: true })]) === null)
check('hint: attempted false (M5-era row) → null', m.sessionHint([row({ quality: 'thin', consent_improved: false })]) === null)
check('hint: full quality → null', m.sessionHint([row({ quality: 'full', consent_attempted: true, consent_improved: false })]) === null)
check('hint: blocked quality → null', m.sessionHint([row({ quality: 'blocked', consent_attempted: true, consent_improved: false })]) === null)
check('hint: empty rows → null', m.sessionHint([]) === null)
check('hint: first thin+attempted-not-improved wins', m.sessionHint([
  row({ quality: 'thin', consent_attempted: true, consent_improved: false, url: 'https://second.example/' }),
  row({ quality: 'thin', consent_attempted: true, consent_improved: false, url: 'https://First.example/x' }),
]) === 'session thin on second.example — export cookies or preload into ~/.dsh/browser39/sessions/second.example/')
check('hint: non-http url row skipped, later row used', m.sessionHint([
  row({ quality: 'thin', consent_attempted: true, url: 'garbage' }),
  row({ quality: 'thin', consent_attempted: true, url: 'https://ok.example/' }),
]) === 'session thin on ok.example — export cookies or preload into ~/.dsh/browser39/sessions/ok.example/')

// --- verdict ---------------------------------------------------------------------
rmSync(T, { recursive: true, force: true })
if (fail > 0) { console.error('M6 6.2 SMOKE: ' + fail + ' check(s) FAILED'); process.exit(1) }
console.log('M6 6.2 SMOKE: all checks passed (' + pass + ' checks)')
