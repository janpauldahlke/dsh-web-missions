/**
 * mission_fetch service (M2 base + M3 cache).
 *
 * Pipeline: resolve mission → normalize requested URL (pre-spawn guard) →
 * ledger lookup (M3: a hit returns an immediate cache receipt, ZERO spawn) →
 * fetcher.fetch → storeArtifact (new id, or in-place overwrite on force /
 * redirect-collapse) → ledger row (append, or update in place — one row per
 * normalized URL per mission) → C4 receipt.
 *
 * M3 (D11 rules live):
 * - hit (no force)  → cached:true, same artifact_id, age_days (S4), zero spawn
 * - force on a hit  → re-fetch, SAME artifact_id, row updated in place,
 *                     cached:false, age_days:0 (D-M3.2)
 * - fresh receipt   → age_days:0; same-host misses carry `hint_find_first`
 *                     (soft gate, D-M3.3: ≥1 stored page on the host)
 * - age is information, not a gate (D-M3.1): no expiry in v0
 *
 * M5 (C6 budget, S5):
 * - unit = fetch calls: a NON-CACHED attempt costs 1 (success, failure, or
 *   timeout — it was a browser spawn). The charge is persisted BEFORE the
 *   spawn, so a failed attempt still costs its call.
 * - cache hits are free (`cacheHitCountsAsBudget: false`, default; the knob
 *   comes from config.json and can be overridden per call).
 * - `budget.spent >= budget.max` → `budget_exhausted` (hard stop, D-M5.2: no
 *   override — a new `mission_start` continues; `force` does not bypass).
 * - every receipt carries `budget: { max, spent, remaining, unit }`.
 * - ledger rows written by a charged attempt carry `budget_charged: true`.
 *
 * M5 (5.2 egress allowlist, pre-spawn gate):
 * - `<cwd>/.dsh/allowlist.txt` (project-level) gates egress; empty/missing
 *   file = deny all (locked-down dogfood default).
 * - gate order = allowlist → budget, both BEFORE the spawn, both zero-cost
 *   when they fire (no spawn, no budget charge).
 * - only the spawn path is gated (D-M5.4: cache hits are not re-gated — the
 *   page was already admitted); the escape is config `allowlist: 'off'`.
 *
 * Errors propagate as StoreError / FetchError; the tool layer renders
 * `{ ok: false, error: '<code>: <msg>' }`.
 */
import type { FetchedPage, PageFetcher } from '../shared/types.ts'
import { PREVIEW_HEAD_CHARS, readArtifact, storeArtifact, type StoredArtifact } from './artifacts.ts'
import { checkAllowlist, loadAllowlist } from './allowlist.ts'
import { readConfig } from './config.ts'
import { normalizeUrl } from './normalize.ts'
import { FetchError } from './fetcher.ts'
import {
  StoreError,
  appendFetchedRow,
  budgetExhausted,
  budgetView,
  chargeBudget,
  readManifest,
  resolveMissionId,
  updateFetchedRow,
  type BudgetView,
  type FetchedRow,
  type Manifest,
} from './store.ts'

/** C4 receipt (M2 base; M3: `cached`/`age_days` become live values). */
export interface FetchReceipt {
  mission_id: string
  artifact_id: string
  url: string
  final_url: string
  /** M3: true when served from the ledger with zero browser spawn. */
  cached: boolean
  /** ISO 8601 UTC of the stored fetch (hit: the original; fresh: now). */
  fetched_at: string
  /** (now - fetched_at) / 86400000, 2 decimals, floored at 0 (S4). Fresh = 0. */
  age_days: number
  page_quality: FetchedPage['quality']
  quality_signals: string[]
  consent_attempted: boolean
  consent_improved: boolean
  chunk_count: number
  preview_head: string
  depth: 0
  parent_artifact_id: null
  /**
   * C6 (M5, S5): the mission budget after this attempt — every receipt
   * carries it (unit = fetch calls).
   */
  budget: BudgetView
  visited_count: number
  next_step_hint: string
  sample_links: string[]
  /**
   * M3 soft gate (D-M3.3): present on fresh receipts when the mission already
   * has ≥1 stored page on the requested host. Text-only until mission_find
   * (M4); the fetch itself always proceeds.
   */
  hint_find_first?: string
}

/** v0 session key (C3): lowercased hostname, no port. */
export function hostSessionKey(url: string): string {
  return new URL(url).hostname.toLowerCase()
}

