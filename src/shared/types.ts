/**
 * Shared constants between the host and client halves (M0).
 */

/** Package name — must equal `name` in package.json and the cordis.patch.yml row. */
export const PLUGIN = 'dsh-local-web-missions'

/** Plugin version. Keep in lockstep with package.json (M9 publish owns the bump). */
export const VERSION = '1.0.0'

/** M0 route base is fixed now; M1+ adds routes under it. */
export const HEALTH_ROUTE = '/api/web-missions/health'

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
