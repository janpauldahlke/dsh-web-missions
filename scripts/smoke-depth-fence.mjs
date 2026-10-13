// Depth fence smoke (M5 slice 5.3 — the crawl boundary, D-M5.7/D-M5.8, host law):
//   A) service level (tmpdir bundles, fake fetcher with link control — zero
//      real spawns):
//      hostKey (lowercase, no port), manifestSeeds (M2-era → []), seedHosts,
//      discoveredHosts (seed hosts exempt), deterministic lineage (seed = 0,
//      fresh root = 0, row depth, row.depth+1 over stored links.json, min over
//      ALL parents, tie-break lexicographic artifact id, M2-era rows → 0,
//      seed wins over a deeper link), gate (maxDepth pass/exceed with the
//      exact plan message + hint, maxDiscoveredHosts pass/exceed with the
//      exact plan message, seed-host exemption, known-host pass, fresh roots
//      COUNT as discovered hosts — D-M5.8, maxDepth:0 still admits fresh
//      roots), mission_start seeds (normalized + deduped, bad seed →
//      normalize_failed, absent → no key), runFetch integration:
//      V9 depth chain (0 → 1 → 2-refused, zero-cost refusal, row + page.json
//      + status persistence of depth/parent), V10 host width (seed exempt,
//      3rd non-seed host refused, hit not re-gated), gate order (allowlist
//      before fence, fence before budget), hits carry the stored lineage and
//      force re-gates.
//   B) tool level (BUILT lib, real browser39 + local HTTP servers on
//      127.0.0.1 and localhost): mission_start seeds via tool, real link
//      extraction drives depth 0 → 1, depth_exceeded envelope with zero
//      spawn + zero charge, new-host admission under maxDiscoveredHosts,
//      known-host pass, [::1] 2nd-new-host refusal (host_breadth_exceeded),
//      hit receipt carries stored depth, mission_status rows carry
//      depth + parent_artifact_id.
// Exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
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

