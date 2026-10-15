/**
 * Shared constants between the host and client halves (M0).
 */

/** Package name — must equal `name` in package.json and the cordis.patch.yml row. */
export const PLUGIN = 'dsh-web-missions'

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

/** M6 pane routes (D-M6.2/D-M6.3/D-M6.4 — hygiene, stop, session visibility). */
export const RECENTS_CLEAR_ROUTE = '/api/web-missions/recents/clear'
export const CLEAR_ALL_ROUTE = '/api/web-missions/clear-all'
export const SESSIONS_ROUTE = '/api/web-missions/sessions'

/**
 * M6 6.2 — pane payload types (mirror the host store shapes; the pane renders
 * ONLY these — "no new storage, everything from M1–M5 data").
 */
export interface BudgetPayload {
  max: number
  spent: number
  remaining: number
  unit: string
}

export interface MissionSummaryPayload {
  mission_id: string
  note: string
  status: string
  started_at: string
  updated_at: string
  pages: number
  visited: number
  /** Live from the manifest (M6 6.2: the board shows budget per active row). */
  budget?: BudgetPayload | null
  /** Per-mission depth/host fence (R2.6). */
  fence?: { maxDepth: number; maxDiscoveredHosts: number } | null
  /** On-disk bytes for this mission (R3.1). */
  bytes?: number
  /** Goal pin when set (R3.2). */
  goal?: string | null
  /** Conclusion when stopped (R4.2). */
  conclusion?: string | null
}

export interface FetchedRowPayload {
  normalized_url: string
  url: string
  artifact_id: string
  quality: string
  fetched_at: string
  consent_attempted?: boolean
  consent_improved?: boolean
  depth?: number
  parent_artifact_id?: string | null
}

export interface ListPayload {
  active: MissionSummaryPayload[]
  /** Non-active only (R4.1 — active XOR recent). */
  recents: MissionSummaryPayload[]
  /** Store the pane is reading (R2.3 / R4.0 — session workspace or last tool cwd). */
  cwd?: string
  root?: string
  /** Total bytes under the mission root (R3.1). */
  store_bytes?: number
  /** Discovery companion registered in this process (R4.5). */
  discovery?: 'on' | 'off'
}

export interface StatusPayload {
  mission_id: string
  note: string
  status: string
  stop_reason?: string
  created_at: string
  updated_at: string
  budget: BudgetPayload
  visited: FetchedRowPayload[]
  fence?: { maxDepth: number; maxDiscoveredHosts: number }
  /** Absolute path to mission.md (operator + tools). */
  mission_md_path?: string
  /** Full mission.md body for the pane briefing (R3.0). */
  briefing?: string
  /** Selective goal pin (R3.2). */
  goal?: string
  /** Model/operator conclusion (R4.2) — lead UI field. */
  conclusion?: string
  /** True when remaining fetch budget is 0 (R4.7). */
  budget_exhausted?: boolean
  /** Wrap-up hint when budget is exhausted (R4.7). */
  wrap_up_hint?: string
  /** Hosts currently on wiedervorlage cool-down (R4.4). */
  host_cooldowns?: Record<string, { non_retriable: number; cooldown: boolean }>
}

/** Client helper: MISSIONS_ID_PREFIX has no trailing slash (webserver scar). */
export function missionApiPath(missionId: string, suffix = ''): string {
  const base = `${MISSIONS_ID_PREFIX}/${missionId}`
  return suffix ? `${base}/${suffix}` : base
}

export interface StopPayload {
  ok: boolean
  mission_id: string
  status: string
  stop_reason: string | null
  already_stopped: boolean
  updated_at: string
  conclusion?: string | null
}

/** M6 6.3 — hygiene action responses. */
export interface RecentsClearedPayload {
  ok: boolean
  cleared: number
}

export interface ClearAllPayload {
  ok: boolean
  missions: number
  index_rows: number
  session_hosts: number
}

/** One-shot health payload the client pane renders (host ↔ UI loop proof). */
export interface HealthPayload {
  ok: boolean
  name?: string
  version?: string
  time?: string
  error?: string
  /** Discovery companion tool face (R4.5). */
  discovery?: 'on' | 'off'
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
  /**
   * C10 (M5 5.5): one consent attempt in the SAME host session — one
   * browser39 invocation that restores the page, clicks the label
   * (best-effort element click + accept-link navigation), and does the
   * measuring refetch. Optional: fetchers without it never run consent
   * (receipts keep consent_attempted:false).
   */
  consentAttempt?(
    url: string,
    label: string,
    /** Matching link to navigate (real navigation → Set-Cookie), or null. */
    linkUrl: string | null,
    opts?: {
      signal?: AbortSignal
      sessionKey?: string
    },
  ): Promise<ConsentAttempt | null>
}

/** C10 (M5 5.5): one consent-attempt result (wraps the measuring refetch). */
export interface ConsentAttempt {
  /** The label matched a clickable element or a navigable link. */
  clicked: boolean
  /** The measuring refetch; null = the batch produced no usable fetch result. */
  page: FetchedPage | null
}

export type PageQuality = 'full' | 'thin' | 'blocked'

/**
 * M5 5.6 honesty gate (C4): deterministic text that EVERY thin/blocked
 * receipt's `next_step_hint` must carry — the model's honesty contract,
 * enforced by the receipt, not by hoping.
 */
export const DO_NOT_CLAIM = 'do not claim content from this page'

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
