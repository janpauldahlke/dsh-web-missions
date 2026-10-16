/**
 * Mission store (M1, layout C1) — fs-only, no network, no ctx.
 *
 * ```
 * <root>/                    # root = <cwd>/.dsh/web-missions (C1)
 *   index.json               # recents, newest first, cap 50
 *   {mission_id}/
 *     manifest.json          # frozen shape (C1 / M1 deep design)
 *     mission.md             # model-written outcome; host creates + footer-on-stop only
 *     pages/{artifact_id}/   # M2+ (page.json / chunks / links.json)
 * ```
 *
 * Concurrency: v0 single-process. All writes go through temp-file + rename
 * (atomic replace) — no partial writes. IDs: `m-<8 hex>` (crypto random).
 */
import { randomBytes } from 'node:crypto'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_FETCH_BUDGET, readConfig } from './config.ts'
import { clearAllHostCooldowns, type HostCooldownMap } from './host-cooldown.ts'
import { clearSessionHosts, sessionsRoot } from './sessions.ts'
import { normalizeUrl } from './normalize.ts'

export { DEFAULT_FETCH_BUDGET }
export const RECENTS_CAP = 50

export type MissionStatus = 'active' | 'stopped' | 'done'

/**
 * Mission budget (C6, S5 — unit = fetch calls, live in M5). `max` is set at
 * start; `spent` is incremented on every CHARGED attempt (non-cached fetch
 * attempt — success, failure, or timeout; cache hits are free unless
 * `cacheHitCountsAsBudget` is on). `spent` is optional: M1-era manifests
 * predate it (read as 0). `remaining = max - spent` is always derived, never
 * stored.
 */
export interface MissionBudget {
  max: number
  spent?: number
}

/** View over a budget with the derived `remaining` (C4 receipt / status). */
export interface BudgetView {
  max: number
  spent: number
  remaining: number
  unit: 'fetch_calls'
}

export function budgetSpent(budget: MissionBudget): number {
  return budget.spent ?? 0
}

export function budgetRemaining(budget: MissionBudget): number {
  return budget.max - budgetSpent(budget)
}

export function budgetView(budget: MissionBudget): BudgetView {
  return { max: budget.max, spent: budgetSpent(budget), remaining: budgetRemaining(budget), unit: 'fetch_calls' }
}

/** True when no further charged attempt is allowed (remaining would go < 0). */
export function budgetExhausted(budget: MissionBudget): boolean {
  return budgetSpent(budget) >= budget.max
}

/**
 * Persist `budget.spent += 1` (C6: a charged fetch CALL, i.e. a browser
 * spawn — success, failure, or timeout). Called just before the spawn
 * attempt so a failed/timeout fetch still costs its call.
 */
export function chargeBudget(root: string, missionId: string): Manifest {
  const manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)
  manifest.budget.spent = budgetSpent(manifest.budget) + 1
  manifest.updated_at = new Date().toISOString()
  writeManifest(root, manifest)
  return manifest
}

/** Visited ledger row (D11) — written by M2+; shape frozen now. */
export interface FetchedRow {
  normalized_url: string
  url: string
  artifact_id: string
  quality: string
  fetched_at: string
  /**
   * M6 6.1 (C10 visibility): a consent tactic ran for this page. Pairs with
   * `consent_improved` — the pane's thin-page hint (and the /sessions route's
   * "last consent outcome") needs BOTH, since `consent_improved:false` alone
   * cannot tell "attempted, not improved" from "never attempted". M5-era
   * rows predate it (read as `?? false` — same pattern as `depth`).
   */
  consent_attempted?: boolean
  consent_improved?: boolean
  /**
   * M5 (C6 audit): the attempt that wrote/refreshed this row was charged
   * against the mission budget. In v0 every row is written by a charged
   * (non-cached) attempt, so this is true; the field makes the audit
   * explicit for row writers that may not charge (M7+).
   */
  budget_charged?: boolean
  /**
   * M3 (D-M2.2 extension): normalized forms of the URLs that were requested
   * when this row was written/updated (ordered, deduped). Lets a redirecting
   * URL (e.g. /redir → A) be a zero-spawn cache hit on re-fetch even though
   * the key is norm(final). Multiple aliases that collapse onto the same row
   * each survive (a re-fetch of ANY alias hits). Optional — M2-era rows
   * predate it.
   */
  requested_keys?: string[]
  /**
   * M5 5.3 (depth fence): hops from the nearest seed/root at the time this
   * row was written (0 = seed or fresh root). Optional — M2-era rows predate
   * it (read as 0). The deterministic lineage rule is in depth-fence.ts.
   */
  depth?: number
  /** M5 5.3: artifact achieving this row's minimal depth (null = root). */
  parent_artifact_id?: string | null
}

