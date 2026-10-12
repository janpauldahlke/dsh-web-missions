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