/**
 * Cache lookup by ledger key (M3): a row hits when the requested key matches
 * its `normalized_url` (the normalized FINAL url, D-M2.2) OR any of its
 * `requested_keys` (normalized URLs that previously redirected/stored onto
 * this row — makes a redirecting URL a zero-spawn hit on re-fetch, M3 V6).
 */
export function findLedgerRow(manifest: Manifest, key: string): FetchedRow | undefined {
  return manifest.fetched.find(
    (r) => r.normalized_url === key || (r.requested_keys?.includes(key) ?? false),
  )
}

/** (now - fetched_at) / 86400000, 2 decimals, floored at 0 (S4). */
export function ageDays(fetchedAt: string, nowMs: number): number {
  const t = Date.parse(fetchedAt)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.round(((nowMs - t) / 86400000) * 100) / 100)
}

function nextStepHint(quality: FetchedPage['quality']): string {
  switch (quality) {
    case 'full':
      return 'page stored — search it with mission_find or fetch one of the sample links'
    case 'thin':
      return 'page is thin (short or likely a consent wall) — try a sample link or re-fetch with force'
    case 'blocked':
      return 'fetch blocked (see quality_signals) — do not re-fetch this URL; pick another'
  }
}

/** M3 cached wording (M_3_cache.md hit path, verbatim intent). */
function cachedNextStepHint(quality: FetchedPage['quality'], age: number): string {
  if (quality === 'full') {
    return `cached: already stored (age ${age}d). Use mission_find, or pass force: true to re-fetch.`
  }
  return `cached: stored as ${quality} (age ${age}d). Re-fetch with force: true if you expect new content.`
}

export interface RunFetchArgs {
  url: string
  mission_id?: string
  /** M3: re-fetch even when stored — overwrite in place, same artifact_id. */
  force?: boolean
  /** Hand config (ENV.md); default 2000. */
  chunkChars?: number
}

export interface RunFetchOptions {
  /** Injectable clock (M3 V4: age_days arithmetic); default Date.now. */
  now?: () => number
  /**
   * C6: charge cache hits against the budget. Unset → config.json
   * `cacheHitCountsAsBudget` (default false = hits free).
   */
  cacheHitCountsAsBudget?: boolean
}