export interface Manifest {
  mission_id: string
  note: string
  template_id?: string
  budget: MissionBudget
  status: MissionStatus
  stop_reason?: string
  created_at: string
  updated_at: string
  fetched: FetchedRow[]
  /**
   * M5 5.3 (depth fence): normalized seed URLs given at mission_start. Seeds
   * are depth 0 and their HOSTS are exempt from maxDiscoveredHosts (the
   * deliberate roots of the mission). M2-era manifests predate it (treated
   * as []).
   */
  seeds?: string[]
  /**
   * Per-mission fence knobs (inherit project/global config at start; optional
   * overrides via mission_start max_depth / max_discovered_hosts). Pane +
   * status surface these for honest userland.
   */
  fence?: { maxDepth: number; maxDiscoveredHosts: number }
  /**
   * R3.2 selective goal pin — one-liner the model should answer. Defaults to
   * `note` at start; echoed on status/stop (not every fetch — token tax).
   */
  goal?: string
  /**
   * R4.2/R4.3 — first-class conclusion written at mission_stop (or mark-done
   * stub). Pane leads with this; briefing stays collapsible.
   */
  conclusion?: string
  /**
   * R4.4 — per-host wiedervorlage state (non-retriable counts + cooldown).
   * Cleared when the mission stops.
   */
  host_cooldowns?: HostCooldownMap
}

export interface IndexRow {
  mission_id: string
  note: string
  template_id?: string
  status: MissionStatus
  started_at: string
  updated_at: string
}

/** Index row + live counts (M1: summary = index row + page count + visited count). */
export interface MissionSummary extends IndexRow {
  pages: number
  visited: number
  /** M6 6.2: live budget view from the manifest (null if the manifest is gone). */
  budget?: BudgetView | null
  /** Per-mission fence (inherit/override at start) — pane displays depth cap. */
  fence?: { maxDepth: number; maxDiscoveredHosts: number } | null
  /** On-disk size of this mission dir in bytes (R3.1). */
  bytes?: number
  /** Goal pin when present on the manifest (R3.2). */
  goal?: string | null
  /** Conclusion when present (R4.2). */
  conclusion?: string | null
}

export interface StartOptions {
  note: string
  template_id?: string
  /** Omitted → DEFAULT_FETCH_BUDGET (D-M1.1). Unit: fetch calls (live in M5). */
  budget?: number
  /**
   * M5 5.3 (depth fence): seed URLs. Stored normalized + deduped; they are
   * depth 0 and their hosts are exempt from maxDiscoveredHosts. Unparsable
   * seeds fail loud (normalize_failed) like fetch urls.
   */
  seeds?: string[]
  /** Override project/global maxDepth for this mission only. */
  maxDepth?: number
  /** Override project/global maxDiscoveredHosts for this mission only. */
  maxDiscoveredHosts?: number
  /** Research question / goal one-liner (defaults to note). R3.2. */
  goal?: string
}

export interface ListResult {
  active: MissionSummary[]
  recents: MissionSummary[]
  /** Total bytes under the mission root (R3.1). */
  store_bytes?: number
}

