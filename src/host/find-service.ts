/**
 * mission_find service (M4) — C5 tool result built on the C8 retrieval seam
 * (DESIGN.md §C8, plan/M_4_find.md).
 *
 * Pipeline: resolve mission (D-M1.4 default rule) → C8 engine
 * (v0: `LexicalEngine`, tf × IDF-lite, D-M4.1) → C5 result shape.
 *
 * find never fetches (scope guard): it only queries what is already stored
 * on disk. Errors propagate as FindError / StoreError; the tool layer renders
 * `{ ok: false, error: '<code>: <msg>' }` (never throws into the tool layer).
 *
 * Result shape (stable across engine swaps — DESIGN C8):
 *   full:     { mission_id, query, matches, best_match_url, link_matches,
 *               hint } — hint present ONLY when matches is empty.
 *   url_only: { best_match_url, link_matches } (nothing else, V4).
 */
import type { LinkMatch, RetrievalEngine, RetrievalMatch } from './retrieval.ts'
import { resolveMissionId } from './store.ts'

/** No-match hint (M_4_find.md result shape, verbatim). */
export const NO_MATCH_HINT = 'no matches: stored pages may not cover this — consider mission_fetch'

export interface RunFindArgs {
  query: string
  mission_id?: string
  /** Max matches (engine clamps: default 5, max 20 — D-M4.4). */
  limit?: number
  /** Cheap "which page talks about X" mode → url_only result shape (V4). */
  urlOnly?: boolean
}

export interface FindResult {
  mission_id: string
  query: string
  matches: RetrievalMatch[]
  best_match_url: string | null
  link_matches: LinkMatch[]
  /** Present ONLY when matches is empty. */
  hint?: string
}

export interface FindUrlOnlyResult {
  best_match_url: string | null
  link_matches: LinkMatch[]
}

export function runFind(
  root: string,
  engine: RetrievalEngine,
  args: RunFindArgs,
): FindResult | FindUrlOnlyResult {
  const missionId = resolveMissionId(root, args.mission_id)
  const query = String(args.query ?? '')
  const result = engine.search(
    { root, missionId },
    query,
    { limit: args.limit, urlOnly: args.urlOnly },
  )

  if (args.urlOnly === true) {
    // V4: only best_match_url + link_matches — nothing else.
    return {
      best_match_url: result.best_match_url,
      link_matches: result.link_matches,
    }
  }

  return {
    mission_id: missionId,
    query,
    matches: result.matches,
    best_match_url: result.best_match_url,
    link_matches: result.link_matches,
    ...(result.matches.length === 0 ? { hint: NO_MATCH_HINT } : {}),
  }
}
