/**
 * Shared constants between the host and client halves (M0).
 */

/** Package name — must equal `name` in package.json and the cordis.patch.yml row. */
export const PLUGIN = 'dsh-local-web-missions'

/** Plugin version. Keep in lockstep with package.json (M9 publish owns the bump). */
export const VERSION = '1.0.0'

/** M0 route base is fixed now; M1+ adds routes under it. */
export const HEALTH_ROUTE = '/api/web-missions/health'

/** Pane data routes (M1, D-M1.5 API-first; polled by the M6 pane). */
export const MISSIONS_ROUTE = '/api/web-missions/missions'
/**
 * Prefix-route registration path — NO trailing slash: the webserver's prefix
 * matcher (p matches p and p/<anything>) appends its own `/`, so a trailing
 * slash here would only ever match `…missions//…` and the route would be dead
 * (V1.5 acceptance caught this; :id requests fell through to the connection
 * plugin's /api admission → 401).
 */
export const MISSIONS_ID_PREFIX = '/api/web-missions/missions'
export const MISSION_ID_PATTERN = /^m-[0-9a-f]{8}$/

/** Rightbar tab identity (D-M0.3): id/label = web-missions / "Missions". */
export const TAB_ID = 'web-missions'
export const TAB_KIND = 'web-missions'
export const TAB_TITLE = 'Missions'

/** One-shot health payload the client pane renders (host ↔ UI loop proof). */
export interface HealthPayload {
  ok: boolean
  name?: string
  version?: string
  time?: string
  error?: string
}

/**
 * C3 — PageFetcher port + FetchedPage (frozen at M2 green; DESIGN.md §C3).
 * `selector` is NOT on this port (S2): fetch stores the canonical page;
 * selection is a query-time concern (mission_find, M4).
 */
export interface PageFetcher {
  fetch(
    url: string,
    opts?: {
      signal?: AbortSignal
      /** Host key (C7); v0 = lowercased hostname, no port. */
      sessionKey?: string
    },
  ): Promise<FetchedPage>
}

export type PageQuality = 'full' | 'thin' | 'blocked'

export interface FetchedPage {
  /** As requested. */
  url: string
  /** After redirects (browser39 reports the final URL). */
  finalUrl: string
  status: number
  contentType: string
  title: string
  /** Main text/markdown (browser39 output). */
  content: string
  /** Absolute URLs, resolved against finalUrl. */
  links: { url: string; text: string }[]
  byteLength: number
  /** ISO 8601 UTC. */
  fetchedAt: string
  /** Deterministic, set by our code (S7) — never by browser39. */
  quality: PageQuality
  /** Why (e.g. "text<300chars", "cmp-marker:cookie", "http-404"). */
  qualitySignals: string[]
  /** M2: false/false; M5 fills (schema stability). */
  consentAttempted: boolean
  consentImproved: boolean
}
