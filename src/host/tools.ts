/**
 * Agent tools for web missions (M1: mission_start, mission_list,
 * mission_status, mission_stop; M2: mission_fetch).
 *
 * Registers plain tool definition objects on the harness `tools` service —
 * proven exemplar: `dsh-local-long-horizon/src/host/tools.ts` (do not invent
 * seats). Contract (M1):
 * - results are JSON-serializable;
 * - errors return `{ ok: false, error: '<code>: <msg>' }` — never throw into
 *   the tool layer;
 * - JSON Schema scar (dsh ≥ 0.1.7): no `required: true` on scalar property
 *   nodes — object-level `required: ['field', …]` arrays only;
 * - cwd resolves per tool call via resolveCwd (args.cwd → agent session
 *   header cwd → error). Never process.cwd() — that pins the store to the
 *   agent's workspace (C1 review #4).
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  StoreError,
  missionRoot,
  listMissions,
  missionStatus,
  startMission,
  stopMission,
  resolveMissionId,
} from './store.ts'
import { Browser39Fetcher, FetchError } from './fetcher.ts'
import { runFetch } from './fetch-service.ts'

type ToolArgs = Record<string, any>

type ExecLike = {
  agent?: {
    session?: {
      id?: string
      header?: { cwd?: string; id?: string }
    }
  }
}

type ToolsFace = {
  register: (def: Record<string, unknown>) => () => void
}

/** Verbatim long-horizon pattern (C1 review #4). */
function resolveCwd(args: { cwd?: string }, exec: ExecLike): string {
  const fromArg = args.cwd?.trim()
  if (fromArg) return fromArg
  const fromAgent = exec.agent?.session?.header?.cwd?.trim()
  if (fromAgent) return fromAgent
  throw new Error('cwd required (pass cwd or run from an agent session with a workspace cwd)')
}

type ToolErrorResult = { ok: false; error: string }

function toolErrorResult(error: unknown): ToolErrorResult {
  if (error instanceof StoreError) {
    return { ok: false, error: `${error.code}: ${error.message}` }
  }
  if (error instanceof FetchError) {
    return { ok: false, error: `${error.code}: ${error.message}` }
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

function renderJson(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
}

const CWD_PARAM = { type: 'string', description: 'Absolute project cwd (defaults to session cwd).' }

export function registerMissionTools(ctx: Context): () => void {
  const tools = (ctx as unknown as { tools: ToolsFace }).tools
  const disposers: Array<() => void> = []

  disposers.push(tools.register({
    name: 'mission_start',
    description:
      'Start a new web research mission. Creates <cwd>/.dsh/web-missions/<id>/ ' +
      '(manifest.json + mission.md) and a recents row; the mission becomes the ' +
      'default active mission for the other mission_* tools.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: { type: 'string', description: 'Short mission note/title (required).' },
        template_id: { type: 'string', description: 'Optional research template id.' },
        budget: { type: 'integer', description: 'Max fetch calls (default 10; live enforcement from M5).' },
        cwd: CWD_PARAM,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          mission_id: { type: 'string' },
          note: { type: 'string' },
          status: { type: 'string' },
          budget: { type: 'object' },
          created_at: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        const manifest = startMission(root, {
          note: args.note,
          template_id: args.template_id,
          budget: args.budget,
        })
        return manifest
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_list',
    description:
      'List web missions for this project. Returns active missions first ' +
      '(newest first) and all recents (newest first, cap 50) with page and ' +
      'visited counts.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cwd: CWD_PARAM,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          active: { type: 'array' },
          recents: { type: 'array' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        return listMissions(root)
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_status',
    description:
      'Return the full manifest of the default (most recently started active) ' +
      'mission, or the given mission_id, including visited: the ledger of ' +
      'fetched pages. This is the canonical visited list — do not track ' +
      'visited URLs from memory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mission_id: { type: 'string', description: 'Mission id (default: most recently started active mission).' },
        cwd: CWD_PARAM,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          mission_id: { type: 'string' },
          note: { type: 'string' },
          status: { type: 'string' },
          stop_reason: { type: 'string' },
          budget: { type: 'object' },
          created_at: { type: 'string' },
          updated_at: { type: 'string' },
          visited: { type: 'array' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        return missionStatus(root, args.mission_id)
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_fetch',
    description:
      'Fetch a URL with the local browser39 and store it in the mission ' +
      '(page.json + text chunks + links, plus a visited-ledger row). A URL ' +
      'already stored (same normalized final URL, or one that previously ' +
      'redirected onto it) returns an IMMEDIATE cache-hit receipt: cached:' +
      ' true, same artifact_id, age_days, zero browser spawn. Pass force: ' +
      'true to re-fetch (overwrites in place, same artifact_id). Fresh ' +
      'receipts carry page_quality (full | thin | blocked), chunk_count, ' +
      'preview_head, sample_links (≤5), and a deterministic next_step_hint; ' +
      'same-host misses add hint_find_first. Blocked pages (4xx/5xx, empty) ' +
      'are stored too, so dead URLs are known, not guessed.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch (required).' },
        mission_id: { type: 'string', description: 'Mission id (default: most recently started active mission).' },
        force: { type: 'boolean', description: 'Re-fetch even if already stored (overwrites in place, same artifact_id).' },
        cwd: CWD_PARAM,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          mission_id: { type: 'string' },
          artifact_id: { type: 'string' },
          url: { type: 'string' },
          final_url: { type: 'string' },
          cached: { type: 'boolean' },
          fetched_at: { type: 'string' },
          age_days: { type: 'number' },
          page_quality: { type: 'string' },
          quality_signals: { type: 'array' },
          consent_attempted: { type: 'boolean' },
          consent_improved: { type: 'boolean' },
          chunk_count: { type: 'integer' },
          preview_head: { type: 'string' },
          depth: { type: 'integer' },
          parent_artifact_id: { type: ['string', 'null'] },
          visited_count: { type: 'integer' },
          next_step_hint: { type: 'string' },
          sample_links: { type: 'array' },
          hint_find_first: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        return await runFetch(root, new Browser39Fetcher(), {
          url: args.url,
          mission_id: args.mission_id,
          force: args.force,
        })
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_stop',
    description:
      'Stop the default (most recently started active) mission, or the given ' +
      'mission_id. Records the stop in the manifest, appends a footer line to ' +
      'mission.md, and updates the recents row. Re-stopping is a no-op with ' +
      'already_stopped: true.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mission_id: { type: 'string', description: 'Mission id (default: most recently started active mission).' },
        reason: { type: 'string', description: 'Why the mission is stopping (optional).' },
        cwd: CWD_PARAM,
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        properties: {
          ok: { type: 'boolean' },
          error: { type: 'string' },
          mission_id: { type: 'string' },
          status: { type: 'string' },
          stop_reason: { type: 'string' },
          updated_at: { type: 'string' },
          already_stopped: { type: 'boolean' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        const id = resolveMissionId(root, args.mission_id)
        const { manifest, already_stopped } = stopMission(root, id, args.reason)
        return {
          mission_id: manifest.mission_id,
          status: manifest.status,
          stop_reason: manifest.stop_reason,
          updated_at: manifest.updated_at,
          already_stopped,
        }
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  return () => {
    for (const dispose of disposers.splice(0)) dispose()
  }
}