// --- Harness A: service level (fake fetcher with link control) ----------------
const harnessA = `
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { runFetch } from '${abs('../src/host/fetch-service.ts')}'
import { startMission, readManifest, missionStatus, StoreError } from '${abs('../src/host/store.ts')}'
import { configPath } from '${abs('../src/host/config.ts')}'
import { checkDepthFence, computeLineage, hostKey, seedHosts, discoveredHosts, manifestSeeds, FENCE_HINT } from '${abs('../src/host/depth-fence.ts')}'
import { normalizeUrl } from '${abs('../src/host/normalize.ts')}'
import type { FetchedPage } from '${abs('../shared/types.ts')}'

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }
const expectErr = async (label, fn, code, part) => {
  try { await fn(); check(label, false, 'did not throw') }
  catch (e) { check(label, e instanceof StoreError && e.code === code && e.message.includes(part), (e && e.code) + ' :: ' + e.message) }
}

const ISO = new Date().toISOString()
const mkRow = (over) => ({
  normalized_url: '',
  url: '',
  artifact_id: 'p-xxx',
  quality: 'full',
  fetched_at: ISO,
  ...over,
})
const mkManifest = (over) => ({
  mission_id: 'm-test',
  note: 't',
  budget: { max: 10 },
  status: 'active',
  created_at: ISO,
  updated_at: ISO,
  fetched: [],
  ...over,
})

const rootP = join(mkdtempSync(join('/tmp', 'smoke-fence-pure-')), 'root')
const mdir = join(rootP, 'm-test')
mkdirSync(join(mdir, 'pages'), { recursive: true })
const links = (artifact, urls) => {
  mkdirSync(join(mdir, 'pages', artifact), { recursive: true })
  writeFileSync(join(mdir, 'pages', artifact, 'links.json'), JSON.stringify(urls.map((u) => ({ url: u, text: 't' }))))
}
const n = normalizeUrl

// --- hostKey / seeds / discovered hosts
check('hostKey: lowercase + no port', hostKey('http://A.Example:8080/x') === 'a.example', hostKey('http://A.Example:8080/x'))
check('manifestSeeds: M2-era manifest → []', JSON.stringify(manifestSeeds(mkManifest({}))) === '[]')
check('manifestSeeds: present', manifestSeeds(mkManifest({ seeds: ['http://a.example/s'] })).length === 1)
{
  const m = mkManifest({
    seeds: [n('http://a.example/s')],
    fetched: [
      mkRow({ normalized_url: n('http://a.example/1'), url: 'http://a.example/1', artifact_id: 'p-1' }),
      mkRow({ normalized_url: n('http://b.example/1'), url: 'http://b.example/1', artifact_id: 'p-2' }),
      mkRow({ normalized_url: n('http://c.example/1'), url: 'http://c.example/1', artifact_id: 'p-3' }),
    ],
  })
  check('seedHosts: only the seed host', JSON.stringify([...seedHosts(m)]) === JSON.stringify(['a.example']), JSON.stringify([...seedHosts(m)]))
  check('discoveredHosts: seed host exempt', JSON.stringify([...discoveredHosts(m)].sort()) === JSON.stringify(['b.example', 'c.example']), JSON.stringify([...discoveredHosts(m)]))
}

// --- deterministic lineage
check('L1: seed → 0/null', JSON.stringify(computeLineage(rootP, mkManifest({ seeds: [n('http://a.example/seed')] }), 'http://a.example/seed')) === JSON.stringify({ depth: 0, parent_artifact_id: null }))
check('L2: fresh root → 0/null', JSON.stringify(computeLineage(rootP, mkManifest({}), 'http://nowhere.example/1')) === JSON.stringify({ depth: 0, parent_artifact_id: null }))
{
  const rowA = mkRow({ normalized_url: n('http://a.example/a'), url: 'http://a.example/a', artifact_id: 'p-aaa', depth: 0, parent_artifact_id: null })
  links('p-aaa', ['http://a.example/b'])
  const m = mkManifest({ fetched: [rowA] })
  check('L3: linked from depth-0 row → 1/parent', JSON.stringify(computeLineage(rootP, m, 'http://a.example/b')) === JSON.stringify({ depth: 1, parent_artifact_id: 'p-aaa' }))
  const rowB = mkRow({ normalized_url: n('http://a.example/b'), url: 'http://a.example/b', artifact_id: 'p-bbb', depth: 1, parent_artifact_id: 'p-aaa' })
  links('p-bbb', ['http://a.example/c'])
  check('L4: chain → 2/nearest parent', JSON.stringify(computeLineage(rootP, mkManifest({ fetched: [rowA, rowB] }), 'http://a.example/c')) === JSON.stringify({ depth: 2, parent_artifact_id: 'p-bbb' }))
}
{
  const rowA = mkRow({ normalized_url: n('http://a.example/a'), url: 'http://a.example/a', artifact_id: 'p-aaa', depth: 0, parent_artifact_id: null })
  links('p-aaa', ['http://a.example/b'])
  const rowZ = mkRow({ normalized_url: n('http://z.example/z'), url: 'http://z.example/z', artifact_id: 'p-zzz', depth: 5, parent_artifact_id: 'p-y' })
  links('p-zzz', ['http://a.example/b'])
  check('L5: min over parents (1 beats 6)', JSON.stringify(computeLineage(rootP, mkManifest({ fetched: [rowA, rowZ] }), 'http://a.example/b')) === JSON.stringify({ depth: 1, parent_artifact_id: 'p-aaa' }))
}
{
  const rowU = mkRow({ normalized_url: n('http://a.example/u'), url: 'http://a.example/u', artifact_id: 'p-r2', depth: 2, parent_artifact_id: 'p-r1' })
  const rowX = mkRow({ normalized_url: n('http://a.example/x'), url: 'http://a.example/x', artifact_id: 'p-xxx', depth: 0, parent_artifact_id: null })
  links('p-xxx', ['http://a.example/u'])
  check('L6: stored row (2) vs link (1) → min 1', JSON.stringify(computeLineage(rootP, mkManifest({ fetched: [rowU, rowX] }), 'http://a.example/u')) === JSON.stringify({ depth: 1, parent_artifact_id: 'p-xxx' }))
}
{
  const rowM2 = mkRow({ normalized_url: n('http://a.example/v'), url: 'http://a.example/v', artifact_id: 'p-m2' }) // no depth field
  links('p-m2', ['http://a.example/w'])
  const m = mkManifest({ fetched: [rowM2] })
  check('L7: M2-era row → 0/null', JSON.stringify(computeLineage(rootP, m, 'http://a.example/v')) === JSON.stringify({ depth: 0, parent_artifact_id: null }))
  check('L7: link off a depthless row → 1', JSON.stringify(computeLineage(rootP, m, 'http://a.example/w')) === JSON.stringify({ depth: 1, parent_artifact_id: 'p-m2' }))
}
{
  const rowA = mkRow({ normalized_url: n('http://a.example/a'), url: 'http://a.example/a', artifact_id: 'p-aaa', depth: 0, parent_artifact_id: null })
  links('p-aaa', ['http://a.example/t'])
  const rowB = mkRow({ normalized_url: n('http://a.example/b'), url: 'http://a.example/b', artifact_id: 'p-bbb', depth: 0, parent_artifact_id: null })
  links('p-bbb', ['http://a.example/t'])
  check('L8: tie → lexicographically smallest artifact', JSON.stringify(computeLineage(rootP, mkManifest({ fetched: [rowB, rowA] }), 'http://a.example/t')) === JSON.stringify({ depth: 1, parent_artifact_id: 'p-aaa' }))
}
{
  const rowZ = mkRow({ normalized_url: n('http://z.example/z'), url: 'http://z.example/z', artifact_id: 'p-zzz', depth: 5, parent_artifact_id: 'p-y' })
  links('p-zzz', ['http://a.example/seed'])
  const m = mkManifest({ seeds: [n('http://a.example/seed')], fetched: [rowZ] })
  check('L9: seed wins over a deeper link', JSON.stringify(computeLineage(rootP, m, 'http://a.example/seed')) === JSON.stringify({ depth: 0, parent_artifact_id: null }))
}

// --- gate (checkDepthFence)
const K2 = { maxDepth: 2, maxDiscoveredHosts: 3 }
{
  const rowA = mkRow({ normalized_url: n('http://a.example/a'), url: 'http://a.example/a', artifact_id: 'p-aaa', depth: 0, parent_artifact_id: null })
  links('p-aaa', ['http://a.example/b'])
  const rowB = mkRow({ normalized_url: n('http://a.example/b'), url: 'http://a.example/b', artifact_id: 'p-bbb', depth: 1, parent_artifact_id: 'p-aaa' })
  links('p-bbb', ['http://a.example/c'])
  const m = mkManifest({ fetched: [rowA, rowB] })
  const ok = checkDepthFence(rootP, m, 'http://a.example/c', K2)
  check('G1: depth 2 ≤ maxDepth 2 passes', ok.depth === 2 && ok.parent_artifact_id === 'p-bbb', JSON.stringify(ok))
  await expectErr('G2: depth 2 > maxDepth 1 refused', () => checkDepthFence(rootP, m, 'http://a.example/c', { ...K2, maxDepth: 1 }), 'depth_exceeded', 'is 2 hops from nearest seed (maxDepth: 1)')
  let e2: unknown = null
  try { checkDepthFence(rootP, m, 'http://a.example/c', { ...K2, maxDepth: 1 }) } catch (e) { e2 = e }
  check('G2: hint present', e2 instanceof StoreError && e2.message.includes(FENCE_HINT), e2 instanceof StoreError ? e2.message : String(e2))
}
{
  const m = mkManifest({
    fetched: [
      mkRow({ normalized_url: n('http://b.example/1'), url: 'http://b.example/1', artifact_id: 'p-1' }),
      mkRow({ normalized_url: n('http://c.example/1'), url: 'http://c.example/1', artifact_id: 'p-2' }),
    ],
  })
  await expectErr('G3: 3rd non-seed host refused', () => checkDepthFence(rootP, m, 'http://d.example/1', { maxDepth: 2, maxDiscoveredHosts: 2 }), 'host_breadth_exceeded', 'would be the 3rd non-seed host (maxDiscoveredHosts: 2)')
  let e3: unknown = null
  try { checkDepthFence(rootP, m, 'http://d.example/1', { maxDepth: 2, maxDiscoveredHosts: 2 }) } catch (e) { e3 = e }
  check('G3: hint present', e3 instanceof StoreError && e3.message.includes(FENCE_HINT), e3 instanceof StoreError ? e3.message : String(e3))
  await expectErr('G3b: ordinal 1st (cap 0)', () => checkDepthFence(rootP, mkManifest({}), 'http://a.example/1', { maxDepth: 2, maxDiscoveredHosts: 0 }), 'host_breadth_exceeded', 'would be the 1st non-seed host (maxDiscoveredHosts: 0)')
  await expectErr('G3c: ordinal 2nd (cap 1)', () => checkDepthFence(rootP, m, 'http://d.example/1', { maxDepth: 2, maxDiscoveredHosts: 2 }), 'host_breadth_exceeded', 'would be the 3rd non-seed host')
  await expectErr('G3d: ordinal 2nd (cap 1)', () => checkDepthFence(rootP, mkManifest({ fetched: [mkRow({ normalized_url: n('http://b.example/1'), url: 'http://b.example/1', artifact_id: 'p-1' })] }), 'http://c.example/1', { maxDepth: 2, maxDiscoveredHosts: 1 }), 'host_breadth_exceeded', 'would be the 2nd non-seed host (maxDiscoveredHosts: 1)')
}
{
  const m = mkManifest({
    seeds: [n('http://a.example/s')],
    fetched: [
      mkRow({ normalized_url: n('http://a.example/s'), url: 'http://a.example/s', artifact_id: 'p-0' }),
      mkRow({ normalized_url: n('http://b.example/1'), url: 'http://b.example/1', artifact_id: 'p-1' }),
      mkRow({ normalized_url: n('http://c.example/1'), url: 'http://c.example/1', artifact_id: 'p-2' }),
      mkRow({ normalized_url: n('http://d.example/1'), url: 'http://d.example/1', artifact_id: 'p-3' }),
    ],
  })
  const ok4 = checkDepthFence(rootP, m, 'http://a.example/other', { maxDepth: 2, maxDiscoveredHosts: 3 })
  check('G4: seed host exempt (3 hosts + new seed-host path ok)', ok4.new_host === null && ok4.discovered_hosts === 3, JSON.stringify(ok4))
  const ok5 = checkDepthFence(rootP, m, 'http://b.example/2', { maxDepth: 2, maxDiscoveredHosts: 3 })
  check('G5: known host passes, new_host null', ok5.new_host === null, JSON.stringify(ok5))
  const ok7 = checkDepthFence(rootP, mkManifest({ fetched: [mkRow({ normalized_url: n('http://b.example/1'), url: 'http://b.example/1', artifact_id: 'p-1' })] }), 'http://c.example/1', { maxDepth: 2, maxDiscoveredHosts: 3 })
  check('G7: new host under cap → new_host set', ok7.new_host === 'c.example', JSON.stringify(ok7))
}
{
  // D-M5.8: fresh roots (no seeds) still consume the discovered-host budget
  const m = mkManifest({
    fetched: [
      mkRow({ normalized_url: n('http://b.example/1'), url: 'http://b.example/1', artifact_id: 'p-1' }),
      mkRow({ normalized_url: n('http://c.example/1'), url: 'http://c.example/1', artifact_id: 'p-2' }),
    ],
  })
  await expectErr('G6: fresh root counts (no seeds) → 3rd host refused', () => checkDepthFence(rootP, m, 'http://e.example/1', { maxDepth: 2, maxDiscoveredHosts: 2 }), 'host_breadth_exceeded', 'would be the 3rd non-seed host (maxDiscoveredHosts: 2)')
  const ok8 = checkDepthFence(rootP, mkManifest({}), 'http://fresh.example/1', { maxDepth: 0, maxDiscoveredHosts: 3 })
  check('G8: maxDepth 0 still admits a fresh root (depth 0)', ok8.depth === 0, JSON.stringify(ok8))
}

// --- mission_start seeds (service level)
const rootS = join(mkdtempSync(join('/tmp', 'smoke-fence-seeds-')), 'root')
{
  const m = startMission(rootS, { note: 'seeds', budget: 5, seeds: ['http://A.Example/Seed'] })
  check('S1: seed normalized (host lowercased, path case kept) + stored', m.seeds && m.seeds.length === 1 && m.seeds[0] === 'http://a.example/Seed', JSON.stringify(m.seeds))
  const m2 = startMission(rootS, {
    note: 'seeds-dedupe',
    budget: 5,
    seeds: ['http://a.example/1?b=2&a=1', 'http://a.example/1/?a=1&b=2', 'http://A.example/1?a=1&b=2'],
  })
  check('S2: seeds deduped on normalized keys', m2.seeds.length === 1 && m2.seeds[0] === 'http://a.example/1?a=1&b=2', JSON.stringify(m2.seeds))
  let threw = null
  try { startMission(rootS, { note: 'bad', budget: 5, seeds: ['not a url'] }) } catch (e) { threw = e }
  check('S3: bad seed → normalize_failed', threw instanceof StoreError && threw.code === 'normalize_failed', threw && threw.code)
  const m4 = startMission(rootS, { note: 'no seeds', budget: 5 })
  check('S4: no seeds → key absent', !('seeds' in m4), JSON.stringify(Object.keys(m4)))
}

// --- runFetch integration (fake fetcher with link control)
const mkPage = (url, linksList): FetchedPage => ({
  url,
  finalUrl: url,
  status: 200,
  contentType: 'text/html',
  title: 'T',
  content: 'depth fence content for ' + url + ' '.repeat(120),
  links: linksList.map((u) => ({ url: u, text: u })),
  byteLength: 400,
  fetchedAt: new Date().toISOString(),
  quality: 'full',
  qualitySignals: [],
  consentAttempted: false,
  consentImproved: false,
})

// V9: depth chain 0 → 1 → 2-refused (maxDepth 1)
const rootB = join(mkdtempSync(join('/tmp', 'smoke-fence-v9-')), 'root')
mkdirSync(rootB, { recursive: true })
writeFileSync(join(dirname(rootB), 'allowlist.txt'), '*.example')
writeFileSync(configPath(rootB), JSON.stringify({ maxDepth: 1 }))
let callsB = 0
const pagesB = {
  'http://a.example/seed': ['http://a.example/sub'],
  'http://a.example/sub': ['http://a.example/subsub'],
}
const fakeB = { async fetch(url) { callsB++; const l = pagesB[url] ?? []; return mkPage(url, l) } }
const mB = startMission(rootB, { note: 'v9', budget: 10, seeds: ['http://A.Example/seed'] })
check('V9: manifest seeds normalized (host lowercased)', JSON.stringify(mB.seeds) === JSON.stringify([n('http://a.example/seed')]), JSON.stringify(mB.seeds))
const rB0 = await runFetch(rootB, fakeB, { url: 'http://a.example/seed' })
check('V9: seed depth 0/null', rB0.cached === false && rB0.depth === 0 && rB0.parent_artifact_id === null, JSON.stringify({ d: rB0.depth, p: rB0.parent_artifact_id, e: rB0.error }))
check('V9: seed sample_links carry the child', rB0.sample_links.includes('http://a.example/sub'), JSON.stringify(rB0.sample_links))
const rB1 = await runFetch(rootB, fakeB, { url: 'http://a.example/sub' })
check('V9: child depth 1 + parent = seed artifact', rB1.depth === 1 && rB1.parent_artifact_id === rB0.artifact_id, JSON.stringify({ d: rB1.depth, p: rB1.parent_artifact_id, a: rB0.artifact_id }))
await expectErr('V9: grandchild refused (2 > maxDepth 1)', () => runFetch(rootB, fakeB, { url: 'http://a.example/subsub' }), 'depth_exceeded', 'is 2 hops from nearest seed (maxDepth: 1)')
const eB = await runFetch(rootB, fakeB, { url: 'http://a.example/subsub' }).catch((e) => e)
check('V9: hint present', eB && typeof eB === 'object' && eB.message.includes(FENCE_HINT), eB && eB.message)
check('V9: refusal zero-cost (no spawn)', callsB === 2, 'calls=' + callsB)
check('V9: refusal zero-cost (no charge)', (readManifest(rootB, mB.mission_id).budget.spent ?? 0) === 2)
{
  const rows = readManifest(rootB, mB.mission_id).fetched
  check('V9: rows persist depth/parent', rows.length === 2 && rows[0].depth === 0 && rows[0].parent_artifact_id === null && rows[1].depth === 1 && rows[1].parent_artifact_id === rB0.artifact_id, JSON.stringify(rows.map((r) => [r.depth, r.parent_artifact_id])))
  const stB = missionStatus(rootB, mB.mission_id)
  check('V9: status rows carry depth/parent', stB.visited.length === 2 && stB.visited[1].depth === 1, JSON.stringify(stB.visited.map((r) => r.depth)))
  const page0 = JSON.parse(readFileSync(join(rootB, mB.mission_id, 'pages', rB0.artifact_id, 'page.json'), 'utf8'))
  const page1 = JSON.parse(readFileSync(join(rootB, mB.mission_id, 'pages', rB1.artifact_id, 'page.json'), 'utf8'))
  check('V9: page.json carries depth (M4 find reads it)', page0.depth === 0 && page1.depth === 1, JSON.stringify([page0.depth, page1.depth]))
  const rHit = await runFetch(rootB, fakeB, { url: 'http://a.example/sub' })
  check('V9: hit carries the stored lineage', rHit.cached === true && rHit.depth === 1 && rHit.parent_artifact_id === rB0.artifact_id, JSON.stringify({ c: rHit.cached, d: rHit.depth }))
  check('V9: hit free', (readManifest(rootB, mB.mission_id).budget.spent ?? 0) === 2)
}

// V10: host width (seed exempt; 3rd non-seed host refused)
const rootC = join(mkdtempSync(join('/tmp', 'smoke-fence-v10-')), 'root')
mkdirSync(rootC, { recursive: true })
writeFileSync(join(dirname(rootC), 'allowlist.txt'), '*.example')
writeFileSync(configPath(rootC), JSON.stringify({ maxDiscoveredHosts: 2 }))
let callsC = 0
const pagesC = {
  'http://a.example/seed': ['http://b.example/1', 'http://c.example/1', 'http://d.example/1'],
  'http://b.example/1': [],
  'http://c.example/1': [],
  'http://d.example/1': [],
}
const fakeC = { async fetch(url) { callsC++; const l = pagesC[url] ?? []; return mkPage(url, l) } }
const mC = startMission(rootC, { note: 'v10', budget: 10, seeds: ['http://a.example/seed'] })
await runFetch(rootC, fakeC, { url: 'http://a.example/seed' })
const rC1 = await runFetch(rootC, fakeC, { url: 'http://b.example/1' })
check('V10: 1st discovered host ok', rC1.cached === false && rC1.depth === 1, JSON.stringify({ d: rC1.depth, e: rC1.error }))
const rC2 = await runFetch(rootC, fakeC, { url: 'http://c.example/1' })
check('V10: 2nd discovered host ok (cap 2)', rC2.cached === false, JSON.stringify({ e: rC2.error }))
await expectErr('V10: 3rd non-seed host refused', () => runFetch(rootC, fakeC, { url: 'http://d.example/1' }), 'host_breadth_exceeded', 'would be the 3rd non-seed host (maxDiscoveredHosts: 2)')
check('V10: refusal zero-cost (no spawn)', callsC === 3, 'calls=' + callsC)
check('V10: refusal zero-cost (no charge)', (readManifest(rootC, mC.mission_id).budget.spent ?? 0) === 3)
const rC3 = await runFetch(rootC, fakeC, { url: 'http://b.example/1' })
check('V10: hit on a known host (not re-gated)', rC3.cached === true, JSON.stringify({ c: rC3.cached, e: rC3.error }))

// Order: allowlist BEFORE fence, fence BEFORE budget
// Chain: seed(d0) → a/1(d1) → { a/2(d2) → a/3(d3) } and a/1 → b/2(d2, NOT allowed)
const rootD = join(mkdtempSync(join('/tmp', 'smoke-fence-order-')), 'root')
mkdirSync(rootD, { recursive: true })
writeFileSync(join(dirname(rootD), 'allowlist.txt'), 'a.example')
writeFileSync(configPath(rootD), JSON.stringify({ maxDepth: 1 }))
let callsD = 0
const pagesD = {
  'http://a.example/seed': ['http://a.example/1'],
  'http://a.example/1': ['http://b.example/2', 'http://a.example/2'],
  'http://a.example/2': ['http://a.example/3'],
}
const fakeD = { async fetch(url) { callsD++; const l = pagesD[url] ?? []; return mkPage(url, l) } }
const mD = startMission(rootD, { note: 'order', budget: 2, seeds: ['http://a.example/seed'] })
await runFetch(rootD, fakeD, { url: 'http://a.example/seed' }) // 1 call
await runFetch(rootD, fakeD, { url: 'http://a.example/1' }) // 2nd call → exhausted
await expectErr('O1: depth-2 + not-allowed → allowlist_denied (4a before 4b)', () => runFetch(rootD, fakeD, { url: 'http://b.example/2' }), 'allowlist_denied', 'b.example/2')
// (b/2 is depth 2 via a/1 — the fence WOULD also refuse; the allowlist must fire first)
check('O1: zero-cost refusal (budget + spawn untouched)', (readManifest(rootD, mD.mission_id).budget.spent ?? 0) === 2 && callsD === 2, 'spent/calls=' + (readManifest(rootD, mD.mission_id).budget.spent ?? 0) + '/' + callsD)
writeFileSync(configPath(rootD), JSON.stringify({ maxDepth: 2 }))
const mD2 = startMission(rootD, { note: 'order2', budget: 3 })
await runFetch(rootD, fakeD, { url: 'http://a.example/seed' }) // 1
await runFetch(rootD, fakeD, { url: 'http://a.example/1' }) // 2
await runFetch(rootD, fakeD, { url: 'http://a.example/2' }) // 3 → exhausted
await expectErr('O2: depth-3 + exhausted → depth_exceeded (fence before budget)', () => runFetch(rootD, fakeD, { url: 'http://a.example/3' }), 'depth_exceeded', 'is 3 hops')
// (a/3 is depth 3 via a/2; the budget is exhausted too → the fence must fire first)
const mD3 = startMission(rootD, { note: 'order3', budget: 1 })
await runFetch(rootD, fakeD, { url: 'http://a.example/seed' }) // exhausted
await expectErr('O3: fresh root + exhausted → budget_exhausted (fence passes, budget fires)', () => runFetch(rootD, fakeD, { url: 'http://a.example/new' }), 'budget_exhausted', 'budget exhausted')

// Hit/force under a tightened fence
const rootE = join(mkdtempSync(join('/tmp', 'smoke-fence-hitforce-')), 'root')
mkdirSync(rootE, { recursive: true })
writeFileSync(join(dirname(rootE), 'allowlist.txt'), '*.example')
writeFileSync(configPath(rootE), JSON.stringify({ maxDepth: 1 }))
let callsE = 0
const pagesE = {
  'http://a.example/r': ['http://a.example/s'],
  'http://a.example/s': [],
}
const fakeE = { async fetch(url) { callsE++; const l = pagesE[url] ?? []; return mkPage(url, l) } }
const mE = startMission(rootE, { note: 'hitforce', budget: 10 })
await runFetch(rootE, fakeE, { url: 'http://a.example/r' })
const rE1 = await runFetch(rootE, fakeE, { url: 'http://a.example/s' })
check('HF: stored at depth 1 under maxDepth 1', rE1.depth === 1, JSON.stringify({ d: rE1.depth }))
writeFileSync(configPath(rootE), JSON.stringify({ maxDepth: 0 }))
const rE2 = await runFetch(rootE, fakeE, { url: 'http://a.example/s' })
check('HF: hit NOT re-gated under tightened fence', rE2.cached === true && rE2.depth === 1, JSON.stringify({ c: rE2.cached, d: rE2.depth, e: rE2.error }))
await expectErr('HF: force IS re-gated (depth 1 > 0)', () => runFetch(rootE, fakeE, { url: 'http://a.example/s', force: true }), 'depth_exceeded', 'is 1 hops from nearest seed (maxDepth: 0)')
check('HF: force denial zero-cost', (readManifest(rootE, mE.mission_id).budget.spent ?? 0) === 2 && callsE === 2, 'spent/calls=' + (readManifest(rootE, mE.mission_id).budget.spent ?? 0) + '/' + callsE)

// D-M5.8 via runFetch: fresh roots consume the discovered-host budget (M7 model)
const rootF = join(mkdtempSync(join('/tmp', 'smoke-fence-fresh-')), 'root')
mkdirSync(rootF, { recursive: true })
writeFileSync(join(dirname(rootF), 'allowlist.txt'), '*.example')
writeFileSync(configPath(rootF), JSON.stringify({ maxDiscoveredHosts: 2 }))
let callsF = 0
const fakeF = { async fetch(url) { callsF++; return mkPage(url, []) } }
const mF = startMission(rootF, { note: 'fresh-roots', budget: 10 }) // NO seeds
await runFetch(rootF, fakeF, { url: 'http://x.example/1' })
await runFetch(rootF, fakeF, { url: 'http://y.example/1' })
await expectErr('F1: 3rd fresh root refused (no seeds → nothing exempt)', () => runFetch(rootF, fakeF, { url: 'http://z.example/1' }), 'host_breadth_exceeded', 'would be the 3rd non-seed host (maxDiscoveredHosts: 2)')
check('F1: refusal zero-cost', callsF === 2 && (readManifest(rootF, mF.mission_id).budget.spent ?? 0) === 2)

console.log(fail === 0 ? 'harness A: all checks passed' : 'harness A: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// --- Harness B: tool level (BUILT lib + real browser39 + 2 local servers) -----
const harnessB = `
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require2 = createRequire(import.meta.url)
const lib = require2(${JSON.stringify(join(repoRoot, 'lib', 'index.js'))})

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label) ; else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const tools = []
const ctx = {
  tools: { register: (def) => { tools.push(def); return () => {} } },
  skills: { register: () => () => {} },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
}
lib.apply(ctx)
const byName = {}
for (const t of tools) byName[t.name] = t
if (!byName.mission_fetch) { console.error('FATAL: mission_fetch not registered'); process.exit(1) }