export async function runFetch(
  root: string,
  fetcher: PageFetcher,
  args: RunFetchArgs,
  opts: RunFetchOptions = {},
): Promise<FetchReceipt> {
  const now = opts.now ?? Date.now
  const config = readConfig(root)
  const hitsCost = opts.cacheHitCountsAsBudget ?? config.cacheHitCountsAsBudget

  // 1. resolve mission (D-M1.4 default rule; explicit id wins)
  const url = args.url?.trim()
  if (!url) throw new StoreError('bad_args', 'url is required')
  const missionId = resolveMissionId(root, args.mission_id)

  // 2. normalize BEFORE any spawn (V3: unparsable → normalize_failed, zero batch)
  const requestedKey = normalizeUrl(url)
  let manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)

  // 3. M3 hit path — no spawn (V1/V2/V5/V6)
  const hit = findLedgerRow(manifest, requestedKey)
  const force = args.force === true
  const hitFree = hit && !force

  // 4. M5 pre-spawn gates — both fire BEFORE the spawn and are zero-cost
  //    (no spawn, no budget charge). Order: allowlist, then budget.
  //
  // 4a. Allowlist (M5 5.2, egress control): gates only when a spawn is about
  //     to happen (D-M5.4: cache hits are NOT re-gated — the page was already
  //     admitted). Deny-all default: an empty/missing .dsh/allowlist.txt
  //     admits nothing (the documented escape is config `allowlist: 'off'`).
  if (!hitFree && config.allowlist === 'on') {
    checkAllowlist(url, loadAllowlist(root))
  }
  //
  // 4b. C6 budget gate: this attempt is CHARGED when it spawns (always) or
  //     when hits cost (knob on). Exhausted → hard stop BEFORE any spawn
  //     (D-M5.2: no override; a new mission_start continues).
  const willCharge = !hitFree || hitsCost
  if (willCharge && budgetExhausted(manifest.budget)) {
    throw new StoreError(
      'budget_exhausted',
      `${manifest.budget.max} fetch calls used; budget exhausted — start a new mission to continue (no override in v0)`,
    )
  }
  if (willCharge) {
    // Persist the charge BEFORE the spawn: a failed/timeout fetch still costs
    // its call (it was a browser spawn).
    manifest = chargeBudget(root, missionId)
  }

  if (hitFree) {
    return buildHitReceipt(root, missionId, url, manifest, hit, now())
  }

  // 5. fetch (timeout / spawn failures surface as FetchError fetch_failed / spawn_failed)
  const page = await fetcher.fetch(url, { sessionKey: hostSessionKey(url) })

  // 6. ledger target (D-M3.2: one row per normalized URL per mission)
  //    - a row already exists for the FINAL key (redirect-collapse onto a
  //      stored page) → update it in place;
  //    - force on a hit whose final key moved → update the hit row in place;
  //    - otherwise a brand-new row.
  const finalKey = normalizeUrl(page.finalUrl)
  const target =
    manifest.fetched.find((r) => r.normalized_url === finalKey) ?? (force && hit ? hit : undefined)
  const stored: StoredArtifact = storeArtifact(root, missionId, page, {
    chunkChars: args.chunkChars,
    ...(target ? { artifactId: target.artifact_id, replace: true } : {}),
  })

  // Merge the requested alias into the row's alias list (ordered, deduped) so
  // every redirecting URL that stores onto this row keeps hitting.
  const requestedKeys = [...new Set([...(target?.requested_keys ?? []), requestedKey])]
  const row: FetchedRow = {
    normalized_url: finalKey,
    url: page.finalUrl,
    artifact_id: stored.artifactId,
    quality: page.quality,
    fetched_at: page.fetchedAt,
    consent_improved: page.consentImproved,
    requested_keys: requestedKeys,
    // C6 audit: a ledger row is only ever written by a charged (non-cached)
    // attempt in v0 — the field makes that explicit.
    budget_charged: true,
  }
  const updated = target
    ? updateFetchedRow(root, missionId, target.normalized_url, row)
    : appendFetchedRow(root, missionId, row)

  // 7. M3 soft gate (D-M3.3): same-host stored pages, excluding the row this
  //    fetch just wrote/updated (a first-ever page on the host gets no hint).
  const others = manifest.fetched.filter((r) => r !== target)
  const sameHost = others.filter((r) => {
    try {
      return hostSessionKey(r.url) === hostSessionKey(url)
    } catch {
      return false
    }
  }).length
  const hintFindFirst =
    sameHost >= 1
      ? `this host has ${sameHost} stored pages — consider mission_find before fetching a new path`
      : undefined

  // 8. C4 receipt (fresh: cached:false, age_days:0; C6 budget after the charge)
  return {
    mission_id: missionId,
    artifact_id: stored.artifactId,
    url,
    final_url: page.finalUrl,
    cached: false,
    fetched_at: page.fetchedAt,
    age_days: 0,
    page_quality: page.quality,
    quality_signals: page.qualitySignals,
    consent_attempted: page.consentAttempted,
    consent_improved: page.consentImproved,
    chunk_count: stored.chunkCount,
    preview_head: stored.previewHead,
    depth: 0,
    parent_artifact_id: null,
    budget: budgetView(manifest.budget),
    visited_count: updated.fetched.length,
    next_step_hint: nextStepHint(page.quality),
    sample_links: stored.links.slice(0, 5).map((l) => l.url),
    ...(hintFindFirst ? { hint_find_first: hintFindFirst } : {}),
  }
}

/** M3 cache-hit receipt: read the stored artifact, zero spawn. */
function buildHitReceipt(
  root: string,
  missionId: string,
  url: string,
  manifest: Manifest,
  hit: FetchedRow,
  nowMs: number,
): FetchReceipt {
  const stored = readArtifact(root, missionId, hit.artifact_id)
  const age = ageDays(hit.fetched_at, nowMs)
  return {
    mission_id: missionId,
    artifact_id: hit.artifact_id,
    url,
    final_url: hit.url,
    cached: true,
    fetched_at: hit.fetched_at,
    age_days: age,
    page_quality: stored.page.quality,
    quality_signals: stored.page.qualitySignals ?? [],
    consent_attempted: stored.page.consentAttempted ?? false,
    consent_improved: stored.page.consentImproved ?? false,
    chunk_count: stored.chunkCount,
    preview_head: (stored.page.content ?? '').slice(0, PREVIEW_HEAD_CHARS),
    depth: 0,
    parent_artifact_id: null,
    budget: budgetView(manifest.budget),
    visited_count: manifest.fetched.length,
    next_step_hint: cachedNextStepHint(stored.page.quality, age),
    sample_links: stored.links.slice(0, 5).map((l) => l.url),
  }
}

export { FetchError }
