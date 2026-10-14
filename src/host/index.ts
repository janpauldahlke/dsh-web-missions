/**
 * Host half of dsh-local-web-missions.
 *
 * - `inject: ['tools']` — the tools face is the core: mission_* tools must
 *   work in headless agent sessions, not only under `dsh web`.
 * - Routes nest under `ctx.inject(['webServer'], …)` so headless profiles
 *   activate the tools without waiting on webServer (proven pattern:
 *   dsh-memento / dsh-local-long-horizon).
 * - M4 (D5): registers the `web-mission-workflow` skill on `ctx.skills`
 *   (body = skills/web-mission-workflow/SKILL.md; ritual + kurzprofil
 *   template — scaffolding for the model, not host logic).
 *
 * apply must never throw: each registration degrades to a logged error.
 *
 * Routes (route base fixed in M0, D-M0.2):
 * - GET /api/web-missions/health — liveness { ok, name, version, time }
 * - GET /api/web-missions/missions, /missions/:id — pane data (slice 1.4)
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { HEALTH_ROUTE, PLUGIN, VERSION } from '../shared/types.ts'
import { DEFAULT_CONFIG, readConfig } from './config.ts'
import { discoveryFace } from './discovery-face.ts'
import { registerMissionsRoutes } from './routes.ts'
import { registerMissionSkill, SKILL_NAME } from './skill.ts'
import { registerMissionTools } from './tools.ts'
import { getRegisteredMissionTools } from './tool-registry.ts'
import { missionRoot } from './store.ts'

export const name = PLUGIN
export const inject = ['tools']

export { HEALTH_ROUTE, PLUGIN, VERSION }

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

function skillShipped(): boolean {
  try {
    const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
    return existsSync(join(packageRoot, 'skills', SKILL_NAME, 'SKILL.md'))
  } catch {
    return false
  }
}

function registerHealthRoute(ctx: Context): void {
  const unregister = ctx.webServer.register({
    kind: 'exact',
    path: HEALTH_ROUTE,
    handler: (req: IncomingMessage, res: ServerResponse) => {
      if (req.method !== 'GET') {
        send(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      try {
        // Acceptance boots with cwd = this repo (PROTOCOL); project config merges here.
        let config = DEFAULT_CONFIG
        try {
          config = readConfig(missionRoot(process.cwd()))
        } catch { /* degrade to defaults */ }
        send(res, 200, {
          ok: true,
          name: PLUGIN,
          version: VERSION,
          time: new Date().toISOString(),
          // Honest: only tools that actually registered (not the wish list).
          tools: [...getRegisteredMissionTools()],
          skill: skillShipped(),
          skill_name: SKILL_NAME,
          // R4.5 — discovery companion on|off (discovery_search registered?).
          discovery: discoveryFace(ctx),
          config,
        })
      } catch (error) {
        // Any internal error → 500 JSON (never throw out of the handler).
        try { send(res, 500, { ok: false, error: errorMessage(error) }) } catch { /* dead connection */ }
      }
    },
  })
  ctx.effect(() => unregister, 'web-missions: /api/web-missions/health route')
}

export function apply(ctx: Context): void {
  try {
    const disposeTools = registerMissionTools(ctx)
    // Cordis: effect body RETURN VALUE is the disposer. Calling disposeTools()
    // here would unregister every mission_* tool immediately on apply (R2 scar:
    // safeRegister made all 8 succeed → self-dispose; earlier find-schema throw
    // skipped this line and accidentally left 4 tools alive).
    ctx.effect(() => disposeTools, 'web-missions: tools')
  } catch (error) {
    ctx.logger?.(PLUGIN)
      .warn('tool registration failed (continuing without it): %s', errorMessage(error))
  }
  // M4 (D5): web-mission-workflow skill on the harness skill registry.
  try {
    registerMissionSkill(ctx)
  } catch (error) {
    ctx.logger?.(PLUGIN)
      .warn('skill registration failed (continuing without it): %s', errorMessage(error))
  }
  // Routes only exist where a web server is present (dsh web); headless
  // profiles simply skip them.
  ctx.inject(['webServer'], (webCtx: Context) => {
    try {
      registerHealthRoute(webCtx)
      registerMissionsRoutes(webCtx)
    } catch (error) {
      webCtx.logger?.(PLUGIN)
        .error('route registration failed: %s', errorMessage(error))
    }
  })
}
