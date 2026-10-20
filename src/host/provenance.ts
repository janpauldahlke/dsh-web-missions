/**
 * P_01 provenance — log-only URL origin for dogfood metrics (CRITIQUE C1).
 *
 * Each fetched URL is tagged `discovery | user | other`:
 *   - discovery: normalized URL appears in companion discovery.json
 *   - user:      normalized URL is a mission_start seed
 *   - other:     neither (recalled / pasted mid-mission / sample_links hop)
 *
 * Per-mission summary (used / exists / useful) is derived from the ledger so
 * P_06 can count instead of guess. Never blocks a fetch.
 */
import { normalizeUrl } from './normalize.ts'

export type UrlSource = 'discovery' | 'user' | 'other'

export interface ProvenanceSummary {
  /** ≥1 fetch tagged discovery (agent used discovery rows). */
  used: boolean
  /** Share of fetched rows that are not 404/dns-class failures. */
  exists_ratio: number
  exists_n: number
  exists_ok: number
  /** ≥1 discovery-sourced fetch that looks useful (full/ok-ish quality). */
  useful: boolean
  by_source: { discovery: number; user: number; other: number }
}

export interface ProvenanceFetchedRow {
  quality: string
  url_source?: UrlSource
}

const BAD_QUALITY = new Set(['not_found', 'dns_fail', 'blocked', 'error'])

export function classifyUrlSource(
  url: string,
  discoveryUrls: readonly string[],
  seeds: readonly string[] | undefined,
): UrlSource {
  let key: string
  try {
    key = normalizeUrl(url)
  } catch {
    return 'other'
  }

  for (const entry of discoveryUrls) {
    try {
      if (normalizeUrl(entry) === key) return 'discovery'
    } catch {
      /* skip bad discovery entries */
    }
  }

  for (const seed of seeds ?? []) {
    try {
      if (normalizeUrl(seed) === key) return 'user'
    } catch {
      /* skip */
    }
  }
  return 'other'
}

export function summarizeProvenance(fetched: readonly ProvenanceFetchedRow[]): ProvenanceSummary {
  const by_source = { discovery: 0, user: 0, other: 0 }
  let exists_ok = 0
  let useful = false
  for (const row of fetched) {
    const src = row.url_source ?? 'other'
    if (src === 'discovery' || src === 'user' || src === 'other') by_source[src]++
    else by_source.other++
    const bad = BAD_QUALITY.has(row.quality)
    if (!bad) exists_ok++
    if (src === 'discovery' && !bad && row.quality !== 'thin' && row.quality !== 'js_shell') {
      useful = true
    }
  }
  const exists_n = fetched.length
  return {
    used: by_source.discovery > 0,
    exists_ratio: exists_n === 0 ? 0 : exists_ok / exists_n,
    exists_n,
    exists_ok,
    useful,
    by_source,
  }
}
