/**
 * Host half of dsh-local-web-missions (M0: dual-face scaffold).
 *
 * - GET /api/web-missions/health — liveness probe answering
 *   { ok: true, name, version, time }. The route base /api/web-missions/ is
 *   fixed now; M1+ adds routes under it.
 *
 * apply must never throw: registration failure degrades to a logged error;
 * handler failure degrades to a 500 error JSON.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { HEALTH_ROUTE, PLUGIN, VERSION } from '../shared/types.ts'

export const name = PLUGIN
export const inject = ['webServer']

export { HEALTH_ROUTE, PLUGIN, VERSION }

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function apply(ctx: Context): void {
  let unregister: () => void
  try {
    unregister = ctx.webServer.register({
      kind: 'exact',
      path: HEALTH_ROUTE,
      handler: (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          send(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        try {
          send(res, 200, {
            ok: true,
            name: PLUGIN,
            version: VERSION,
            time: new Date().toISOString(),
          })
        } catch (error) {
          // Any internal error → 500 JSON (never throw out of the handler).
          try { send(res, 500, { ok: false, error: errorMessage(error) }) } catch { /* dead connection */ }
        }
      },
    })
  } catch (error) {
    ctx.logger?.('dsh-local-web-missions')
      .error('route registration failed: %s', errorMessage(error))
    return
  }
  ctx.effect(() => unregister, 'web-missions: /api/web-missions/health route')
}
