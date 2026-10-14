#!/usr/bin/env node
/**
 * R2 smoke: mission_read + claim check (hermetic, no browser39).
 * Seeds a fake stored page, writes mission.md with a citation + number,
 * asserts read + verify.
 */
import { buildSync } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const here = dirname(fileURLToPath(import.meta.url))
const abs = (p) => join(here, p).split(/[\\/]/).join('/')

const harness = `
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { startMission, missionMdPath } from '${abs('../src/host/store.ts')}'
import { storeArtifact } from '${abs('../src/host/artifacts.ts')}'
import { appendFetchedRow } from '${abs('../src/host/store.ts')}'
import { runRead } from '${abs('../src/host/read-service.ts')}'
import { checkMissionClaims } from '${abs('../src/host/claims.ts')}'
import { LexicalEngine } from '${abs('../src/host/retrieval.ts')}'
import { runFind } from '${abs('../src/host/find-service.ts')}'
import { readConfig } from '${abs('../src/host/config.ts')}'

let fail = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label + (detail && !cond ? '  ::  ' + detail : ''))
  if (!cond) fail++
}

const root = join(mkdtempSync(join('/tmp', 'smoke-read-')), 'wm')
mkdirSync(root, { recursive: true })
writeFileSync(join(root, 'config.json'), JSON.stringify({ snippetWindow: 40, allowlist: 'off' }))

const m = startMission(root, { note: 'read-claims', budget: 3 })
const mid = m.mission_id
const page = {
  url: 'https://example.com/report',
  finalUrl: 'https://example.com/report',
  status: 200,
  contentType: 'text/html',
  title: 'Report',
  content: 'Partner revenue was exactly 12.5 million euros in 2024. More text here about DKB and Allianz.',
  links: [{ url: 'https://example.com/other', text: 'other' }],
  byteLength: 120,
  fetchedAt: new Date().toISOString(),
  quality: 'full',
  qualitySignals: [],
  consentAttempted: false,
  consentImproved: false,
}
const stored = storeArtifact(root, mid, page, { chunkChars: 2000, previewChars: 50 })
appendFetchedRow(root, mid, {
  normalized_url: 'https://example.com/report',
  url: page.finalUrl,
  artifact_id: stored.artifactId,
  quality: 'full',
  fetched_at: page.fetchedAt,
  budget_charged: true,
  depth: 0,
  parent_artifact_id: null,
})

const cfg = readConfig(root)
check('config: snippetWindow from file', cfg.snippetWindow === 40, JSON.stringify(cfg.snippetWindow))
check('config: allowlist default-off override', cfg.allowlist === 'off')

const find = runFind(root, new LexicalEngine({ snippetWindow: cfg.snippetWindow }), { query: 'revenue 12.5' })
check('find: at least one match', find.matches && find.matches.length >= 1, JSON.stringify(find))
check('find: snippet uses window', (find.matches[0].snippet || '').length > 0)

const read = runRead(root, { artifact_id: stored.artifactId, mission_id: mid })
check('read: untrusted', read.untrusted === true)
check('read: quality full', read.page_quality === 'full')
check('read: text has number', read.text.includes('12.5'))
check('read: mission_md_path', read.mission_md_path === missionMdPath(root, mid))

writeFileSync(missionMdPath(root, mid), \`# Mission

### ExampleCo
- **Key numbers:** 12.5
- **Sources:** [\${stored.artifactId}](https://example.com/report)
\`)

const claims = checkMissionClaims(root, mid)
check('claims: ok', claims.ok === true, claims.summary)
check('claims: citation ok', claims.citations.length === 1 && claims.citations[0].ok)

writeFileSync(missionMdPath(root, mid), \`# Mission
### ExampleCo
- **Key numbers:** 99.9 invented
- **Sources:** [\${stored.artifactId}](https://example.com/report)
\`)
const bad = checkMissionClaims(root, mid)
check('claims: invented number fails', bad.ok === false && bad.numbers.some((n) => !n.ok), bad.summary)

console.log(fail === 0 ? 'smoke-read-claims: ALL GREEN' : 'smoke-read-claims: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

const dir = mkdtempSync(join(tmpdir(), 'smoke-read-build-'))
try {
  writeFileSync(join(dir, 'h.ts'), harness)
  buildSync({
    entryPoints: [join(dir, 'h.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile: join(dir, 'h.mjs'),
    absWorkingDir: here,
  })
  const out = spawnSync(process.execPath, [join(dir, 'h.mjs')], {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
  })
  process.exit(out.status === 0 ? 0 : 1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