export interface StatusResult extends Omit<Manifest, 'budget'> {
  /** C6: the manifest budget with the derived `remaining` (every status shows it). */
  budget: BudgetView
  visited: FetchedRow[]
  /** Absolute path to mission.md (pane + tools). */
  mission_md_path: string
  /** Full mission.md body for the pane briefing (R3.0). Absent file → empty string. */
  briefing: string
  /** R4.7 — remaining === 0. */
  budget_exhausted?: boolean
  /** R4.7 — wrap-up hint when budget is exhausted. */
  wrap_up_hint?: string
  /**
   * M7 (D-M7.4): the companion's discovery file, surfaced one-way
   * (dsh-web-discovery WRITES `<mission>/discovery.json`, the core only
   * reads it — the entire M7 core surface; V5 encapsulation). Discovered URLs
   * are NOT ledger rows: they enter `visited` only when the core fetches
   * them, through the allowlist gate. Absent = nothing discovered yet
   * (common case — the field is simply omitted).
   */
  discovery?: DiscoverySurface
}

/** M7: one discovered URL as written by the companion (shape owned there;
 *  the core validates minimally and surfaces it verbatim). */
export interface DiscoveryUrlEntry {
  url: string
  title?: string
  snippet?: string
  via?: { query?: string; engine?: string; at?: string }
}

export interface DiscoverySurface {
  updated_at: string
  urls: DiscoveryUrlEntry[]
}

const DISCOVERY_FILENAME = 'discovery.json'

/** Read a mission's discovery file: `null` when absent. Corrupt JSON or a
 *  wrong shape → StoreError('corrupt') — fail loud like the core's own files
 *  (discovery.json is operator-facing data, never silently dropped). */
export function readDiscoverySurface(root: string, id: string): DiscoverySurface | null {
  assertSafeId(id, 'mission')
  const parsed = readJsonFile<unknown>(join(missionDir(root, id), DISCOVERY_FILENAME))
  if (parsed === null) return null
  const file = parsed as DiscoverySurface
  if (
    file === null ||
    typeof file !== 'object' ||
    Array.isArray(file) ||
    typeof file.updated_at !== 'string' ||
    !Array.isArray(file.urls)
  ) {
    throw new StoreError('corrupt', `${DISCOVERY_FILENAME} in ${id} has a bad shape (need {updated_at: string, urls: [...]})`)
  }
  for (const entry of file.urls) {
    if (entry === null || typeof entry !== 'object' || typeof entry.url !== 'string') {
      throw new StoreError('corrupt', `${DISCOVERY_FILENAME} in ${id} has a bad urls[] entry (need {url: string, …})`)
    }
  }
  return file
}

export interface StopResult {
  manifest: Manifest
  already_stopped: boolean
}

/** Store-level error with a stable code (the tool layer renders `code: message`). */
export class StoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'StoreError'
  }
}

// --- paths ------------------------------------------------------------------

export function missionRoot(cwd: string): string {
  return join(cwd, '.dsh', 'web-missions')
}

function missionDir(root: string, id: string): string {
  return join(root, id)
}

function manifestPath(root: string, id: string): string {
  return join(missionDir(root, id), 'manifest.json')
}

export function missionMdPath(root: string, id: string): string {
  return join(missionDir(root, id), 'mission.md')
}

function indexPath(root: string): string {
  return join(root, 'index.json')
}

// --- ids + atomic io ----------------------------------------------------------

export function newMissionId(): string {
  return `m-${randomBytes(4).toString('hex')}`
}

export function newArtifactId(): string {
  return `p-${randomBytes(4).toString('hex')}`
}

function assertSafeId(id: string, kind: string): void {
  const ok = kind === 'mission' ? /^m-[0-9a-f]{8}$/ : /^p-[0-9a-f]{8}$/
  if (!ok.test(id)) throw new StoreError('bad_id', `${kind} id must match ${kind === 'mission' ? 'm-<8 hex>' : 'p-<8 hex>'}: ${id}`)
}

