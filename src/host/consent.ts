/**
 * C10 — consent tactic seam (M5 5.5, consent v0).
 *
 * Ported from `~/dev/eris/src/tools/web/consent.rs` (Eris). Deterministic
 * Host code — never model-facing: when a FRESH fetch (no cache hit) comes
 * back `thin` with a CMP marker signal, the TACTICS run in the same host
 * session. v0 = [LabelClickTactic]: for each merged accept label (host
 * profile ∪ generic) up to `consentMaxAttempts`, one browser39 invocation
 * tries to accept and re-fetches the page; the longest result wins.
 *
 * Transport reality (probed on 2.0.0, 2026-10-13):
 *  - the JSONL protocol has NO `click` action (Eris's 1.7.x had one).
 *  - fetch-by-text WORKS: navigating to a link whose text matches the label
 *    is a real navigation — its `Set-Cookie` lands in the host session and
 *    the measuring refetch sees it (cookie persistence: 5.4).
 *  - `dom_query` + `element.click()` is a best-effort secondary: the script
 *    runs in the V8 sandbox, but page inline handlers do not fire in 2.0.0,
 *    so it only clears CMPs on transports where it is honored (harmless no-op
 *    otherwise). The cookie-preload escape hatch (5.4 host config) stays the
 *    floor for iframe/SPA CMPs.
 *
 * Budget (D-M5.5): consent batches are the SAME fetch call — the fetch was
 * already charged pre-spawn; consent adds batch invocations only
 * (≤ `consentMaxAttempts`), never budget.
 *
 * Profiles: shipped asset `assets/consent_profiles.toml`; the override
 * `.dsh/web-missions/consent_profiles.toml` (mission root) replaces it
 * wholesale. Malformed override → `consent_profiles_invalid` (fail-loud,
 * config/allowlist discipline). A missing shipped asset degrades to the
 * code defaults (broken-install defense).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ConsentAttempt, FetchedPage } from '../shared/types'

// ---------------------------------------------------------------------------
// Profiles (asset + override)
// ---------------------------------------------------------------------------

export interface ConsentHostProfile {
  host: string
  acceptLabels: string[]
}

export interface ConsentProfiles {
  generic: string[]
  hosts: ConsentHostProfile[]
}

/** Fail-loud error (config discipline): rendered `consent_profiles_invalid: <detail>`. */
export class ConsentProfilesError extends Error {
  readonly code = 'consent_profiles_invalid'
  constructor(detail: string) {
    super(detail)
    this.name = 'ConsentProfilesError'
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+$/

function fail(source: string, line: number, detail: string): never {
  throw new ConsentProfilesError(`${source}: line ${line}: ${detail}`)
}

function stripComment(line: string): string {
  let inDouble = false
  let inSingle = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inDouble) {
      if (c === '\\') i++
      else if (c === '"') inDouble = false
    } else if (inSingle) {
      if (c === "'") inSingle = false
    } else if (c === '"') {
      inDouble = true
    } else if (c === "'") {
      inSingle = true
    } else if (c === '#') {
      return line.slice(0, i)
    }
  }
  return line
}

function parseString(raw: string, source: string, line: number): string {
  const s = raw.trim()
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const body = s.slice(1, -1)
    let out = ''
    for (let i = 0; i < body.length; i++) {
      const c = body[i]
      if (c !== '\\') {
        out += c
        continue
      }
      const e = body[++i]
      if (e === 'n') out += '\n'
      else if (e === 't') out += '\t'
      else if (e === 'r') out += '\r'
      else if (e === '"' || e === '\\') out += e
      else if (e === 'u') {
        const hex = body.slice(i + 1, i + 5)
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail(source, line, `bad \\u escape in string`)
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
      } else fail(source, line, `bad escape \\${e} in string`)
    }
    return out
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1)
  }
  fail(source, line, `expected a quoted string, got: ${s.slice(0, 40)}`)
}

function parseValue(raw: string, source: string, line: number): string | string[] {
  const s = raw.trim()
  if (s === '') fail(source, line, 'missing value')
  if (s.startsWith('[')) {
    if (!s.endsWith(']')) fail(source, line, 'unterminated array')
    let inner = s.slice(1, -1).trim()
    if (inner.endsWith(',')) inner = inner.slice(0, -1).trim() // trailing comma (TOML allows it)
    if (inner === '') return []
    const parts = splitTopLevel(inner, source, line)
    return parts.map((p) => parseString(p, source, line))
  }
  return parseString(s, source, line)
}