const LONG = 'lorem ipsum dolor sit amet '.repeat(30)
const hit = (obj, p) => { obj[p] = (obj[p] || 0) + 1; return obj[p] }

// Server A on 127.0.0.1 (seed host) — links chain /seed → /sub → /subsub
// and an absolute link onto server B (localhost).
const hitsA = {}
const hitsB = {}
const serverA = http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  hit(hitsA, path)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  if (path === '/seed') {
    res.end('<html><head><title>Seed</title></head><body><h1>Seed</h1><p>' + LONG + '</p>' +
      '<a href="sub">sub</a> <a href="' + baseB + '/one">one</a></body></html>')
    return
  }
  if (path === '/sub') {
    res.end('<html><head><title>Sub</title></head><body><h1>Sub</h1><p>' + LONG + '</p>' +
      '<a href="subsub">subsub</a></body></html>')
    return
  }
  if (path === '/subsub') {
    res.end('<html><head><title>Subsub</title></head><body><h1>Subsub</h1><p>' + LONG + '</p></body></html>')
    return
  }
  res.writeHead(404)
  res.end('nope')
})
const serverB = http.createServer((req, res) => {
  const path = req.url.split('?')[0]
  hit(hitsB, path)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end('<html><head><title>B' + path + '</title></head><body><h1>B' + path + '</h1><p>' + LONG + '</p></body></html>')
})
await new Promise((r) => serverA.listen(0, '127.0.0.1', r))
await new Promise((r) => serverB.listen(0, '127.0.0.1', r))
const baseA = 'http://127.0.0.1:' + serverA.address().port
const baseB = 'http://localhost:' + serverB.address().port

