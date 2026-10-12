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
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'

export const DEFAULT_FETCH_BUDGET = 10
export const RECENTS_CAP = 50

export type MissionStatus = 'active' | 'stopped' | 'done'

export interface MissionBudget {
  max: number
}

/** Visited ledger row (D11) — written by M2+; shape frozen now. */
export interface FetchedRow {
  normalized_url: string
  url: string
  artifact_id: string
  quality: string
  fetched_at: string
  consent_improved?: boolean
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
}

export interface StartOptions {
  note: string
  template_id?: string
  /** Omitted → DEFAULT_FETCH_BUDGET (D-M1.1). Unit: fetch calls (live in M5). */
  budget?: number
}

export interface ListResult {
  active: MissionSummary[]
  recents: MissionSummary[]
}

export interface StatusResult extends Manifest {
  visited: FetchedRow[]
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

function missionMdPath(root: string, id: string): string {
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

function initialMissionMd(note: string): string {
  return `# Mission: ${note}\n\n_status: active_\n\n## Sources\n\n`
}

function appendStopFooter(root: string, id: string, reason: string | undefined): void {
  const path = missionMdPath(root, id)
  const existing = readFileSync(path, 'utf8')
  const footer = `— stopped: ${reason?.trim() || 'no reason given'} —`
  const withFooter = (existing.endsWith('\n') ? existing : `${existing}\n`) + footer + '\n'
  atomicWriteText(path, withFooter)
}

// --- operations -----------------------------------------------------------------

export function startMission(root: string, opts: StartOptions): Manifest {
  const note = opts.note?.trim()
  if (!note) throw new StoreError('note_required', 'mission note is required')
  const budget = opts.budget ?? DEFAULT_FETCH_BUDGET
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new StoreError('bad_budget', `budget must be a positive number: ${String(opts.budget)}`)
  }

  const id = newMissionId()
  const now = new Date().toISOString()
  const manifest: Manifest = {
    mission_id: id,
    note,
    ...(opts.template_id ? { template_id: opts.template_id } : {}),
    budget: { max: Math.floor(budget) },
    status: 'active',
    created_at: now,
    updated_at: now,
    fetched: [],
  }

  const dir = missionDir(root, id)
  mkdirSync(join(dir, 'pages'), { recursive: true })
  writeManifest(root, manifest)
  atomicWriteText(missionMdPath(root, id), initialMissionMd(note))

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

export function stopMission(root: string, id: string, reason?: string): StopResult {
  const manifest = readManifest(root, id)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${id}`)
  if (manifest.status !== 'active') {
    return { manifest, already_stopped: true }
  }
  const now = new Date().toISOString()
  manifest.status = 'stopped'
  manifest.stop_reason = reason?.trim() || 'no reason given'
  manifest.updated_at = now
  writeManifest(root, manifest)
  appendStopFooter(root, id, reason)

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

export function listMissions(root: string): ListResult {
  const rows = readIndex(root)
  const sum = (r: IndexRow): MissionSummary => {
    const manifest = readManifest(root, r.mission_id)
    return {
      ...r,
      pages: pageCount(root, r.mission_id),
      visited: manifest?.fetched.length ?? 0,
    }
  }
  return {
    active: rows.filter((r) => r.status === 'active').map(sum),
    recents: rows.map(sum),
  }
}

export function missionStatus(root: string, id?: string): StatusResult {
  const resolved = resolveMissionId(root, id)
  const manifest = readManifest(root, resolved)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${resolved}`)
  return { ...manifest, visited: manifest.fetched }
}
