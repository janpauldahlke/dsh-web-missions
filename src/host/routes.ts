/**
 * Pane data routes (M1, D-M1.5 API-first; the M6 pane polls these).
 *
 * - GET /api/web-missions/missions        → mission_list() (+ ?cwd= R4.0)
 * - GET /api/web-missions/missions/:id    → mission_status({ mission_id })
 * - POST /api/web-missions/missions/:id/stop → mission_stop (M6 6.1, D-M6.3 / R4.3)
 * - POST /api/web-missions/recents/clear   → clear recents (M6 6.1, D7)
 * - POST /api/web-missions/clear-all       → wipe missions + sessions (M6 6.1, D-M6.2)
 * - GET /api/web-missions/sessions         → session visibility (M6 6.1, D-M6.4)
 *
 * Routes have no agent session. Mission root follows the last cwd any
 * mission_* tool used in this process (R2.3), or the active chat workspace
 * cwd the pane posts via `?cwd=` (R4.0). Before either, process.cwd() (D6).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { URL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import {
  MISSIONS_ID_PREFIX,
  MISSIONS_ROUTE,
  MISSION_ID_PATTERN,
  RECENTS_CLEAR_ROUTE,
  CLEAR_ALL_ROUTE,
  SESSIONS_ROUTE,
} from '../shared/types.ts'
import { discoveryFace } from './discovery-face.ts'
import {
  StoreError,
  PANE_CONCLUSION_STUB,
  listMissions,
  missionStatus,
  stopMission,
  clearRecents,
  clearAll,
} from './store.ts'
import { sessionViews } from './sessions-view.ts'
import { getMissionCwd, noteMissionCwd, paneMissionRoot } from './workspace.ts'

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
    if (
      error.code === 'bad_id' ||
      error.code === 'note_required' ||
      error.code === 'bad_budget' ||
      error.code === 'conclusion_required' ||
      error.code === 'bad_args' ||
      error.code === 'not_active'
    ) {
      return 400
    }
    return 500
  }
  return 500
}

/**
 * Collect + parse a small JSON request body. Empty body → `null` (stop
 * without a reason); non-JSON → throws (the handler maps it to 400).
 */