const workdir = mkdtempSync(join('/tmp', 'smoke-fence-tool-'))
const exec = () => ({})
mkdirSync(join(workdir, '.dsh', 'web-missions'), { recursive: true })
writeFileSync(join(workdir, '.dsh', 'allowlist.txt'), '127.0.0.1\\nlocalhost\\nlocalhost2')
writeFileSync(join(workdir, '.dsh', 'web-missions', 'config.json'), JSON.stringify({ maxDepth: 1, maxDiscoveredHosts: 1 }))

// seeds via the tool (trailing slash → normalized away)
const started = await byName.mission_start.execute({ note: 'fence tool smoke', budget: 5, seeds: [baseA + '/seed/'], cwd: workdir }, exec())
check('tool: mission started with seeds', !!started.mission_id && Array.isArray(started.seeds) && started.seeds.length === 1, JSON.stringify(started.seeds))
check('tool: seed normalized (trailing slash dropped)', started.seeds[0] === baseA + '/seed', started.seeds[0])
const mid = started.mission_id

// V1: seed fetch — depth 0, parent null
const v1 = await byName.mission_fetch.execute({ url: baseA + '/seed', mission_id: mid, cwd: workdir }, exec())
check('tool V1: seed ok', v1.ok !== false && v1.cached === false && v1.page_quality === 'full', JSON.stringify({ q: v1.page_quality, e: v1.error }))
check('tool V1: depth 0/null', v1.depth === 0 && v1.parent_artifact_id === null, JSON.stringify({ d: v1.depth, p: v1.parent_artifact_id }))
check('tool V1: charged 1', v1.budget.spent === 1 && v1.budget.remaining === 4, JSON.stringify(v1.budget))
check('tool V1: real links extracted (sub + cross-host one)', v1.sample_links.includes(baseA + '/sub') && v1.sample_links.includes(baseB + '/one'), JSON.stringify(v1.sample_links))
const seedArtifact = v1.artifact_id

