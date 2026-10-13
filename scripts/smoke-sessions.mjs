// M5 5.4 smoke — host-scoped browser39 sessions (C7).
//
// Harness A (unit, FAKE watch binary — zero real browser39):
//   - argv contract: `watch <in> --config <host>/config.toml --output <out>`
//     (persist on) / `watch <in> --no-persist --output <out>` (off / no key)
//   - sessions.ts helpers: root (default + BROWSER39_SESSIONS_DIR override),
//     dir-per-host, config.toml create-if-absent (operator file wins),
//     self-heal on deletion
//   - result mapping (404 → blocked, links resolved), ok:false → fetch_failed
//   - timeout + abort kill the process group (no orphan)
//
// Harness B (real browser39 + local server):
//   - /set (Set-Cookie) → session.enc on disk under <root>/127.0.0.1/
//   - NEW fetcher instance → /echo reflects the cookie (cross-invocation)
//   - host dir name = hostname, no port
//   - persistSessions:false → in-memory (session.enc untouched, cookie absent)
// Exits non-zero on any failure.
import { buildSync } from 'esbuild'
import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..')
const abs = (p) => join(here, p).split(/[\\/]/).join('/')

// --- locate the real platform binary ----------------------------------------
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
  console.error('FATAL: could not locate the platform browser39 binary in node_modules')
  process.exit(1)
}