function readJsonBody(req: IncomingMessage, limit = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve(null)
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Adopt ?cwd= from the pane (active chat workspace) before resolving the root. */
function adoptCwdFromUrl(req: IncomingMessage, pathForUrl: string): void {
  try {
    const host = req.headers.host ?? '127.0.0.1'
    const url = new URL(req.url ?? pathForUrl, `http://${host}`)
    const cwd = url.searchParams.get('cwd')?.trim()
    if (cwd) noteMissionCwd(cwd)
  } catch {
    /* ignore bad URL */
  }
}

export function registerMissionsRoutes(ctx: Context): void {
  const unregisterList = ctx.webServer.register({
    kind: 'exact',
    path: MISSIONS_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        adoptCwdFromUrl(req, MISSIONS_ROUTE)
        const root = paneMissionRoot()
        send(res, 200, {
          ...listMissions(root),
          // Operator truth: which store the pane is reading (F6 / session cwd).
          cwd: getMissionCwd(),
          root,
          discovery: discoveryFace(ctx),
        })
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
  // Owns GET …/:id (status) and POST …/:id/stop (D-M6.3 — thin wrapper over
  // mission_stop; the webserver has no pattern routes, so the suffix is
  // matched here, not as a separate registration).
  const stopSuffix = new RegExp(`^(${MISSION_ID_PATTERN.source.slice(1, -1)})\\/stop$`)
  const unregisterStatus = ctx.webServer.register({
    kind: 'prefix',
    path: MISSIONS_ID_PREFIX,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        const host = req.headers.host ?? '127.0.0.1'
        const url = new URL(req.url ?? MISSIONS_ID_PREFIX, `http://${host}`)
        const cwdQ = url.searchParams.get('cwd')?.trim()
        if (cwdQ) noteMissionCwd(cwdQ)
        if (url.pathname === MISSIONS_ID_PREFIX) {
          if (req.method !== 'GET') {
            send(res, 405, { ok: false, error: 'method not allowed' })
            return
          }
          // Bare prefix (no id) — the exact list route owns this URL; defensive 404.
          send(res, 404, { ok: false, error: 'not found' })
          return
        }
        // Strip the separator; the remainder is `<id>` or `<id>/stop`.
        const remainder = url.pathname.slice(MISSIONS_ID_PREFIX.length + 1)
        if (req.method === 'POST') {
          const match = remainder.match(stopSuffix)
          if (!match) {
            sendError(res, 404, 'unknown_mission', `no such mission: ${remainder}`)
            return
          }
          const stopId = match[1]
          // Pane mark-done: { reason, conclusion? }. Missing conclusion → stub
          // (allowStubConclusion). Tool face requires a real conclusion.
          let reason: string | undefined
          let conclusion: string | undefined
          let fromPane = false
          try {
            const body = await readJsonBody(req)
            if (body !== null && typeof body === 'object') {
              const b = body as { reason?: unknown; conclusion?: unknown; from_pane?: unknown }
              if (typeof b.reason === 'string' && b.reason.trim() !== '') reason = b.reason.trim()
              if (typeof b.conclusion === 'string' && b.conclusion.trim() !== '') {
                conclusion = b.conclusion.trim()
              }
              // Pane always sends from_pane / or we treat HTTP stop as pane-capable stub.
              fromPane = b.from_pane === true || conclusion === undefined
            } else {
              fromPane = true
            }
          } catch {
            fromPane = true
          }
          try {
            const { manifest, already_stopped } = stopMission(paneMissionRoot(), stopId, {
              reason,
              conclusion: conclusion ?? (fromPane ? PANE_CONCLUSION_STUB : undefined),
              allowStubConclusion: fromPane,
            })
            send(res, 200, {
              ok: true,
              mission_id: manifest.mission_id,
              status: manifest.status,
              stop_reason: manifest.stop_reason ?? null,
              already_stopped,
              updated_at: manifest.updated_at,
              conclusion: manifest.conclusion ?? null,
            })
          } catch (error) {
            if (error instanceof StoreError) {
              sendError(res, httpStatusFor(error), error.code, errorMessage(error))
            } else {
              send(res, 500, { ok: false, error: errorMessage(error) })
            }
          }
          return
        }
        if (req.method !== 'GET') {
          send(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        if (!MISSION_ID_PATTERN.test(remainder)) {
          sendError(res, 404, 'unknown_mission', `no such mission: ${remainder}`)
          return
        }
        try {
          send(res, 200, missionStatus(paneMissionRoot(), remainder))
        } catch (error) {
          if (error instanceof StoreError) {
            sendError(res, httpStatusFor(error), error.code, errorMessage(error))
          } else {
            send(res, 500, { ok: false, error: errorMessage(error) })
          }
        }
      })()
    },
  })
  ctx.effect(() => unregisterStatus, 'web-missions: /api/web-missions/missions/:id route')

  // M6 6.1 (D7) — Clear recents: empty the index, keep the mission dirs.
  const unregisterRecentsClear = ctx.webServer.register({
    kind: 'exact',
    path: RECENTS_CLEAR_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'POST') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        send(res, 200, { ok: true, ...clearRecents(paneMissionRoot()) })
      } catch (error) {
        if (error instanceof StoreError) {
          sendError(res, httpStatusFor(error), error.code, errorMessage(error))
        } else {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      }
    },
  })
  ctx.effect(() => unregisterRecentsClear, 'web-missions: /api/web-missions/recents/clear route')

  // M6 6.1 (D-M6.2) — Clear all: missions + index + host session dirs.
  // `confirm: true` is REQUIRED (touches ~/.dsh) — anything else is a 400.
  const unregisterClearAll = ctx.webServer.register({
    kind: 'exact',
    path: CLEAR_ALL_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      void (async () => {
        if (req.method !== 'POST') {
          send(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        let body: unknown
        try {
          body = await readJsonBody(req)
        } catch {
          sendError(res, 400, 'invalid_body', 'body must be JSON')
          return
        }
        if (body === null || typeof body !== 'object' || (body as { confirm?: unknown }).confirm !== true) {
          sendError(res, 400, 'confirm_required', 'send { "confirm": true } to clear missions + sessions')
          return
        }
        try {
          send(res, 200, { ok: true, ...clearAll(paneMissionRoot()) })
        } catch (error) {
          if (error instanceof StoreError) {
            sendError(res, httpStatusFor(error), error.code, errorMessage(error))
          } else {
            send(res, 500, { ok: false, error: errorMessage(error) })
          }
        }
      })()
    },
  })
  ctx.effect(() => unregisterClearAll, 'web-missions: /api/web-missions/clear-all route')

  // M6 6.1 (D-M6.4) — session visibility, v0.1: hosts with session dirs +
  // last consent outcome (read-only; never touches the session dirs).
  const unregisterSessions = ctx.webServer.register({
    kind: 'exact',
    path: SESSIONS_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        send(res, 200, { ok: true, sessions: sessionViews(paneMissionRoot()) })
      } catch (error) {
        if (error instanceof StoreError) {
          sendError(res, httpStatusFor(error), error.code, errorMessage(error))
        } else {
          send(res, 500, { ok: false, error: errorMessage(error) })
        }
      }
    },
  })
  ctx.effect(() => unregisterSessions, 'web-missions: /api/web-missions/sessions route')
}