/** Temp-file + rename (atomic replace, same directory). */
export function atomicWriteJson(path: string, value: unknown): void {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n')
  renameSync(tmp, path)
}

export function atomicWriteText(path: string, text: string): void {
  const tmp = `${path}.tmp-${process.pid}-${randomBytes(3).toString('hex')}`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

function readJsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new StoreError('corrupt', `cannot read ${path}: ${(error as Error).message}`)
  }
}

// --- manifest + index ---------------------------------------------------------

export function readManifest(root: string, id: string): Manifest | null {
  assertSafeId(id, 'mission')
  return readJsonFile<Manifest>(manifestPath(root, id))
}

function writeManifest(root: string, manifest: Manifest): void {
  atomicWriteJson(manifestPath(root, manifest.mission_id), manifest)
}

export function readIndex(root: string): IndexRow[] {
  const rows = readJsonFile<IndexRow[]>(indexPath(root))
  return Array.isArray(rows) ? rows : []
}

function writeIndex(root: string, rows: IndexRow[]): void {
  atomicWriteJson(indexPath(root), rows)
}

function pageCount(root: string, id: string): number {
  const pagesDir = join(missionDir(root, id), 'pages')
  try {
    return readdirSync(pagesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length
  } catch {
    return 0
  }
}

// --- mission.md ----------------------------------------------------------------

function initialMissionMd(note: string, goal: string): string {
  return (
    `# Mission: ${note}\n\n` +
    `_status: active_\n\n` +
    `## Goal\n\n${goal}\n\n` +
    `## Sources\n\n`
  )
}

/** Recursive byte size of a directory tree (files only; symlinks skipped). */
export function dirBytes(path: string): number {
  let total = 0
  let entries
  try {
    entries = readdirSync(path, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const full = join(path, entry.name)
    try {
      if (entry.isDirectory()) total += dirBytes(full)
      else if (entry.isFile()) total += statSync(full).size
    } catch {
      /* race / permission — skip */
    }
  }
  return total
}

/** Pull `## Conclusion` / `## Outcome` body from mission.md when stop omits arg. */
export function extractConclusionFromMd(md: string): string | null {
  const m = md.match(/^##\s+(?:Conclusion|Outcome)\s*\n+([\s\S]*?)(?=\n##\s|\n—\s*stopped:|$)/im)
  const body = m?.[1]?.trim()
  return body ? body : null
}

/** Pull `## Goal` body (for pivot detect / amend). */
export function extractGoalFromMd(md: string): string | null {
  const m = md.match(/^##\s+Goal\s*\n+([\s\S]*?)(?=\n##\s|\n—\s*stopped:|$)/im)
  const body = m?.[1]?.trim()
  return body ? body : null
}

/** Sync `_status: …_` italic marker in mission.md. */
export function syncMissionMdStatus(md: string, status: string): string {
  if (/_status:\s*\w+_/.test(md)) {
    return md.replace(/_status:\s*\w+_/, `_status: ${status}_`)
  }
  // Insert after the first heading line when the marker is missing.
  const lines = md.split('\n')
  if (lines.length > 0 && lines[0].startsWith('#')) {
    lines.splice(1, 0, '', `_status: ${status}_`)
    return lines.join('\n')
  }
  return `_status: ${status}_\n\n${md}`
}

/** Replace or insert `## Goal` section. */
function upsertGoalSection(md: string, goal: string): string {
  if (/^##\s+Goal\s*$/im.test(md)) {
    return md.replace(
      /^##\s+Goal\s*\n+([\s\S]*?)(?=\n##\s|\n—\s*stopped:|$)/im,
      `## Goal\n\n${goal}\n\n`,
    )
  }
  // After status / title block
  if (/_status:\s*\w+_/.test(md)) {
    return md.replace(/(_status:\s*\w+_)\s*\n/, `$1\n\n## Goal\n\n${goal}\n\n`)
  }
  return `${md.trimEnd()}\n\n## Goal\n\n${goal}\n`
}

/** Replace or insert `## Conclusion` section. */
function upsertConclusionSection(md: string, conclusion: string): string {
  if (/^##\s+(?:Conclusion|Outcome)\s*$/im.test(md)) {
    return md.replace(
      /^##\s+(?:Conclusion|Outcome)\s*\n+([\s\S]*?)(?=\n##\s|\n—\s*stopped:|$)/im,
      `## Conclusion\n\n${conclusion}\n\n`,
    )
  }
  // Before stop footer if present; else append.
  if (/\n—\s*stopped:/.test(md)) {
    return md.replace(/\n—\s*stopped:/, `\n## Conclusion\n\n${conclusion}\n\n— stopped:`)
  }
  return `${md.trimEnd()}\n\n## Conclusion\n\n${conclusion}\n`
}

function finalizeMissionMd(
  root: string,
  id: string,
  opts: { status: string; reason?: string; conclusion: string; goal?: string },
): void {
  const path = missionMdPath(root, id)
  let md = readFileSync(path, 'utf8')
  md = syncMissionMdStatus(md, opts.status)
  if (opts.goal?.trim()) md = upsertGoalSection(md, opts.goal.trim())
  md = upsertConclusionSection(md, opts.conclusion)
  const footer = `— stopped: ${opts.reason?.trim() || 'no reason given'} —`
  if (!md.includes(footer) && !/\n—\s*stopped:/.test(md)) {
    md = (md.endsWith('\n') ? md : `${md}\n`) + footer + '\n'
  } else if (!md.includes(footer)) {
    md = md.replace(/\n—\s*stopped:[^\n]*—?/, `\n${footer}`)
  }
  atomicWriteText(path, md)
}

export interface StopOptions {
  reason?: string
  /** Required unless already present in mission.md or allowStub. */
  conclusion?: string
  /** Optional goal amend / pivot at stop (R4.6). */
  goal?: string
  /**
   * Pane mark-done may pass a stub conclusion. Tools must supply a real one
   * (or ## Conclusion in mission.md).
   */
  allowStubConclusion?: boolean
}

/** Default stub when the operator marks done from the pane (R4.3). */
export const PANE_CONCLUSION_STUB =
  '(marked done from pane — no model conclusion)'

/**
 * Human-pane conclusion shape (R5). This string is ONLY the Missions pane
 * card — not the chat reply. Short punchy answers may be one/two sentences;
 * denser text needs ##/### or `-` bullets so ConclusionMarkdown can render.
 * Pane stubs skip this gate. Tool face fails loud with `conclusion_format`.
 */
export const CONCLUSION_SHORT_MAX = 240

export const CONCLUSION_FORMAT_HINT =
  'Rewrite mission_stop.conclusion for the Missions pane (chat stays natural prose). Example:\n' +
  '### Answer\n' +
  '- **Point:** … [p-…](url)\n' +
  '- **Point:** …\n' +
  '### Notes\n' +
  '- …\n' +
  'Allowed: ## / ### headings, - bullets, **bold**, `code`, [p-…](url). No wall-of-text paragraph.'

/** True when the pane can render this as a scannable answer. */
export function conclusionLooksStructured(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t === PANE_CONCLUSION_STUB) return true
  if (/^#{2,3}\s+\S/m.test(t)) return true
  if (/^[-*]\s+\S/m.test(t)) return true
  // Punchy one-/two-sentence answers OK without markdown.
  if (t.length <= CONCLUSION_SHORT_MAX) {
    const sentences = t.split(/[.!?]+\s+/).filter((s) => s.trim().length > 0)
    return sentences.length <= 2
  }
  return false
}

// --- operations -----------------------------------------------------------------

export function startMission(root: string, opts: StartOptions): Manifest {
  const note = opts.note?.trim()
  if (!note) throw new StoreError('note_required', 'mission note is required')
  // C6 (M5): default budget comes from the config knob `defaultFetchBudget`
  // (config.json under the mission root); the explicit `budget` arg wins.
  const defaultBudget = readConfig(root).defaultFetchBudget
  if (defaultBudget <= 0 || !Number.isFinite(defaultBudget)) {
    throw new StoreError('bad_config', `defaultFetchBudget must be a positive number: ${String(defaultBudget)}`)
  }
  const budget = opts.budget ?? defaultBudget
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new StoreError('bad_budget', `budget must be a positive number: ${String(opts.budget)}`)
  }

  // M5 5.3 (depth fence): seed roots — normalized (ledger-key form) + deduped.
  // Unparsable seeds throw normalize_failed (fail loud, same as fetch urls).
  const seeds = [...new Set((opts.seeds ?? []).map((s) => normalizeUrl(s)))]

  // Fence: inherit config, allow per-mission overrides (Refactoring 2).
  const cfg = readConfig(root)
  const maxDepth = opts.maxDepth ?? cfg.maxDepth
  const maxDiscoveredHosts = opts.maxDiscoveredHosts ?? cfg.maxDiscoveredHosts
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {
    throw new StoreError('bad_config', `maxDepth must be a non-negative integer: ${String(opts.maxDepth)}`)
  }
  if (!Number.isInteger(maxDiscoveredHosts) || maxDiscoveredHosts < 0) {
    throw new StoreError('bad_config', `maxDiscoveredHosts must be a non-negative integer: ${String(opts.maxDiscoveredHosts)}`)
  }

  const goal = (opts.goal?.trim() || note)
  const id = newMissionId()
  const now = new Date().toISOString()
  const manifest: Manifest = {
    mission_id: id,
    note,
    goal,
    ...(opts.template_id ? { template_id: opts.template_id } : {}),
    budget: { max: Math.floor(budget) },
    status: 'active',
    created_at: now,
    updated_at: now,
    fetched: [],
    ...(seeds.length > 0 ? { seeds } : {}),
    fence: { maxDepth, maxDiscoveredHosts },
  }

  const dir = missionDir(root, id)
  mkdirSync(join(dir, 'pages'), { recursive: true })
  writeManifest(root, manifest)
  atomicWriteText(missionMdPath(root, id), initialMissionMd(note, goal))

  const row: IndexRow = {
    mission_id: id,
    note,
    ...(opts.template_id ? { template_id: opts.template_id } : {}),
    status: 'active',
    started_at: now,
    updated_at: now,
  }
  const rows = readIndex(root)
  rows.unshift(row)
  writeIndex(root, rows.slice(0, RECENTS_CAP))
  return manifest
}

export function stopMission(root: string, id: string, reasonOrOpts?: string | StopOptions): StopResult {
  const opts: StopOptions =
    typeof reasonOrOpts === 'string' || reasonOrOpts === undefined
      ? { reason: reasonOrOpts }
      : reasonOrOpts

  const manifest = readManifest(root, id)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${id}`)
  if (manifest.status !== 'active') {
    return { manifest, already_stopped: true }
  }

  const mdPath = missionMdPath(root, id)
  let md = ''
  try {
    md = readFileSync(mdPath, 'utf8')
  } catch {
    md = ''
  }

  // Goal amend (R4.6): explicit arg wins; else adopt ## Goal if it diverged.
  const mdGoal = extractGoalFromMd(md)
  const goalAmend = opts.goal?.trim() || (mdGoal && mdGoal !== (manifest.goal ?? manifest.note) ? mdGoal : undefined)
  if (goalAmend) manifest.goal = goalAmend

  let conclusion = opts.conclusion?.trim() || extractConclusionFromMd(md) || ''
  if (!conclusion) {
    if (opts.allowStubConclusion) {
      conclusion = PANE_CONCLUSION_STUB
    } else {
      throw new StoreError(
        'conclusion_required',
        'mission_stop needs a conclusion (pass conclusion, or write ## Conclusion / ## Outcome in mission.md). Mark-done from the pane may supply a stub.',
      )
    }
  }
  // Tool face only — pane stubs skip. Forces readable markdown for the human pane.
  if (!opts.allowStubConclusion && !conclusionLooksStructured(conclusion)) {
    throw new StoreError(
      'conclusion_format',
      `conclusion is a wall of text (${conclusion.length} chars) — the Missions pane needs structure.\n${CONCLUSION_FORMAT_HINT}`,
    )
  }
  manifest.conclusion = conclusion

  const now = new Date().toISOString()
  const reason = opts.reason?.trim() || 'no reason given'
  // Budget-exhausted stop_reason when the caller asks for it via reason token.
  manifest.status = 'stopped'
  manifest.stop_reason = reason
  manifest.updated_at = now
  manifest.host_cooldowns = clearAllHostCooldowns()
  writeManifest(root, manifest)
  finalizeMissionMd(root, id, {
    status: 'stopped',
    reason,
    conclusion,
    goal: goalAmend,
  })

  const rows = readIndex(root)
  const row = rows.find((r) => r.mission_id === id)
  if (row) {
    row.status = 'stopped'
    row.updated_at = now
    writeIndex(root, rows)
  }
  return { manifest, already_stopped: false }
}

/**
 * Mid-mission goal amend (R4.6). Updates manifest + ## Goal in mission.md.
 */
export function amendMissionGoal(root: string, id: string, goal: string): Manifest {
  const trimmed = goal?.trim()
  if (!trimmed) throw new StoreError('bad_args', 'goal is required')
  const manifest = readManifest(root, id)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${id}`)
  if (manifest.status !== 'active') {
    throw new StoreError('not_active', `mission ${id} is ${manifest.status} — cannot amend goal`)
  }
  manifest.goal = trimmed
  manifest.updated_at = new Date().toISOString()
  writeManifest(root, manifest)
  const path = missionMdPath(root, id)
  let md = readFileSync(path, 'utf8')
  md = upsertGoalSection(md, trimmed)
  atomicWriteText(path, md)
  return manifest
}

/**
 * Default-mission rule (D-M1.4): explicit id wins (must exist); otherwise the
 * most recently started **active** mission; otherwise `no_mission`.
 */
export function resolveMissionId(root: string, id?: string): string {
  if (id) {
    if (!readManifest(root, id)) throw new StoreError('unknown_mission', `no such mission: ${id}`)
    return id
  }
  const rows = readIndex(root)
  const active = rows.find((r) => r.status === 'active')
  if (!active) throw new StoreError('no_mission', 'no active mission (pass mission_id or start one)')
  return active.mission_id
}

/**
 * Append a visited-ledger row (D11) to the manifest. `normalized_url` is the
 * ledger key (D-M2.2: normalized FINAL url); `url` is the final url as
 * fetched. Updates manifest `updated_at`. The index row is untouched (lifecycle
 * rows change only on start/stop).
 */
export function appendFetchedRow(root: string, missionId: string, row: FetchedRow): Manifest {
  const manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)
  manifest.fetched.push(row)
  manifest.updated_at = new Date().toISOString()
  writeManifest(root, manifest)
  return manifest
}

/**
 * Update a visited-ledger row IN PLACE (M3, D-M3.2): `force: true` overwrites
 * the artifact and refreshes the row for the same ledger key, so the ledger
 * stays one row per normalized URL per mission. Matches on the row's
 * `normalized_url` (the caller's key), replacing all fields except identity.
 */
export function updateFetchedRow(root: string, missionId: string, key: string, row: FetchedRow): Manifest {
  const manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)
  const i = manifest.fetched.findIndex((r) => r.normalized_url === key)
  if (i === -1) throw new StoreError('corrupt', `no ledger row for key ${key}`)
  manifest.fetched[i] = row
  manifest.updated_at = new Date().toISOString()
  writeManifest(root, manifest)
  return manifest
}