// V2: /sub via real link extraction — depth 1, parent = seed artifact
const v2 = await byName.mission_fetch.execute({ url: baseA + '/sub', mission_id: mid, cwd: workdir }, exec())
check('tool V2: sub depth 1', v2.depth === 1, JSON.stringify({ d: v2.depth, e: v2.error }))
check('tool V2: parent = seed artifact', v2.parent_artifact_id === seedArtifact, v2.parent_artifact_id + ' vs ' + seedArtifact)
check('tool V2: charged 2', v2.budget.spent === 2, JSON.stringify(v2.budget))

// V3: /subsub → depth_exceeded envelope, ZERO spawn, ZERO charge
const v3 = await byName.mission_fetch.execute({ url: baseA + '/subsub', mission_id: mid, cwd: workdir }, exec())
check('tool V3: depth_exceeded envelope', v3.ok === false && typeof v3.error === 'string' && v3.error.startsWith('depth_exceeded:') && v3.error.includes('is 2 hops from nearest seed (maxDepth: 1)'), JSON.stringify(v3.error))
check('tool V3: hint present', v3.error && v3.error.includes('fence refused this fetch'), JSON.stringify(v3.error))
check('tool V3: zero spawn on refusal', (hitsA['/subsub'] || 0) === 0, JSON.stringify(hitsA))
let st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool V3: zero charge on refusal', st.budget.spent === 2 && st.budget.remaining === 3, JSON.stringify(st.budget))