/** Split on top-level commas (not inside quotes). */
function splitTopLevel(s: string, source: string, line: number): string[] {
  const out: string[] = []
  let cur = ''
  let inDouble = false
  let inSingle = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inDouble) {
      cur += c
      if (c === '\\') cur += s[++i]
      else if (c === '"') inDouble = false
    } else if (inSingle) {
      cur += c
      if (c === "'") inSingle = false
    } else if (c === '"') {
      inDouble = true
      cur += c
    } else if (c === "'") {
      inSingle = true
      cur += c
    } else if (c === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  if (inDouble || inSingle) fail(source, line, 'unterminated string in array')
  out.push(cur)
  return out
}

/**
 * Parse the v0 TOML subset: comments, blank lines, `key = string | [strings]`
 * (arrays may span lines), `[table]` / `[[table]]`, bare or quoted keys.
 * Anything else → ConsentProfilesError with the line number.
 */
export function parseConsentProfiles(text: string, source: string): ConsentProfiles {
  const root: Record<string, unknown> = {}
  let current: Record<string, unknown> | null = null
  // `[[hosts]]` elements are created here as tables keyed by index.
  const tables: Record<string, Record<string, unknown>[]> = {}

  // Accumulate logical lines (arrays may span physical lines), tracking
  // original line numbers for errors.
  const logical: { text: string; line: number }[] = []
  let buf = ''
  let bufLine = 0
  let depth = 0
  for (const [idx, phys] of text.split('\n').entries()) {
    const stripped = stripComment(phys).trim()
    if (buf === '' && stripped === '') continue
    if (buf === '') bufLine = idx + 1
    buf += (buf === '' ? '' : ' ') + stripped
    depth = bracketDepth(buf)
    if (depth <= 0) {
      logical.push({ text: buf, line: bufLine })
      buf = ''
    }
  }
  if (buf !== '') fail(source, bufLine, `unterminated array: ${buf.slice(0, 40)}`)

  for (const { text: l, line } of logical) {
    if (l.startsWith('[[')) {
      if (!l.endsWith(']]')) fail(source, line, 'malformed [[table]] header')
      const name = l.slice(2, -2).trim()
      if (!BARE_KEY.test(name)) fail(source, line, `bad table name: ${name}`)
      const arr = (tables[name] ??= [])
      const table: Record<string, unknown> = {}
      arr.push(table)
      current = table
      continue
    }
    if (l.startsWith('[')) {
      if (!l.endsWith(']')) fail(source, line, 'malformed [table] header')
      const name = l.slice(1, -1).trim()
      if (!BARE_KEY.test(name)) fail(source, line, `bad table name: ${name}`)
      const table: Record<string, unknown> = {}
      root[name] = table
      current = table
      continue
    }
    const eq = findTopLevelEq(l)
    if (eq < 0) fail(source, line, `expected key = value: ${l.slice(0, 40)}`)
    const key = l.slice(0, eq).trim()
    if (key === '') fail(source, line, 'missing key')
    if (!BARE_KEY.test(key)) fail(source, line, `bad key: ${key}`)
    const value = parseValue(l.slice(eq + 1), source, line)
    if (current) current[key] = value
    else root[key] = value
  }

  for (const name of Object.keys(tables)) root[name] = tables[name]

  // ---- validate the schema (strict: unknown keys are an error) ------------
  const out: ConsentProfiles = { generic: [], hosts: [] }
  for (const [key, value] of Object.entries(root)) {
    if (key === 'generic') {
      if (typeof value === 'string') out.generic = [value]
      else if (Array.isArray(value) && value.every((v) => typeof v === 'string'))
        out.generic = value as string[]
      else fail(source, 0, '`generic` must be a string array')
    } else if (key === 'hosts') {
      if (!Array.isArray(value)) fail(source, 0, '`hosts` must be an array of tables')
      for (const entry of value) {
        if (typeof entry !== 'object' || entry === null)
          fail(source, 0, 'each [[hosts]] table must be a table')
        const t = entry as Record<string, unknown>
        for (const hk of Object.keys(t)) {
          if (hk !== 'host' && hk !== 'acceptLabels')
            fail(source, 0, `unknown key in [[hosts]]: ${hk}`)
        }
        const host = t.host
        if (typeof host !== 'string' || host.trim() === '')
          fail(source, 0, '[[hosts]] requires a non-empty `host` string')
        let labels: string[] = []
        if (t.acceptLabels !== undefined) {
          if (
            !Array.isArray(t.acceptLabels) ||
            !(t.acceptLabels as unknown[]).every((v) => typeof v === 'string')
          )
            fail(source, 0, '`acceptLabels` must be a string array')
          labels = t.acceptLabels as string[]
        }
        out.hosts.push({ host: host.trim(), acceptLabels: labels })
      }
    } else {
      fail(source, 0, `unknown top-level key: ${key} (expected: generic, hosts)`)
    }
  }
  return out
}