export function listMissions(root: string): ListResult {
  const rows = readIndex(root)
  const sum = (r: IndexRow): MissionSummary => {
    const manifest = readManifest(root, r.mission_id)
    return {
      ...r,
      pages: pageCount(root, r.mission_id),
      visited: manifest?.fetched.length ?? 0,
      // M6 6.2: the board shows budget remaining/max per active row — read
      // from the manifest the summary already loads (no new storage).
      budget: manifest ? budgetView(manifest.budget) : null,
      fence: manifest?.fence ?? null,
      bytes: dirBytes(missionDir(root, r.mission_id)),
      goal: manifest?.goal ?? null,
      conclusion: manifest?.conclusion ?? null,
    }
  }
  const active = rows.filter((r) => r.status === 'active').map(sum)
  // R4.1: recent = non-active only (active XOR recent).
  const recents = rows.filter((r) => r.status !== 'active').map(sum)
  return {
    active,
    recents,
    store_bytes: dirBytes(root),
  }
}

export function missionStatus(root: string, id?: string): StatusResult {
  const resolved = resolveMissionId(root, id)
  const manifest = readManifest(root, resolved)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${resolved}`)
  const discovery = readDiscoverySurface(root, resolved)
  const mdPath = missionMdPath(root, resolved)
  let briefing = ''
  try {
    briefing = readFileSync(mdPath, 'utf8')
  } catch {
    /* missing mission.md — still return status; pane shows empty brief */
  }
  const budget = budgetView(manifest.budget)
  const exhausted = budgetExhausted(manifest.budget)
  return {
    ...manifest,
    budget,
    visited: manifest.fetched,
    mission_md_path: mdPath,
    briefing,
    budget_exhausted: exhausted,
    ...(exhausted
      ? {
          wrap_up_hint:
            'budget exhausted — write ## Conclusion (or pass conclusion to mission_stop) and stop; do not invent more fetches',
        }
      : {}),
    // M7: surfaced only when present (field omitted = nothing discovered).
    ...(discovery ? { discovery } : {}),
  }
}

/** Persist host_cooldowns map after a fetch outcome (R4.4). */
export function writeHostCooldowns(root: string, missionId: string, map: HostCooldownMap): Manifest {
  const manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)
  manifest.host_cooldowns = map
  manifest.updated_at = new Date().toISOString()
  writeManifest(root, manifest)
  return manifest
}

// --- M6 6.1 — pane hygiene ops (D7; D-M6.2) ------------------------------------

/** Mission ids present on disk (dirs matching the id pattern; sorted). */
export function listMissionIds(root: string): string[] {
  let entries
  try {
    entries = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && /^m-[0-9a-f]{8}$/.test(e.name))
    .map((e) => e.name)
    .sort()
}

export interface RecentsClearedResult {
  cleared: number
}

/**
 * "Clear recents" (D7): empty the index (forget the list) — mission dirs and
 * their data are kept. Returns how many index rows were dropped.
 */
export function clearRecents(root: string): RecentsClearedResult {
  const rows = readIndex(root)
  writeIndex(root, [])
  return { cleared: rows.length }
}

export interface ClearAllResult {
  missions: number
  index_rows: number
  session_hosts: number
}

/**
 * "Clear all" (D-M6.2): delete every mission dir + the index + every host
 * session dir (C7 — `BROWSER39_SESSIONS_DIR` / `~/.dsh/browser39/sessions/`).
 * Returns counts for the receipt. Root dirs themselves are kept.
 */
export function clearAll(root: string): ClearAllResult {
  const indexRows = readIndex(root).length
  const ids = listMissionIds(root)
  for (const id of ids) rmSync(missionDir(root, id), { recursive: true, force: true })
  rmSync(indexPath(root), { force: true })
  const sessionHosts = clearSessionHosts(sessionsRoot())
  return { missions: ids.length, index_rows: indexRows, session_hosts: sessionHosts }
}