// V4: new host (localhost) admitted under maxDiscoveredHosts 1
const v4 = await byName.mission_fetch.execute({ url: baseB + '/one', mission_id: mid, cwd: workdir }, exec())
check('tool V4: 1st non-seed host ok', v4.ok !== false && v4.cached === false, JSON.stringify({ q: v4.page_quality, e: v4.error }))
check('tool V4: depth 1 (linked from seed page) or 0 (fresh)', v4.depth === 1 || v4.depth === 0, JSON.stringify({ d: v4.depth }))
check('tool V4: charged 3', v4.budget.spent === 3, JSON.stringify(v4.budget))

// V5: known host (localhost /two) passes — not re-counted
const v5 = await byName.mission_fetch.execute({ url: baseB + '/two', mission_id: mid, cwd: workdir }, exec())
check('tool V5: known host passes', v5.ok !== false && v5.cached === false, JSON.stringify({ e: v5.error }))

// V6: 2nd NEW host (localhost2, allowed but never fetched) refused —
// host_breadth_exceeded, no spawn needed
const v6 = await byName.mission_fetch.execute({ url: 'http://localhost2:9/x', mission_id: mid, cwd: workdir }, exec())
check('tool V6: host_breadth_exceeded envelope', v6.ok === false && typeof v6.error === 'string' && v6.error.startsWith('host_breadth_exceeded:') && v6.error.includes('would be the 2nd non-seed host (maxDiscoveredHosts: 1)'), JSON.stringify(v6.error))
check('tool V6: hint present', v6.error && v6.error.includes('fence refused this fetch'), JSON.stringify(v6.error))
st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool V6: zero charge on refusal', st.budget.spent === 4, JSON.stringify(st.budget))

