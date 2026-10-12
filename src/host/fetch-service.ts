/**
 * mission_fetch service (M2 slice 2.5, C4 base receipt).
 *
 * Pipeline: resolve mission → normalize requested URL (pre-spawn guard) →
 * ledger lookup (M2: code path exists, always misses — M3 flips cache-hit) →
 * fetcher.fetch → storeArtifact → appendFetchedRow → C4 receipt.
 *
 * Scope guard: no cache-hit receipt (M3), no budget decrement (M5), no consent
 * retry (M5). `depth: 0` / `parent_artifact_id: null` (schema stable, filled
 * in M5). Errors propagate as StoreError / FetchError; the tool layer renders
 * `{ ok: false, error: '<code>: <msg>' }`.
 */
import type { FetchedPage, PageFetcher } from '../shared/types.ts'
import { storeArtifact, type StoredArtifact } from './artifacts.ts'
import { normalizeUrl } from './normalize.ts'
import { FetchError } from './fetcher.ts'
import {
  StoreError,
  appendFetchedRow,
  readManifest,
  resolveMissionId,
  type FetchedRow,
  type Manifest,
} from './store.ts'

/** C4 receipt (M2 base). Additive only — M3 adds nothing here, M5 adds budget. */
export interface FetchReceipt {
  mission_id: string
  artifact_id: string
  url: string
  final_url: string
  cached: false
  fetched_at: string
  age_days: 0
  page_quality: FetchedPage['quality']
  quality_signals: string[]
  consent_attempted: boolean
  consent_improved: boolean
  chunk_count: number
  preview_head: string
  depth: 0
  parent_artifact_id: null
  visited_count: number
  next_step_hint: string
  sample_links: string[]
}

/** v0 session key (C3): lowercased hostname, no port. */
export function hostSessionKey(url: string): string {
  return new URL(url).hostname.toLowerCase()
}

/**
 * Cache lookup by ledger key. M2: correct and present, but the fetch proceeds
 * unconditionally (V4: two fetches → two rows / two artifacts). M3 turns a
 * hit into a `cached: true` receipt with zero browser spawn.
 */
export function findLedgerRow(manifest: Manifest, key: string): FetchedRow | undefined {
  return manifest.fetched.find((r) => r.normalized_url === key)
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

export interface RunFetchArgs {
  url: string
  mission_id?: string
  /** Accepted now (schema stability); has no effect until M3. */
  force?: boolean
  /** Hand config (ENV.md); default 2000. */
  chunkChars?: number
}

export async function runFetch(root: string, fetcher: PageFetcher, args: RunFetchArgs): Promise<FetchReceipt> {
  const url = args.url?.trim()
  if (!url) throw new StoreError('bad_args', 'url is required')

  // 1. resolve mission (D-M1.4 default rule; explicit id wins)
  const missionId = resolveMissionId(root, args.mission_id)

  // 2. normalize BEFORE any spawn (V3: unparsable → normalize_failed, zero batch)
  const requestedKey = normalizeUrl(url)
  const manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)

  // 3. ledger lookup (M2: no-op behaviorally; M3 flips to cache-hit)
  void findLedgerRow(manifest, requestedKey)
  void args.force

  // 4. fetch (timeout / spawn failures surface as FetchError fetch_failed / spawn_failed)
  const page = await fetcher.fetch(url, { sessionKey: hostSessionKey(url) })

  // 5. store artifact (page.json + links + chunks, or page.json only when blocked)
  const stored: StoredArtifact = storeArtifact(root, missionId, page, { chunkChars: args.chunkChars })

  // 6. ledger row — key = normalized FINAL url (D-M2.2)
  const row: FetchedRow = {
    normalized_url: normalizeUrl(page.finalUrl),
    url: page.finalUrl,
    artifact_id: stored.artifactId,
    quality: page.quality,
    fetched_at: page.fetchedAt,
    consent_improved: page.consentImproved,
  }
  const updated = appendFetchedRow(root, missionId, row)

  // 7. C4 base receipt
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
    visited_count: updated.fetched.length,
    next_step_hint: nextStepHint(page.quality),
    sample_links: stored.links.slice(0, 5).map((l) => l.url),
  }
}

export { FetchError }