function bracketDepth(s: string): number {
  let d = 0
  let inDouble = false
  let inSingle = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inDouble) {
      if (c === '\\') i++
      else if (c === '"') inDouble = false
    } else if (inSingle) {
      if (c === "'") inSingle = false
    } else if (c === '"') inDouble = true
    else if (c === "'") inSingle = true
    else if (c === '[') d++
    else if (c === ']') d--
  }
  return d
}

function findTopLevelEq(s: string): number {
  let inDouble = false
  let inSingle = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inDouble) {
      if (c === '\\') i++
      else if (c === '"') inDouble = false
    } else if (inSingle) {
      if (c === "'") inSingle = false
    } else if (c === '"') inDouble = true
    else if (c === "'") inSingle = true
    else if (c === '=') return i
  }
  return -1
}

/** Code defaults — mirror of the shipped asset (broken-install defense). */
const DEFAULT_PROFILES: ConsentProfiles = {
  generic: [
    'Accept all',
    'Alle akzeptieren',
    'Zustimmen',
    'Akzeptieren',
    'Allow all',
    'I agree',
    'Yes, I agree',
    'Agree',
    'Einverstanden',
  ],
  hosts: [
    { host: 'kicker.de', acceptLabels: ['Alle akzeptieren', 'Accept all', 'Zustimmen', 'Akzeptieren'] },
    { host: 'gamestar.de', acceptLabels: ['Alle akzeptieren', 'Accept all', 'Zustimmen', 'I agree'] },
    { host: 'bbc.com', acceptLabels: ['Yes, I agree', 'Allow all', 'Accept'] },
    { host: 'spiegel.de', acceptLabels: ['Alle akzeptieren', 'Akzeptieren', 'Zustimmen'] },
    { host: 'taz.de', acceptLabels: ['Alle akzeptieren', 'Akzeptieren', 'Zustimmen'] },
  ],
}

function shippedAssetPath(): string {
  // The bundle is <pkg>/lib/index.js → the package root is one level up.
  // (Same import.meta.url pattern as skill.ts; link:/ and npm installs both
  // keep assets/ next to lib/.)
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'consent_profiles.toml')
}

/**
 * Load the consent profiles for a mission:
 *   1. override `<missionRoot>/consent_profiles.toml` (fail-loud if malformed)
 *   2. shipped asset (degrade to code defaults if missing/unreadable)
 */
export function loadConsentProfiles(missionRoot: string): ConsentProfiles {
  const override = join(missionRoot, 'consent_profiles.toml')
  try {
    return parseConsentProfiles(readFileSync(override, 'utf8'), override)
  } catch (e) {
    if (e instanceof ConsentProfilesError) throw e
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      // Unreadable (not missing) override → fail loud, do not guess.
      throw new ConsentProfilesError(`cannot read ${override}: ${(e as Error).message}`)
    }
  }
  try {
    return parseConsentProfiles(readFileSync(shippedAssetPath(), 'utf8'), 'assets/consent_profiles.toml')
  } catch (e) {
    if (e instanceof ConsentProfilesError) {
      // A malformed SHIPPED asset is our bug — but do not break the fetch
      // over it (config defaults are the same vocabulary anyway).
      return DEFAULT_PROFILES
    }
    return DEFAULT_PROFILES
  }
}

/**
 * Merged accept labels for a host (Eris `accept_texts_for_host`): the host
 * profile's labels (matched case-insensitively on the lowercased hostname,
 * no port) first, then the generic list; case-insensitive dedupe (first
 * occurrence's casing kept).
 */
export function labelsForHost(profiles: ConsentProfiles, host: string): string[] {
  const key = host.trim().toLowerCase()
  const out: string[] = []
  const seen = new Set<string>()
  const profile = profiles.hosts.find((p) => p.host.toLowerCase() === key)
  for (const label of profile?.acceptLabels ?? []) pushLabel(out, seen, label)
  for (const label of profiles.generic) pushLabel(out, seen, label)
  return out
}

function pushLabel(out: string[], seen: Set<string>, label: string): void {
  const k = label.trim().toLowerCase()
  if (k === '' || seen.has(k)) return
  seen.add(k)
  out.push(label)
}

// ---------------------------------------------------------------------------
// Tactic seam
// ---------------------------------------------------------------------------

/** C10 outcome → receipt (`consent_attempted` / `consent_improved`). */
export interface ConsentOutcome {
  attempted: boolean
  /** Best page strictly longer than the initial page. */
  improved: boolean
  /** Every accept-label attempt matched nothing (link/element not found). */
  allClicksFailed: boolean
}

/** One consent attempt result (one browser39 invocation, same host session). */
export type { ConsentAttempt }

export interface ConsentDeps {
  host: string
  url: string
  labels: string[]
  /** Links on the thin page (already allowlist-admitted by the caller). */
  links: { url: string; text: string }[]
  thinThreshold: number
  maxAttempts: number
  /**
   * One consent attempt in ONE browser39 invocation of the host session:
   * restore the page, click the label (best-effort), navigate the matching
   * link if any, measuring refetch. null = the batch failed (spawn/timeout) —
   * the attempt is counted and the loop continues.
   */
  attempt: (label: string, linkUrl: string | null) => Promise<ConsentAttempt | null>
}

