/**
 * Agent tools for web missions (M1): mission_start, mission_stop
 * (mission_list / mission_status land in slice 1.3).
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
  startMission,
  stopMission,
  resolveMissionId,
} from './store.ts'

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
