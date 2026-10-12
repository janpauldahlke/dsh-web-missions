/**
 * Pane data routes (M1, D-M1.5 API-first; the M6 pane polls these).
 *
 * - GET /api/web-missions/missions        → mission_list()
 * - GET /api/web-missions/missions/:id    → mission_status({ mission_id })
 *
 * Routes have no agent session, so the mission root resolves from the server
 * process cwd (acceptance server booted in this repo — D6). That is the one
 * sanctioned `process.cwd()` use: tools resolve per call from the exec header,
 * these resolve once from the server (C1 review #4).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  MISSIONS_ID_PREFIX,
  MISSIONS_ROUTE,
  MISSION_ID_PATTERN,
} from '../shared/types.ts'
import {
  StoreError,
  listMissions,
  missionRoot,
  missionStatus,
} from './store.ts'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function sendError(res: ServerResponse, status: number, code: string, message: string): void {
  send(res, status, { ok: false, error: `${code}: ${message}` })
}

/** Map a StoreError to an HTTP status (404 for missing, 400 for malformed). */
function httpStatusFor(error: unknown): number {
  if (error instanceof StoreError) {
    if (error.code === 'unknown_mission' || error.code === 'no_mission') return 404
    if (error.code === 'bad_id' || error.code === 'note_required' || error.code === 'bad_budget') return 400
    return 500
  }
  return 500
}

export function registerMissionsRoutes(ctx: Context): void {
  const root = missionRoot(process.cwd())

  const unregisterList = ctx.webServer.register({
    kind: 'exact',
    path: MISSIONS_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        send(res, 200, listMissions(root))
      } catch (error) {
        if (error instanceof StoreError) {
          sendError(res, httpStatusFor(error), error.code, errorMessage(error))
        } else {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      }
    },
  })
  ctx.effect(() => unregisterList, 'web-missions: /api/web-missions/missions route')

  // Prefix without trailing slash: matches the bare path (exact route wins for
  // that URL) and `<prefix>/<anything>`. See MISSIONS_ID_PREFIX doc.
  const unregisterStatus = ctx.webServer.register({
    kind: 'prefix',
    path: MISSIONS_ID_PREFIX,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const host = req.headers.host ?? '127.0.0.1'
      const url = new URL(req.url ?? MISSIONS_ID_PREFIX, `http://${host}`)
      if (url.pathname === MISSIONS_ID_PREFIX) {
        // Bare prefix (no id) — the exact list route owns this URL; defensive 404.
        send(res, 404, { ok: false, error: 'not found' })
        return
      }
      // Strip the separator; the remainder must be the full id (the anchored
      // pattern rejects anything with further segments).
      const remainder = url.pathname.slice(MISSIONS_ID_PREFIX.length + 1)
      if (!MISSION_ID_PATTERN.test(remainder)) {
        sendError(res, 404, 'unknown_mission', `no such mission: ${remainder}`)
        return
      }
      try {
        send(res, 200, missionStatus(root, remainder))
      } catch (error) {
        if (error instanceof StoreError) {
          sendError(res, httpStatusFor(error), error.code, errorMessage(error))
        } else {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      }
    },
  })
  ctx.effect(() => unregisterStatus, 'web-missions: /api/web-missions/missions/:id route')
}
