/**
 * Egress allowlist (M5 5.2 — M_5_ledger.md "Allowlist (egress control,
 * dogfood on)").
 *
 * Patterns file: `<cwd>/.dsh/allowlist.txt` — project-level (sibling of the
 * `web-missions/` mission root), one pattern per line, `#` comments,
 * gitignored (the whole `.dsh/` dir is). v0 pattern grammar:
 *   host.example.com            exact host (port-insensitive, case-insensitive)
 *   *.example.com               host suffix — ALL subdomains + the apex itself
 *   http(s)://host/path         exact origin + path PREFIX
 *
 * Deny-all default: an empty or missing file admits NOTHING (the dogfood
 * profile is locked down; the documented escape is config `allowlist: 'off'`).
 * An invalid pattern line is an operator error → `allowlist_invalid` (fail
 * loud, never silently widen or narrow the gate).
 *
 * Gate point (D-M5.4): in `mission_fetch`, AFTER normalization, BEFORE the
 * spawn — and ONLY when a spawn is about to happen. Cache hits are NOT
 * re-gated (the page was already admitted). A denial is zero-cost: no spawn,
 * no budget charge. S6 boundary: the allowlist covers FETCH EGRESS only —
 * discovery (M7 SearXNG / browser39-search) is outside the no-cloud claim.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { StoreError } from './store.ts'

export const ALLOWLIST_FILENAME = 'allowlist.txt'

/** A parsed allowlist line (discriminated union — v0 grammar). */
export type AllowPattern =
  | { kind: 'host'; host: string }
  | { kind: 'suffix'; suffix: string }
  | { kind: 'originPath'; origin: string; path: string }

/**
 * `<root>/…` is the mission root (`<cwd>/.dsh/web-missions`); the allowlist
 * sits one level up, at `<cwd>/.dsh/allowlist.txt` (project-level egress
 * policy, shared by every mission of the project).
 */
export function allowlistPath(root: string): string {
  return join(dirname(root), ALLOWLIST_FILENAME)
}

function parsePattern(line: string): AllowPattern {
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

/**
 * Read + parse the patterns file. MISSING file → `[]` (deny all — the
 * locked-down default); unreadable (not just missing) → StoreError. The file
 * is re-read on every gate call (small; operator edits apply immediately,
 * same contract as config.json).
 */
export function loadAllowlist(root: string): AllowPattern[] {
  let raw: string
  try {
    raw = readFileSync(allowlistPath(root), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
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
    if (p.kind === 'host' && host === p.host) return true
    if (p.kind === 'suffix' && (host === p.suffix || host.endsWith(`.${p.suffix}`))) return true
    if (p.kind === 'originPath' && u.origin === p.origin && u.pathname.startsWith(p.path)) return true
  }
  return false
}

/**
 * The gate: deny-all default (no patterns → deny), throws
 * `allowlist_denied: <url> not in .dsh/allowlist.txt` when nothing admits.
 */
export function checkAllowlist(url: string, patterns: AllowPattern[]): void {
  if (!isAllowed(url, patterns)) {
    throw new StoreError('allowlist_denied', `${url} not in .dsh/allowlist.txt`)
  }
}
