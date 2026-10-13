// M8 8.2 verification — run the REAL gate (src/host/allowlist.ts) over the
// real .dsh/allowlist.txt: every fixture URL admitted, non-fixture hosts
// denied. The tree is esbuild-only (extensionless TS imports), so run via:
//   node scripts/run-ts-check.mjs scripts/check-m8-allowlist.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAllowlist, isAllowed } from '../src/host/allowlist.ts'

// Bundled output lives in a temp dir, so the repo root is passed by the runner.
const repo = process.env.DSH_CHECK_REPO_ROOT ?? process.cwd()
const fixture = JSON.parse(readFileSync(join(repo, 'fixtures', 'partner-daten.json'), 'utf8'))
const patterns = parseAllowlist(readFileSync(join(repo, '.dsh', 'allowlist.txt'), 'utf8'))

let fail = 0
const check = (label: string, cond: boolean): void => {
  console.log(`${cond ? 'OK ' : 'BAD'} ${label}`)
  if (!cond) fail++
}

check(`parsed ${patterns.length} patterns (expect 11)`, patterns.length === 11)

// 1) every fixture URL admitted
for (const e of fixture.entities) {
  for (const url of e.urls) {
    check(`admits fixture ${url}`, isAllowed(url, patterns))
  }
}

// 2) apex (no www) + subdomains admitted for each fixture host (the plan's
//    "+ www. forms" — suffix lines admit apex + all subdomains)
const hosts = new Set(fixture.entities.flatMap((e) => e.urls.map((u) => new URL(u).hostname)))
for (const host of hosts) {
  const apex = host.replace(/^www\./, '')
  check(`admits apex https://${apex}/`, isAllowed(`https://${apex}/`, patterns))
  check(`admits sub https://foo.${apex}/`, isAllowed(`https://foo.${apex}/`, patterns))
}

// 3) non-fixture hosts denied (including the retired dogfood line, the M5
//    smoke fixture host, and suffix-boundary lookalikes)
const denied = [
  'https://127.0.0.1:8081/x',
  'http://fixturehost.example/p',
  'https://duckduckgo.com/html/?q=test',
  'https://notallianz.de/',
  'https://allianz.dev/',
  'https://allianz.de.evil.example/',
  'https://evilallianz.de/',
  'ftp://www.dkb.de/x',
]
for (const url of denied) {
  check(`denies ${url}`, !isAllowed(url, patterns))
}

console.log(fail === 0 ? '\nM8 8.2 ALLOWLIST: all checks passed' : `\n${fail} FAILURES`)
process.exit(fail ? 1 : 0)