export interface ConsentTacticResult {
  /** Best page found; null = no attempt beat the initial page. */
  page: FetchedPage | null
  clicksTotal: number
  clicksFailed: number
}

/** C10 tactic seam — "one seam, one v0 implementation" (DESIGN.md §C10). */
export interface ConsentTactic {
  readonly id: string
  run(page: FetchedPage, deps: ConsentDeps): Promise<ConsentTacticResult>
}

/**
 * Eris-faithful port: for each label (up to maxAttempts) run one consent
 * batch, keep the best by char count, stop once the refetch is
 * ≥ thinThreshold.
 */
export class LabelClickTactic implements ConsentTactic {
  readonly id = 'label-click'

  async run(page: FetchedPage, deps: ConsentDeps): Promise<ConsentTacticResult> {
    let best: FetchedPage | null = null
    let total = 0
    let failed = 0
    for (const label of deps.labels.slice(0, deps.maxAttempts)) {
      total++
      const link = matchLink(deps.links, label)
      let attempt: ConsentAttempt | null = null
      try {
        attempt = await deps.attempt(label, link ? link.url : null)
      } catch {
        attempt = null
      }
      if (attempt === null) {
        failed++
        continue
      }
      if (!attempt.clicked) failed++
      if (attempt.page === null) continue
      // keep the longest result
      if (best === null || attempt.page.content.length > best.content.length) {
        best = attempt.page
      }
      if (attempt.page.content.length >= deps.thinThreshold) break
    }
    return { page: best, clicksTotal: total, clicksFailed: failed }
  }
}

/** v0 tactic list (the seam — future tactics append here). */
export const TACTICS: ConsentTactic[] = [new LabelClickTactic()]

/** Exact (trimmed, case-insensitive) link-text match — CMP buttons are exact text. */
export function matchLink(
  links: { url: string; text: string }[],
  label: string,
): { url: string; text: string } | null {
  const t = label.trim().toLowerCase()
  if (t === '') return null
  return links.find((l) => l.text.trim().toLowerCase() === t) ?? null
}

/** A fresh page needs consent work when it is thin AND a CMP marker hit. */
export function isConsentWall(page: FetchedPage): boolean {
  if (page.quality !== 'thin') return false
  return page.qualitySignals.some((s) => s.startsWith('cmp-marker:'))
}

/**
 * Run the TACTICS over a thin CMP page. Returns the page to store (best of
 * initial + attempts, with the consent flags set) plus the outcome.
 * No-op (attempted:false) when there is nothing to try.
 */
export async function runConsent(
  page: FetchedPage,
  deps: ConsentDeps,
): Promise<{ page: FetchedPage; outcome: ConsentOutcome }> {
  if (deps.maxAttempts <= 0 || deps.labels.length === 0) {
    return {
      page,
      outcome: { attempted: false, improved: false, allClicksFailed: false },
    }
  }

  let best = page
  let total = 0
  let failed = 0
  for (const tactic of TACTICS) {
    const res = await tactic.run(best, deps)
    total += res.clicksTotal
    failed += res.clicksFailed
    if (res.page !== null && res.page.content.length > best.content.length) {
      best = res.page
    }
  }

  const improved = best.content.length > page.content.length
  const outcome: ConsentOutcome = {
    attempted: true,
    improved,
    allClicksFailed: total > 0 && failed >= total,
  }
  const out: FetchedPage =
    best === page ? { ...page } : { ...best }
  out.consentAttempted = true
  out.consentImproved = improved
  return { page: out, outcome }
}

/**
 * Deterministic next-step hint text (C10 outcome → receipt; the 5.6 honesty
 * gate generalizes this to every thin/blocked receipt).
 */
export function consentNextStepHint(page: FetchedPage, outcome: ConsentOutcome): string {
  const base =
    page.quality === 'blocked'
      ? 'fetch blocked (see quality_signals) — do not re-fetch this URL; pick another'
      : 'page is thin (short or likely a consent wall) — try a sample link or re-fetch with force'
  if (!outcome.attempted) return base
  if (outcome.improved) {
    const after =
      page.quality === 'full'
        ? 'search it with mission_find or fetch one of the sample links'
        : 'still thin — try a sample link or re-fetch with force'
    return `consent: accept worked — page improved; ${after}`
  }
  return (
    `${base}. consent: accept was attempted but the wall persists — do not claim content from ` +
    `this page. Operator escape: preload the accepted cookies into the host session ` +
    `(~/.dsh/browser39/sessions/<host>/config.toml, [[cookies]]) and re-fetch with force.`
  )
}
