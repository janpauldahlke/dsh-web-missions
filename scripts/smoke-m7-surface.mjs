// M7 core-surface smoke (hermetic): the one-way discovery bridge.
//   dsh-local-web-discovery (companion) WRITES <mission>/discovery.json via
//   its recordDiscovery; the core READS it — missionStatus surfaces
//   `discovery: {updated_at, urls}` when present, omits the field when
//   absent, and fails loud (StoreError corrupt) on bad data. No engine code
//   in the core (V5 boundary): this is the entire M7 core surface.
import { build } from 'esbuild'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const T = mkdtempSync(join(root, '.tmp-m7-surface-'))
const out = join(T, 'store.mjs')
await build({
  entryPoints: [join(root, 'src', 'host', 'store.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  outfile: out,
})
const core = await import(out)
// The real companion store (sibling package, prebuilt lib):
const disc = await import('/home/hagbard/dev/dsh-web-discovery/lib/discovery.mjs')

let pass = 0
let fail = 0
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('ok   ' + label) }
  else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) }
}
const J = (v) => JSON.stringify(v)

const cwd = join(T, 'proj')
const missionRoot = join(cwd, '.dsh', 'web-missions')

// --- absent → field omitted ----------------------------------------------------
const manifest = core.startMission(missionRoot, { note: 'm7 bridge test' })
const id = manifest.mission_id
const st0 = core.missionStatus(missionRoot, id)
check('absent: no discovery field (not null, not [])', !('discovery' in st0), J(Object.keys(st0)))

// --- companion writes → core surfaces ------------------------------------------
const missionDir = join(missionRoot, id)
const via = { query: 'rust async runtime', engine: 'browser39', at: '2026-10-13T14:40:00.000Z' }
disc.recordDiscovery(missionDir, [
  { url: 'https://tokio.rs/', title: 'Tokio', snippet: 'an asynchronous Rust runtime' },
  { url: 'https://actix.rs/' },
], via)
const st1 = core.missionStatus(missionRoot, id)
check('present: discovery field surfaced', st1.discovery !== undefined && typeof st1.discovery.updated_at === 'string', J(st1.discovery))
check('present: urls verbatim (url/title/snippet/via)', st1.discovery.urls.length === 2 && st1.discovery.urls[0].url === 'https://tokio.rs/' && st1.discovery.urls[0].title === 'Tokio' && st1.discovery.urls[0].snippet === 'an asynchronous Rust runtime' && st1.discovery.urls[0].via.query === via.query && st1.discovery.urls[0].via.engine === 'browser39', J(st1.discovery?.urls))
check('present: updated_at from the companion write', st1.discovery.updated_at === via.at)

// --- companion dedup → core sees the merged file --------------------------------
disc.recordDiscovery(missionDir, [
  { url: 'HTTPS://TOKIO.rs/', title: 'should not duplicate' },
  { url: 'https://smol-rs.github.io/', title: 'smol' },
], { query: 'smol futures', engine: 'searxng', at: '2026-10-13T15:00:00.000Z' })
const st2 = core.missionStatus(missionRoot, id)
check('merge: 3 urls, first-seen provenance kept', st2.discovery.urls.length === 3 && st2.discovery.urls[0].via.query === via.query && st2.discovery.urls[2].url === 'https://smol-rs.github.io/', J(st2.discovery?.urls.map((u) => u.url)))
check('merge: updated_at refreshed', st2.discovery.updated_at === '2026-10-13T15:00:00.000Z')

// --- D-M7.4: discovery rows are NOT ledger rows ---------------------------------
check('not ledger rows: visited stays empty, budget untouched', st2.visited.length === 0 && st2.budget.spent === 0 && st2.budget.remaining === st2.budget.max, J({ visited: st2.visited.length, budget: st2.budget }))

// --- corrupt / bad shape → fail loud --------------------------------------------
writeFileSync(join(missionDir, 'discovery.json'), '{broken')
let code = null
try { core.missionStatus(missionRoot, id) } catch (e) { code = e.code ?? e.message }
check('corrupt JSON → StoreError corrupt', code === 'corrupt', String(code))
writeFileSync(join(missionDir, 'discovery.json'), JSON.stringify({ foo: 1 }))
try { core.missionStatus(missionRoot, id) } catch (e) { code = e.code ?? e.message }
check('bad shape (no urls[]) → StoreError corrupt', code === 'corrupt', String(code))
writeFileSync(join(missionDir, 'discovery.json'), JSON.stringify({ updated_at: 'x', urls: [{ noUrl: true }] }))
try { core.missionStatus(missionRoot, id) } catch (e) { code = e.code ?? e.message }
check('bad urls[] entry (no url) → StoreError corrupt', code === 'corrupt', String(code))

// --- removed → field omitted again ----------------------------------------------
rmSync(join(missionDir, 'discovery.json'))
const st3 = core.missionStatus(missionRoot, id)
check('removed: field omitted again', !('discovery' in st3))

rmSync(T, { recursive: true, force: true })
if (fail > 0) { console.error('M7 SURFACE SMOKE: ' + fail + ' check(s) FAILED'); process.exit(1) }
console.log('M7 SURFACE SMOKE: all checks passed (' + pass + ' checks) — core discovery bridge green')
