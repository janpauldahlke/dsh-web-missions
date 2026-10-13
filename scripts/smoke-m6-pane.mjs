// M6 pane smoke (6.2 + 6.3) — the pane's display logic and rendering, pure
// and DOM-free:
//   Part A: paneModel.ts (quality badge colors, age, the cookie/session hint
//     V6 matrix, budget line, artifact shortening), bundled via esbuild into
//     a temp ESM file and unit-checked.
//   Part B: the presentational Board / Detail / Hygiene components SSR'd via
//     react-dom/server against fixture payloads (the mechanical half of
//     V1/V2/V4/V5/V6: sections, badges, budget line, hint line, clear
//     buttons + double-confirm affordance).
// No browser needed; react/react-dom are devDependencies.
import { build } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
// Inside the project so the ESM bundle can resolve external react* from
// node_modules (Node resolves upward from the importing file).
const T = mkdtempSync(join(root, '.tmp-m6-pane-'))
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

// --- render checks (V1/V2/V6 mechanical half) --------------------------------------
// SSR the presentational Board/Detail via react-dom/server against fixture
// payloads (deterministic: ages relative to "now", not a fixed date).
const out2 = join(T, 'paneRender.mjs')
await build({
  entryPoints: [join(root, 'scripts', 'pane-render-entry.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  // react stays external: react-dom/server is CJS with a native require('stream');
  // inlining it into ESM breaks that. Node loads the externals natively.
  external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime'],
  outfile: out2,
})
const R = await import(out2)

// React SSR inserts `<!-- -->` between adjacent text/expression nodes
// (e.g. `3<!-- --> visited`); strip them so checks see the visible text.
const strip = (html) => html.replace(/<!--\s*-->/g, '')

const now = Date.now()
const iso = (msAgo) => new Date(now - msAgo).toISOString()
const day = 86_400_000

const list = {
  active: [{
    mission_id: 'm-aaaa1111', note: 'V10 host breadth', status: 'active',
    started_at: iso(2 * 3600e3), updated_at: iso(2 * 3600e3),
    pages: 3, visited: 3, budget: { max: 5, spent: 3, remaining: 2, unit: 'fetch_calls' },
  }],
  recents: [
    {
      mission_id: 'm-bbbb2222', note: 'stopped one', status: 'stopped',
      started_at: iso(3 * day), updated_at: iso(2 * day),
      pages: 2, visited: 2, budget: { max: 4, spent: 4, remaining: 0, unit: 'fetch_calls' },
    },
    {
      mission_id: 'm-cccc3333', note: 'bare', status: 'stopped',
      started_at: iso(4 * day), updated_at: iso(4 * day),
      pages: 0, visited: 0, budget: null,
    },
  ],
}

const boardHtml = strip(R.renderBoard(list))
check('render board: sections', boardHtml.includes('active (1)') && boardHtml.includes('recent (2)'), boardHtml.slice(0, 200))
check('render board: active row (note + visited + budget remaining/max)',
  boardHtml.includes('V10 host breadth') && boardHtml.includes('3 visited') && boardHtml.includes('2/5 fetch_calls'))
check('render board: recents rows (status + updated + pages)',
  boardHtml.includes('stopped one') && boardHtml.includes('stopped') && boardHtml.includes('0 pages'))
check('render board: null → loading', R.renderBoard(null).includes('loading…'))
check('render board: empty → empty state',
  R.renderBoard({ active: [], recents: [] }).includes('no missions yet'))

const detail = {
  mission_id: 'm-aaaa1111', note: 'V10 host breadth', status: 'active',
  created_at: iso(2 * 3600e3), updated_at: iso(2 * 3600e3),
  budget: { max: 5, spent: 3, remaining: 2, unit: 'fetch_calls' },
  visited: [
    { normalized_url: 'https://example.com/', url: 'https://example.com/', artifact_id: 'p-01020304', quality: 'full', fetched_at: iso(0) },
    { normalized_url: 'https://improved.example/', url: 'https://improved.example/', artifact_id: 'p-0a0b0c0d', quality: 'thin', fetched_at: iso(day), consent_attempted: true, consent_improved: true },
    { normalized_url: 'https://thinhost.example/p', url: 'https://thinhost.example/p', artifact_id: 'p-1a2b3c4d', quality: 'thin', fetched_at: iso(2 * day), consent_attempted: true, consent_improved: false },
  ],
}

const detailHtml = strip(R.renderDetail('m-aaaa1111', detail))
check('render detail: budget line', detailHtml.includes('budget 2/5 fetch_calls'))
check('render detail: hint line (exact, first thin+attempted-not-improved)',
  detailHtml.includes('session thin on thinhost.example — export cookies or preload into ~/.dsh/browser39/sessions/thinhost.example/'))
check('render detail: quality badges', detailHtml.includes('full') && detailHtml.includes('thin'))
check('render detail: consent mark on improved row', detailHtml.includes('✓ consent'))
check('render detail: ages (today/1d/2d)', detailHtml.includes('today') && detailHtml.includes('1d') && detailHtml.includes('2d'))
check('render detail: artifact shortened + full in title', detailHtml.includes('p-010203…') && detailHtml.includes('title="p-01020304"'))
check('render detail: active → stop button', detailHtml.includes('stop mission'))
check('render detail: URL shown', detailHtml.includes('https://thinhost.example/p'))

const stopped = { ...detail, status: 'stopped', stop_reason: 'no reason given', visited: [] }
const stoppedHtml = strip(R.renderDetail('m-aaaa1111', stopped))
check('render detail: stopped → stop reason, NO stop button, no hint',
  stoppedHtml.includes('stopped: no reason given') && !stoppedHtml.includes('stop mission') && !stoppedHtml.includes('session thin on'))
check('render detail: empty visited → empty state', stoppedHtml.includes('no pages yet'))

const noHint = { ...detail, visited: detail.visited.filter((r) => r.consent_improved !== false) }
check('render detail: all improved → no hint', !strip(R.renderDetail('m-aaaa1111', noHint)).includes('session thin on'))

// --- hygiene (V4/V5 affordance: clear recents confirm, clear all double-confirm) ---
const hygieneIdle = R.renderHygiene(null, false)
check('render hygiene: idle → both buttons, not armed',
  hygieneIdle.includes('clear recents') && hygieneIdle.includes('clear all') && !hygieneIdle.includes('click again'))
const hygieneArmed = R.renderHygiene(null, true)
check('render hygiene: armed → double-confirm affordance', hygieneArmed.includes('click again to clear ALL'))
const hygieneNote = R.renderHygiene('cleared all — 3 mission(s), 3 index row(s), 2 session host(s)', false)
check('render hygiene: result note shown', hygieneNote.includes('cleared all — 3 mission(s)'))

// --- verdict ---------------------------------------------------------------------
process.on('exit', () => rmSync(T, { recursive: true, force: true }))
if (fail > 0) { console.error('M6 PANE SMOKE: ' + fail + ' check(s) FAILED'); process.exit(1) }
console.log('M6 PANE SMOKE: all checks passed (' + pass + ' checks)')