// V7: hit carries the stored lineage
const v7 = await byName.mission_fetch.execute({ url: baseA + '/seed', mission_id: mid, cwd: workdir }, exec())
check('tool V7: hit cached + stored depth 0', v7.cached === true && v7.depth === 0 && v7.parent_artifact_id === null, JSON.stringify({ c: v7.cached, d: v7.depth }))
check('tool V7: hit free', (await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())).budget.spent === 4)

// V8: mission_status rows carry depth + parent_artifact_id
st = await byName.mission_status.execute({ mission_id: mid, cwd: workdir }, exec())
check('tool V8: status rows carry lineage', st.visited.length === 4 && st.visited[0].depth === 0 && st.visited[1].depth === 1 && st.visited[1].parent_artifact_id === seedArtifact, JSON.stringify(st.visited.map((r) => [r.depth, r.parent_artifact_id])))

console.log(fail === 0 ? 'harness B: all checks passed' : 'harness B: ' + fail + ' FAILURES')
serverA.close()
serverB.close()
process.exit(fail === 0 ? 0 : 1)
`

// --- run both ------------------------------------------------------------------
// M5 5.4: hermetic host-scoped session dirs (never touch ~/.dsh/browser39/sessions).
process.env.BROWSER39_SESSIONS_DIR = mkdtempSync(join(tmpdir(), 'smoke-fence-sess-'))
let rc = 0

const dirA = mkdtempSync(join(tmpdir(), 'smoke-fence-a-'))
try {
  writeFileSync(join(dirA, 'a.ts'), harnessA)
  buildSync({ entryPoints: [join(dirA, 'a.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirA, 'a.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirA, 'a.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness A exit ' + out.status) }
} finally {
  rmSync(dirA, { recursive: true, force: true })
}

const dirB = mkdtempSync(join(tmpdir(), 'smoke-fence-b-'))
try {
  writeFileSync(join(dirB, 'b.ts'), harnessB)
  buildSync({ entryPoints: [join(dirB, 'b.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirB, 'b.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirB, 'b.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness B exit ' + out.status) }
} finally {
  rmSync(dirB, { recursive: true, force: true })
}

process.exit(rc)
