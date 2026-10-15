/**
 * Egress allowlist (M5 5.2 + R1.5 Eris-style survivability).
 *
 * Patterns file: `<cwd>/.dsh/allowlist.txt` — project-level (sibling of the
 * `web-missions/` mission root), one pattern per line, `#` comments,
 * gitignored (the whole `.dsh/` dir is). v0 pattern grammar:
 *   host.example.com            exact host (port-insensitive, case-insensitive)
 *   *.example.com               host suffix — ALL subdomains + the apex itself
 *   http(s)://host/path         exact origin + path PREFIX
 *   **                          allow-all http(s) (file-level escape hatch)
 *
 * Gate is only active when config `allowlist: 'on'` (default is **off** — G2).
 * When on: missing file → seed template + `allowlist_empty`; empty patterns
 * → `allowlist_empty`; denied URL → `allowlist_denied` naming the off-switch.
 *
 * Gate point (D-M5.4): in `mission_fetch`, AFTER normalization, BEFORE the
 * spawn — and ONLY when a spawn is about to happen. Cache hits are NOT
 * re-gated. A denial is zero-cost: no spawn, no budget charge.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StoreError } from './store.ts'

export const ALLOWLIST_FILENAME = 'allowlist.txt'

/** A parsed allowlist line (discriminated union — v0 grammar). */
export type AllowPattern =
  | { kind: 'host'; host: string }
  | { kind: 'suffix'; suffix: string }
  | { kind: 'originPath'; origin: string; path: string }
  | { kind: 'all' }

const DENY_HINT =
  ' (set allowlist: "off" in .dsh/web-missions/config.json to disable the gate, or add the host to .dsh/allowlist.txt)'

/**
 * `<root>/…` is the mission root (`<cwd>/.dsh/web-missions`); the allowlist
 * sits one level up, at `<cwd>/.dsh/allowlist.txt` (project-level egress
 * policy, shared by every mission of the project).
 */
export function allowlistPath(root: string): string {
  return join(dirname(root), ALLOWLIST_FILENAME)
}

function parsePattern(line: string): AllowPattern {
  if (line === '**') return { kind: 'all' }
  if (line.startsWith('*.')) {
    const suffix = line.slice(2).toLowerCase()
    if (!suffix) throw new StoreError('allowlist_invalid', `invalid pattern: ${line}`)
    return { kind: 'suffix', suffix }
  }
  if (line.includes('://')) {
    let u: URL
    try {
      u = new URL(line)
    } catch {
      throw new StoreError('allowlist_invalid', `invalid pattern (not a URL): ${line}`)
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new StoreError('allowlist_invalid', `invalid pattern (only http/https allowed): ${line}`)
    }
    return { kind: 'originPath', origin: u.origin, path: u.pathname }
  }
  const host = line.toLowerCase()
  if (!host || host.includes('/') || host.includes('*')) {
    throw new StoreError('allowlist_invalid', `invalid pattern: ${line}`)
  }
  return { kind: 'host', host }
}

/**
 * Parse allowlist text → patterns. Trims lines; skips blanks and `#`
 * comments; an invalid line throws `allowlist_invalid` (with the line number).
 */
export function parseAllowlist(text: string): AllowPattern[] {
  const patterns: AllowPattern[] = []
  text.split('\n').forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    try {
      patterns.push(parsePattern(line))
    } catch (error) {
      if (error instanceof StoreError) {
        throw new StoreError('allowlist_invalid', `line ${i + 1}: ${error.message}`)
      }
      throw error
    }
  })
  return patterns
}

/** Seed a commented template when the file is missing (Eris survivability). */
export function seedAllowlistTemplate(root: string): string {
  const path = allowlistPath(root)
  if (existsSync(path)) return path
  mkdirSync(dirname(path), { recursive: true })
  let body: string
  try {
    const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    body = readFileSync(join(pkgRoot, 'assets', 'allowlist.txt.template'), 'utf8')
  } catch {
    body =
      '# dsh-web-missions egress allowlist\n' +
      '# Add hosts (one per line), or use ** to allow all.\n' +
      '# Gate on only when config allowlist: "on". Default is off.\n'
  }
  writeFileSync(path, body, { flag: 'wx' })
  return path
}

/**
 * Read + parse the patterns file. MISSING file → seed template + return []
 * (caller should surface allowlist_empty). Unreadable (not just missing) →
 * StoreError. Re-read on every gate call.
 */
export function loadAllowlist(root: string): AllowPattern[] {
  const path = allowlistPath(root)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      seedAllowlistTemplate(root)
      return []
    }
    throw new StoreError(
      'allowlist_unreadable',
      `cannot read ${ALLOWLIST_FILENAME}: ${(error as Error).message}`,
    )
  }
  return parseAllowlist(raw)
}

/** True when any pattern admits the URL (http/https only; unparseable = no). */
export function isAllowed(url: string, patterns: AllowPattern[]): boolean {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return false
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
  const host = u.hostname.toLowerCase()
  for (const p of patterns) {
    if (p.kind === 'all') return true
    if (p.kind === 'host' && host === p.host) return true
    if (p.kind === 'suffix' && (host === p.suffix || host.endsWith(`.${p.suffix}`))) return true
    if (p.kind === 'originPath' && u.origin === p.origin && u.pathname.startsWith(p.path)) return true
  }
  return false
}

/**
 * The gate: empty patterns → `allowlist_empty` (distinct from a miss);
 * otherwise `allowlist_denied` naming the off-switch.
 */
export function checkAllowlist(url: string, patterns: AllowPattern[]): void {
  if (patterns.length === 0) {
    throw new StoreError(
      'allowlist_empty',
      `.dsh/allowlist.txt has no patterns — add hosts (or **) then retry, or set allowlist: "off" in .dsh/web-missions/config.json`,
    )
  }
  if (!isAllowed(url, patterns)) {
    throw new StoreError('allowlist_denied', `${url} not in .dsh/allowlist.txt${DENY_HINT}`)
  }
}