// --- Harness A: fake watch binary --------------------------------------------
const harnessA = `
import http from 'node:http'
import { writeFileSync, chmodSync, mkdtempSync, readFileSync, existsSync, unlinkSync, readdirSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { Browser39Fetcher, FetchError } from '${abs('../src/host/fetcher.ts')}'
import {
  SESSIONS_DIR_ENV,
  sessionsRoot,
  sessionDirFor,
  sessionConfigPath,
  renderSessionConfig,
  ensureSessionDir,
} from '${abs('../src/host/sessions.ts')}'

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label); else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const dir = mkdtempSync(join(tmpdir(), 'smoke-sessions-a-'))
const sessRoot = join(dir, 'sessions')
const fakeBin = join(dir, 'fakeb39')

// fake browser39: emulates \`watch\` — processes pre-existing input lines at
// startup, writes one result line per command, then idles until killed.
// Input-line flags: __fail → ok:false; __sleep <ms> → delay the result;
// __md / __status / __title / __links shape the result.
writeFileSync(fakeBin, \`#!/usr/bin/env node
const fs = require('node:fs')
const argv = process.argv.slice(2)
if (process.env.FAKE_B39_LOG) fs.appendFileSync(process.env.FAKE_B39_LOG, JSON.stringify({ argv, pid: process.pid }) + '\\\\n')
if (process.env.FAKE_B39_PID) fs.writeFileSync(process.env.FAKE_B39_PID, String(process.pid))
const input = argv[1]
const outIdx = argv.indexOf('--output')
const out = outIdx >= 0 ? argv[outIdx + 1] : null
if (!input || !out) { process.exit(2) }
async function main() {
  const lines = fs.readFileSync(input, 'utf8').split('\\\\n').filter((l) => l.trim() !== '')
  const results = []
  for (const l of lines) {
    let c
    try { c = JSON.parse(l) } catch { results.push({ id: '?', ok: false, code: 'BAD_LINE', error: 'unparsable' }); continue }
    if (c.__sleep) await new Promise((r) => setTimeout(r, c.__sleep))
    if (c.__fail) { results.push({ id: c.id, ok: false, code: c.__code || 'FAKE_ERROR', error: c.__error || 'fake failure', retryable: false }); continue }
    const md = process.env.FAKE_B39_MD || c.__md || ''
    const links = process.env.FAKE_B39_LINKS ? JSON.parse(process.env.FAKE_B39_LINKS) : (c.__links || [])
    results.push({ id: c.id, ok: true, seq: c.seq, url: c.url, title: c.__title || 'Fake', status: c.__status ?? 200, markdown: md, links, meta: { content_type: 'text/html' }, stats: { fetch_ms: 1, tokens_est: 1, content_bytes: md.length }, truncated: false })
  }
  if (results.length) fs.writeFileSync(out, results.map((r) => JSON.stringify(r)).join('\\\\n') + '\\\\n')
  setInterval(() => {}, 1 << 30) // idle until killed (watch semantics)
}
main().catch((e) => { console.error(String(e)); process.exit(1) })
\`)
chmodSync(fakeBin, 0o755)

const logPath = join(dir, 'fake-argv.log')
writeFileSync(logPath, '')
const pidPath = join(dir, 'fake.pid')
process.env.FAKE_B39_LOG = logPath
process.env.FAKE_B39_PID = pidPath
const argvLog = () => readFileSync(logPath, 'utf8').split('\\n').filter(Boolean).map((l) => JSON.parse(l))
const lastArgv = () => { const a = argvLog(); return a.length ? a[a.length - 1].argv : null }
const isAlive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const LONG = 'lorem ipsum dolor sit amet '.repeat(40) // → >300 chars

// --- pure helper checks --------------------------------------------------------
check('A: sessionsRoot default = ~/.dsh/browser39/sessions',
  sessionsRoot({}) === join(homedir(), '.dsh', 'browser39', 'sessions'), sessionsRoot({}))
process.env[SESSIONS_DIR_ENV] = '/tmp/env-root-x'
check('A: sessionsRoot env override', sessionsRoot() === '/tmp/env-root-x', sessionsRoot())
check('A: sessionDirFor joins root + key', sessionDirFor('/r', 'a.example') === '/r/a.example')
check('A: renderSessionConfig pins disk + session_path',
  renderSessionConfig('/r/a.example').includes('persistence = "disk"') &&
  renderSessionConfig('/r/a.example').includes('session_path = "/r/a.example/session.enc"'),
  renderSessionConfig('/r/a.example'))

const cfgA = ensureSessionDir('a.example', sessRoot)
check('A: ensureSessionDir creates dir + config', existsSync(cfgA) && cfgA === join(sessRoot, 'a.example', 'config.toml'), cfgA)
check('A: config.toml content (fresh)', readFileSync(cfgA, 'utf8') === renderSessionConfig(join(sessRoot, 'a.example')))
// create-if-absent: operator file wins
writeFileSync(cfgA, '[[cookies]]\\nname = "op"\\nvalue = "1"\\n')
ensureSessionDir('a.example', sessRoot)
check('A: operator config.toml NOT overwritten', readFileSync(cfgA, 'utf8').includes('name = "op"'))
unlinkSync(cfgA)
ensureSessionDir('a.example', sessRoot)
check('A: config self-heals after deletion', existsSync(cfgA))
writeFileSync(join(sessRoot, 'a.example', 'config.toml'), renderSessionConfig(join(sessRoot, 'a.example'))) // restore for fetch tests

// --- fetcher argv contract ------------------------------------------------------
const fetcher = new Browser39Fetcher({
  fetchTimeoutMs: 3000,
  thinThresholdChars: 300,
  browser39Bin: fakeBin,
  sessionsRoot: sessRoot, // persistSessions defaults to true
})

// A1: persist on + sessionKey → --config <root>/<host>/config.toml
await fetcher.fetch('http://a.example/one', { sessionKey: 'a.example' })
{
  const argv = lastArgv()
  check('A1: argv = watch <in> --config <host>/config.toml --output <out>',
    argv[0] === 'watch' &&
    argv[argv.indexOf('--config') + 1] === join(sessRoot, 'a.example', 'config.toml') &&
    argv[argv.indexOf('--output') + 1] !== undefined &&
    argv.indexOf('--output') > argv.indexOf('--config'),
    JSON.stringify(argv))
  check('A1: no --no-persist when persisting', !argv.includes('--no-persist'))
}

// A2: second host → separate dir
await fetcher.fetch('http://b.example/one', { sessionKey: 'b.example' })
check('A2: per-host dirs (a.example, b.example)',
  existsSync(join(sessRoot, 'a.example', 'config.toml')) &&
  existsSync(join(sessRoot, 'b.example', 'config.toml')) &&
  JSON.stringify(readdirSync(sessRoot).sort()) === JSON.stringify(['a.example', 'b.example']),
  JSON.stringify(readdirSync(sessRoot)))

// A3: operator pre-written config used as-is (escape hatch)
writeFileSync(join(sessRoot, 'a.example', 'config.toml'), '# operator managed\\n[session]\\nsession_path = "/elsewhere/op.enc"\\n')
await fetcher.fetch('http://a.example/two', { sessionKey: 'a.example' })
check('A3: operator config path passed + not rewritten',
  lastArgv()[lastArgv().indexOf('--config') + 1] === join(sessRoot, 'a.example', 'config.toml') &&
  readFileSync(join(sessRoot, 'a.example', 'config.toml'), 'utf8').includes('# operator managed'))

// A4: persistSessions:false → --no-persist, no --config, no dir created
const offFetcher = new Browser39Fetcher({ fetchTimeoutMs: 3000, thinThresholdChars: 300, browser39Bin: fakeBin, sessionsRoot: sessRoot, persistSessions: false })
await offFetcher.fetch('http://c.example/one', { sessionKey: 'c.example' })
{
  const argv = lastArgv()
  check('A4: persist off → --no-persist, no --config', argv.includes('--no-persist') && !argv.includes('--config'), JSON.stringify(argv))
  check('A4: no session dir created when off', !existsSync(join(sessRoot, 'c.example')))
}

// A5: no sessionKey → --no-persist, no dir
await fetcher.fetch('http://a.example/three')
{
  const argv = lastArgv()
  check('A5: no sessionKey → --no-persist, no --config', argv.includes('--no-persist') && !argv.includes('--config'), JSON.stringify(argv))
}

// A6: BROWSER39_SESSIONS_DIR env override (fetcher without explicit root)
const envRoot = join(dir, 'env-root')
process.env[SESSIONS_DIR_ENV] = envRoot
const envFetcher = new Browser39Fetcher({ fetchTimeoutMs: 3000, thinThresholdChars: 300, browser39Bin: fakeBin })
await envFetcher.fetch('http://d.example/one', { sessionKey: 'd.example' })
check('A6: env override root honored',
  existsSync(join(envRoot, 'd.example', 'config.toml')) && !existsSync(join(sessRoot, 'd.example')))
delete process.env[SESSIONS_DIR_ENV]

// A7: result mapping (long content → full; relative links resolved)
{
  process.env.FAKE_B39_MD = LONG
  const f7 = new Browser39Fetcher({ fetchTimeoutMs: 3000, thinThresholdChars: 300, browser39Bin: fakeBin, sessionsRoot: sessRoot })
  const page = await f7.fetch('http://a.example/one', { sessionKey: 'a.example' })
  delete process.env.FAKE_B39_MD
  check('A7a: 200 + long content → full', page.quality === 'full' && page.status === 200 && page.content.length === LONG.length, JSON.stringify({ q: page.quality, s: page.status, len: page.content.length }))
  process.env.FAKE_B39_LINKS = JSON.stringify([{ href: '/rel', text: 'rel link' }])
  const page2 = await f7.fetch('http://a.example/base', { sessionKey: 'a.example' })
  delete process.env.FAKE_B39_LINKS
  check('A7b: relative link resolved against final URL',
    page2.links.length === 1 && page2.links[0].url === 'http://a.example/rel' && page2.links[0].text === 'rel link',
    JSON.stringify(page2.links))
}

// A8: dead binary → spawn_failed (FetchError shape)
{
  let err = null
  const dead = new Browser39Fetcher({ fetchTimeoutMs: 500, thinThresholdChars: 300, browser39Bin: join(dir, 'definitely-missing-bin') })
  try { await dead.fetch('http://a.example/x') } catch (e) { err = e }
  check('A8: dead binary → spawn_failed', err instanceof FetchError && err.code === 'spawn_failed', err && err.code + ': ' + err.message)
}

// A9: timeout kills the process group (no orphan)
{
  let err = null
  const idleBin = join(dir, 'idleb39')
  writeFileSync(idleBin, '#!/usr/bin/env node\\nif (process.env.FAKE_B39_PID) require("node:fs").writeFileSync(process.env.FAKE_B39_PID, String(process.pid))\\nsetInterval(() => {}, 1 << 30)\\n')
  chmodSync(idleBin, 0o755)
  const idler = new Browser39Fetcher({ fetchTimeoutMs: 400, thinThresholdChars: 300, browser39Bin: idleBin, sessionsRoot: sessRoot })
  const t0 = Date.now()
  try { await idler.fetch('http://a.example/slow') } catch (e) { err = e }
  const dt = Date.now() - t0
  check('A9: timeout → fetch_failed (timed out)', err instanceof FetchError && /timed out/.test(err.message), err && err.message + ' (' + dt + 'ms)')
  check('A9: ~400ms deadline held', dt >= 350 && dt < 3000, dt + 'ms')
  await sleep(300)
  const pid = Number(readFileSync(pidPath, 'utf8'))
  check('A9: idle process killed (no orphan)', !isAlive(pid), 'pid ' + pid + ' alive')
}

// A10: abort kills the process group
{
  const idleBin = join(dir, 'idleb39-2')
  writeFileSync(idleBin, '#!/usr/bin/env node\\nif (process.env.FAKE_B39_PID) require("node:fs").writeFileSync(process.env.FAKE_B39_PID, String(process.pid))\\nsetInterval(() => {}, 1 << 30)\\n')
  chmodSync(idleBin, 0o755)
  const idler = new Browser39Fetcher({ fetchTimeoutMs: 30000, thinThresholdChars: 300, browser39Bin: idleBin, sessionsRoot: sessRoot })
  const ac = new AbortController()
  setTimeout(() => ac.abort(), 100)
  let err = null
  try { await idler.fetch('http://a.example/abort', { signal: ac.signal }) } catch (e) { err = e }
  check('A10: abort → fetch_failed (aborted)', err instanceof FetchError && /aborted/.test(err.message), err && err.message)
  await sleep(300)
  const pid = Number(readFileSync(pidPath, 'utf8'))
  check('A10: aborted process killed (no orphan)', !isAlive(pid), 'pid ' + pid + ' alive')
}

console.log(fail === 0 ? 'harness A: all checks passed' : 'harness A: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// --- Harness B: real browser39 + local server ---------------------------------
const harnessB = `
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Browser39Fetcher } from '${abs('../src/host/fetcher.ts')}'
import { ensureSessionDir } from '${abs('../src/host/sessions.ts')}'

