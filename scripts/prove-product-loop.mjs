#!/usr/bin/env node
/**
 * Product-loop proof (hermetic + optional live :3090 health).
 * Exercises built lib tools: start → (fake store page) → find → read → verify → stop.
 * Real browser39 fetch is optional via PROVE_FETCH_URL=
 */
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '..')
const require2 = createRequire(import.meta.url)
const lib = require2(join(repo, 'lib', 'index.js'))

let fail = 0
const check = (label, cond, detail) => {
  console.log((cond ? 'ok   ' : 'FAIL ') + label + (!cond && detail ? '  ::  ' + detail : ''))
  if (!cond) fail++
}

const tools = []
lib.apply({
  tools: { register: (def) => { tools.push(def); return () => {} } },
  skills: { register: () => () => {} },
  effect: () => {},
  inject: () => {},
  logger: () => ({ warn: () => {}, error: () => {} }),
})
const by = Object.fromEntries(tools.map((t) => [t.name, t]))
check('tools: read+verify registered', !!by.mission_read && !!by.mission_verify, Object.keys(by).join(','))

const workdir = mkdtempSync(join(tmpdir(), 'prove-loop-'))
const exec = () => ({})
mkdirSync(join(workdir, '.dsh', 'web-missions'), { recursive: true })
writeFileSync(join(workdir, '.dsh', 'web-missions', 'config.json'), JSON.stringify({ allowlist: 'off' }))

// Local HTTP page for optional real fetch
const pad = ' lorem ipsum dolor sit amet '.repeat(40)
const html = '<html><head><title>Prove Loop</title></head><body><h1>Prove</h1><p>Revenue figure 42.7 million verified token ALPHA7.' + pad + '</p></body></html>'
const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(html)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const start = await by.mission_start.execute({ note: 'product-loop prove', budget: 5, cwd: workdir, seeds: [base + '/'] }, exec())
check('start', !!start.mission_id && !!start.mission_md_path, JSON.stringify(start))
const mid = start.mission_id

const fetched = await by.mission_fetch.execute({ url: base + '/', mission_id: mid, cwd: workdir }, exec())
check('fetch full', fetched.page_quality === 'full' && !!fetched.artifact_id, JSON.stringify({ q: fetched.page_quality, e: fetched.error, a: fetched.artifact_id }))
const aid = fetched.artifact_id

const find = await by.mission_find.execute({ query: 'Revenue ALPHA7', mission_id: mid, cwd: workdir }, exec())
check('find hit', find.matches?.length >= 1, JSON.stringify(find))

const read = await by.mission_read.execute({ artifact_id: aid, mission_id: mid, cwd: workdir }, exec())
check('read untrusted+text', read.untrusted === true && String(read.text).includes('42.7'), JSON.stringify({ u: read.untrusted, t: (read.text || '').slice(0, 80) }))

writeFileSync(read.mission_md_path, `# Product loop

### ProveCo
- **Key numbers:** 42.7
- **Sources:** [${aid}](${base}/)
`)

const verify = await by.mission_verify.execute({ mission_id: mid, cwd: workdir }, exec())
check('verify ok', verify.ok === true, verify.summary)

const stop = await by.mission_stop.execute({ mission_id: mid, reason: 'prove done', cwd: workdir }, exec())
check('stop + claims', stop.status === 'stopped' && stop.claims?.ok === true, JSON.stringify({ s: stop.status, c: stop.claims?.summary }))

server.close()

// Live :3090 health if up
try {
  const h = await fetchLive('http://127.0.0.1:3090/api/web-missions/health')
  check('live :3090 health', h.ok === true && Array.isArray(h.tools) && h.tools.includes('mission_read') && h.skill === true, JSON.stringify(h))
  check('live config allowlist default off', h.config?.allowlist === 'off', JSON.stringify(h.config?.allowlist))
} catch (e) {
  console.log('skip  live :3090 not up (' + e.message + ')')
}

rmSync(workdir, { recursive: true, force: true })
console.log(fail === 0 ? '\nprove-product-loop: ALL GREEN' : `\nprove-product-loop: ${fail} FAILURE(S)`)
process.exit(fail === 0 ? 0 : 1)

async function fetchLive(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}
