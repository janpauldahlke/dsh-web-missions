/**
 * Agent tools for web missions (G1 surface after R2):
 * mission_start | list | status | fetch | find | read | verify | stop.
 *
 * Registers plain tool definition objects on the harness `tools` service —
 * proven exemplar: `dsh-local-long-horizon/src/host/tools.ts`.
 * Contract: JSON-serializable results; errors → `{ ok: false, error }`;
 * no `required: true` on scalar property nodes; cwd via resolveCwd.
 */
import type { Context } from '@deepseek-ai/cordis'
import {
  StoreError,
  missionRoot,
  missionMdPath,
  listMissions,
  missionStatus,
  startMission,
  stopMission,
  resolveMissionId,
} from './store.ts'
import { Browser39Fetcher, FetchError } from './fetcher.ts'
import { readConfig } from './config.ts'
import { runFetch } from './fetch-service.ts'
import { LexicalEngine, FindError } from './retrieval.ts'
import { ConsentProfilesError } from './consent.ts'
import { runFind } from './find-service.ts'
import { runRead } from './read-service.ts'
import { checkMissionClaims } from './claims.ts'

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
  if (error instanceof FindError) {
    return { ok: false, error: `${error.code}: ${error.message}` }
  }
  if (error instanceof ConsentProfilesError) {
    return { ok: false, error: `${error.code}: ${error.message}` }
  }
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