let fail = 0
const check = (label, cond, detail) => { if (cond) console.log('ok   ' + label); else { fail++; console.error('FAIL ' + label + (detail ? ' :: ' + detail : '')) } }

const sessRoot = mkdtempSync(join(tmpdir(), 'smoke-sessions-b-'))
const FILLER = 'lorem ipsum dolor sit amet '.repeat(40)

const pages = {
  '/set': { status: 200, setCookie: 'probe=cookie123; Path=/', body: '<html><head><title>Set</title></head><body><h1>Set</h1><p>' + FILLER + '</p></body></html>' },
  '/set2': { status: 200, setCookie: 'probe2=other456; Path=/', body: '<html><head><title>Set2</title></head><body><h1>Set2</h1><p>' + FILLER + '</p></body></html>' },
  '/echo': { status: 200, body: '<html><head><title>Echo</title></head><body>COOKIE-ECHO:</body></html>' },
}
const server = http.createServer((req, res) => {
  const spec = pages[req.url.split('?')[0]]
  if (!spec) { res.writeHead(404); res.end('nope'); return }
  let body = spec.body
  if (req.url.split('?')[0] === '/echo') {
    body = body.replace('COOKIE-ECHO:', 'COOKIE-ECHO:' + (req.headers.cookie || '(none)') + ' FILLER:' + FILLER)
  }
  const headers = { 'Content-Type': 'text/html; charset=utf-8' }
  if (spec.setCookie) headers['Set-Cookie'] = spec.setCookie
  res.writeHead(spec.status, headers)
  res.end(body)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = 'http://127.0.0.1:' + server.address().port
const hostDir = join(sessRoot, '127.0.0.1')
const sessionEnc = join(hostDir, 'session.enc')

const mkFetcher = (over = {}) => new Browser39Fetcher({
  fetchTimeoutMs: 20000,
  thinThresholdChars: 300,
  sessionsRoot: sessRoot,
  ...over,
})

// B1: /set → receipt ok + session dir + config + session.enc on disk
{
  const f = mkFetcher()
  const page = await f.fetch(base + '/set', { sessionKey: '127.0.0.1' })
  check('B1: /set receipt (200, full)', page.status === 200 && page.quality === 'full', JSON.stringify({ s: page.status, q: page.quality }))
  check('B1: session dir + config.toml created', existsSync(join(hostDir, 'config.toml')))
  check('B1: session.enc written by browser39', existsSync(sessionEnc) && statSync(sessionEnc).size > 0, existsSync(sessionEnc) ? String(statSync(sessionEnc).size) : 'missing')
}

// B2: NEW fetcher instance → /echo reflects the persisted cookie
{
  const f = mkFetcher() // fresh instance = new browser39 process
  const page = await f.fetch(base + '/echo', { sessionKey: '127.0.0.1' })
  check('B2: cookie survives across invocations', page.content.includes('probe=cookie123'), JSON.stringify(page.content.slice(0, 120)))
}

// B3: host dir naming — hostname only, no port, no stray dirs
{
  const f = mkFetcher()
  await f.fetch(base + '/set', { sessionKey: '127.0.0.1' })
  const entries = readdirSync(sessRoot)
  check('B3: exactly one host dir, no port in name', JSON.stringify(entries) === JSON.stringify(['127.0.0.1']) && !entries.some((e) => e.includes(':')), JSON.stringify(entries))
}

// B4: persistSessions:false → in-memory; session.enc untouched, cookie absent
{
  const before = existsSync(sessionEnc) ? { size: statSync(sessionEnc).size, mtimeMs: statSync(sessionEnc).mtimeMs } : null
  const off = mkFetcher({ persistSessions: false })
  const page = await off.fetch(base + '/set2', { sessionKey: '127.0.0.1' })
  check('B4a: off fetch ok', page.status === 200, JSON.stringify({ s: page.status }))
  const after = existsSync(sessionEnc) ? { size: statSync(sessionEnc).size, mtimeMs: statSync(sessionEnc).mtimeMs } : null
  check('B4b: session.enc untouched when off', before !== null && after !== null && before.size === after.size && before.mtimeMs === after.mtimeMs, JSON.stringify({ before, after }))
  const on = mkFetcher()
  const echo = await on.fetch(base + '/echo', { sessionKey: '127.0.0.1' })
  check('B4c: off-session cookie NOT persisted (probe2 absent, probe present)',
    !echo.content.includes('other456') && echo.content.includes('probe=cookie123'),
    JSON.stringify(echo.content.slice(0, 160)))
}

// B5: host dir holds exactly config.toml + session.enc (nothing stray)
{
  const entries = readdirSync(hostDir).sort()
  check('B5: host dir = config.toml + session.enc only', JSON.stringify(entries) === JSON.stringify(['config.toml', 'session.enc']), JSON.stringify(entries))
}

server.close()
console.log(fail === 0 ? 'harness B: all checks passed' : 'harness B: ' + fail + ' FAILURES')
process.exit(fail === 0 ? 0 : 1)
`

// --- run both ------------------------------------------------------------------
// M5 5.4: hermetic host-scoped session dirs (never touch ~/.dsh/browser39/sessions).
const outerSess = mkdtempSync(join(tmpdir(), 'smoke-sessions-outer-'))
process.env.BROWSER39_SESSIONS_DIR = join(outerSess, 'default')
let rc = 0

const { spawnSync } = await import('node:child_process')
const dirA = mkdtempSync(join(tmpdir(), 'smoke-sessions-a-outer-'))
try {
  writeFileSync(join(dirA, 'a.ts'), harnessA)
  buildSync({ entryPoints: [join(dirA, 'a.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirA, 'a.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirA, 'a.mjs')], { encoding: 'utf8', env: { ...process.env }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness A exit ' + out.status) }
} finally {
  rmSync(dirA, { recursive: true, force: true })
}

const dirB = mkdtempSync(join(tmpdir(), 'smoke-sessions-b-outer-'))
try {
  writeFileSync(join(dirB, 'b.ts'), harnessB)
  buildSync({ entryPoints: [join(dirB, 'b.ts')], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: join(dirB, 'b.mjs'), absWorkingDir: here })
  const out = spawnSync(process.execPath, [join(dirB, 'b.mjs')], { encoding: 'utf8', env: { ...process.env, BROWSER39_BIN: platformBin }, stdio: ['ignore', 'inherit', 'inherit'] })
  if (out.status !== 0) { rc = 1; console.error('harness B exit ' + out.status) }
} finally {
  rmSync(dirB, { recursive: true, force: true })
}

process.exit(rc)