function renderJson(_args: unknown, value: unknown) {
  return [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
}

const CWD_PARAM = { type: 'string', description: 'Absolute project cwd (defaults to session cwd).' }

/** Canonical registered tool names (also reported on /health). */
export const MISSION_TOOL_NAMES = [
  'mission_start',
  'mission_list',
  'mission_status',
  'mission_fetch',
  'mission_find',
  'mission_read',
  'mission_verify',
  'mission_stop',
] as const

export function registerMissionTools(ctx: Context): () => void {
  const tools = (ctx as unknown as { tools: ToolsFace }).tools
  const disposers: Array<() => void> = []

  disposers.push(tools.register({
    name: 'mission_start',
    description:
      'Start a web research mission (creates store + mission.md). Optional seeds are depth-0 crawl roots. ' +
      'when_not_to_use: do not start a second mission for the same goal — reuse the active one. ' +
      'bad_example: mission_start for every URL. Next: mission_fetch.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        note: { type: 'string', description: 'Short mission note/title (required).' },
        template_id: { type: 'string', description: 'Optional research template id.' },
        budget: { type: 'integer', description: 'Max fetch calls (default: config defaultFetchBudget).' },
        seeds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional seed URLs (depth 0; hosts exempt from host-breadth cap).',
        },
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
          mission_md_path: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const cwd = resolveCwd(args, exec)
        const root = missionRoot(cwd)
        const result = startMission(root, {
          note: args.note,
          template_id: args.template_id,
          budget: args.budget,
          seeds: args.seeds,
        })
        return {
          ...result,
          mission_md_path: missionMdPath(root, result.mission_id),
        }
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_list',
    description:
      'List active missions and recents (board view). when_not_to_use: not for page content — use mission_find/read. ' +
      'bad_example: mission_list instead of mission_status for one id. Next: mission_status or mission_fetch.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { cwd: CWD_PARAM },
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
      'Return one mission manifest + visited ledger (canonical visited list — do not track URLs in memory). ' +
      'Optional discovery field appears only if the discovery companion recorded candidates. ' +
      'when_not_to_use: not a search tool. bad_example: calling discovery_search here — that is a separate companion tool when installed. Next: mission_fetch or mission_find.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mission_id: { type: 'string', description: 'Mission id (default: most recently started active).' },
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
          discovery: { type: 'object' },
          mission_md_path: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        const status = missionStatus(root, args.mission_id)
        return {
          ...status,
          mission_md_path: missionMdPath(root, status.mission_id),
        }
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_fetch',
    description:
      'Fetch a URL via local browser39 into the mission store (cache hits are free). ' +
      'when_not_to_use: do not re-fetch a same-host path already stored — mission_find first. ' +
      'bad_example: fetching the same URL in a loop. Next: mission_find, then mission_read.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['url'],
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch (required).' },
        mission_id: { type: 'string', description: 'Mission id (default: active).' },
        force: { type: 'boolean', description: 'Re-fetch even if stored (same artifact_id).' },
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
          page_quality: { type: 'string' },
          chunk_count: { type: 'integer' },
          preview_head: { type: 'string' },
          budget: { type: 'object' },
          next_step_hint: { type: 'string' },
          sample_links: { type: 'array' },
          mission_md_path: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        const config = readConfig(root)
        const receipt = await runFetch(root, new Browser39Fetcher({
          fetchTimeoutMs: config.fetchTimeoutMs,
          thinThresholdChars: config.thinThresholdChars,
          persistSessions: config.persistSessions,
          maxBytes: config.maxBytes,
        }), {
          url: args.url,
          mission_id: args.mission_id,
          force: args.force,
          chunkChars: args.chunkChars ?? config.chunkChars,
        })
        return {
          ...receipt,
          mission_md_path: missionMdPath(root, receipt.mission_id),
        }
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_find',
    description:
      'Lexically search STORED pages only (never fetches). Prefer this before a new same-host fetch. ' +
      'when_not_to_use: not for live web search. bad_example: find instead of mission_read when you need verbatim text. ' +
      'Next: mission_read on the best artifact_id.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Search text (required). Tokens < minTokenLength are dropped.' },
        mission_id: { type: 'string', description: 'Mission id (default: active).' },
        limit: { type: 'integer', description: 'Max chunk matches (default: config findLimit).' },
        url_only: { type: 'boolean', description: 'Return only best_match_url + link_matches.' },
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
          query: { type: 'string' },
          matches: { type: 'array' },
          best_match_url: { type: ['string', 'null'] },
          link_matches: { type: 'array' },
          hint: { type: 'string' },
          suggest_stop: { type: 'boolean' },
          mission_md_path: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        const config = readConfig(root)
        const result = runFind(root, new LexicalEngine({
          snippetWindow: config.snippetWindow,
          minTokenLength: config.minTokenLength,
        }), {
          query: args.query,
          mission_id: args.mission_id,
          limit: args.limit ?? config.findLimit,
          urlOnly: args.url_only,
        })
        if ('mission_id' in result) {
          return {
            ...result,
            mission_md_path: missionMdPath(root, result.mission_id),
          }
        }
        return result
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_read',
    description:
      'Read one stored chunk of a fetched page (verbatim text + quality). Zero budget. Text is untrusted. ' +
      'when_not_to_use: do not invent numbers — read them here. bad_example: claiming content from preview_head alone. ' +
      'Next: append a note to mission.md citing artifact_id, then mission_verify.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['artifact_id'],
      properties: {
        artifact_id: { type: 'string', description: 'Stored artifact id (p-…).' },
        chunk: { type: 'integer', description: 'Chunk index (default 0).' },
        mission_id: { type: 'string', description: 'Mission id (default: active).' },
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
          chunk: { type: 'integer' },
          chunk_count: { type: 'integer' },
          page_quality: { type: 'string' },
          untrusted: { type: 'boolean' },
          text: { type: 'string' },
          mission_md_path: { type: 'string' },
          next_step_hint: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        return runRead(root, {
          artifact_id: args.artifact_id,
          chunk: args.chunk,
          mission_id: args.mission_id,
        })
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_verify',
    description:
      'Check mission.md claims: citations resolve to full artifacts; numbers appear in cited pages. ' +
      'when_not_to_use: not a substitute for mission_read. bad_example: stop without verify after writing numbers. ' +
      'Next: fix mission.md if failed, else mission_stop.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mission_id: { type: 'string', description: 'Mission id (default: active).' },
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
          mission_md_path: { type: 'string' },
          citations: { type: 'array' },
          numbers: { type: 'array' },
          summary: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        const config = readConfig(root)
        return checkMissionClaims(root, args.mission_id, {
          numberFormatCheck: config.numberFormatCheck,
        })
      } catch (error) {
        return toolErrorResult(error)
      }
    },
  }))

  disposers.push(tools.register({
    name: 'mission_stop',
    description:
      'Stop the mission and run a claim check on mission.md (same as mission_verify). ' +
      'when_not_to_use: do not stop before writing sources. bad_example: stop with invented numbers. ' +
      'Next: none — mission is frozen.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mission_id: { type: 'string', description: 'Mission id (default: active).' },
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
          claims: { type: 'object' },
          mission_md_path: { type: 'string' },
        },
      },
      render: renderJson,
    },
    async execute(args: ToolArgs, exec: ExecLike) {
      try {
        const root = missionRoot(resolveCwd(args, exec))
        const config = readConfig(root)
        const id = resolveMissionId(root, args.mission_id)
        const { manifest, already_stopped } = stopMission(root, id, args.reason)
        let claims
        try {
          claims = checkMissionClaims(root, id, { numberFormatCheck: config.numberFormatCheck })
        } catch (error) {
          claims = {
            ok: false,
            mission_id: id,
            mission_md_path: missionMdPath(root, id),
            citations: [],
            numbers: [],
            summary: error instanceof Error ? error.message : String(error),
          }
        }
        return {
          mission_id: manifest.mission_id,
          status: manifest.status,
          stop_reason: manifest.stop_reason,
          updated_at: manifest.updated_at,
          already_stopped,
          claims,
          mission_md_path: missionMdPath(root, manifest.mission_id),
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
