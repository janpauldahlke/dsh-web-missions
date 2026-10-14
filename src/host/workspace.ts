/**
 * Pane ↔ tools cwd bridge (R2.3 + R4.0).
 *
 * Tools resolve the mission root from the agent session header (or an
 * explicit `cwd` arg). Pane routes have no session — they used to freeze
 * `process.cwd()` at register time, so F6 / playground sessions wrote to
 * one store while the sidebar read another (empty board).
 *
 * Fix: remember the last cwd any mission_* tool used in this process, and
 * let pane routes resolve the root from that. R4.0: the Missions pane also
 * POSTs/GETs with the **active chat workspace cwd** on tab open so a restart
 * does not leave the board on `$HOME` until the first tool call.
 *
 * Fallback: process.cwd() (acceptance boot — D6).
 */
import { missionRoot } from './store.ts'

let lastMissionCwd: string | null = null

export function noteMissionCwd(cwd: string): void {
  const trimmed = cwd?.trim()
  if (trimmed) lastMissionCwd = trimmed
}

export function getMissionCwd(): string {
  return lastMissionCwd ?? process.cwd()
}

export function paneMissionRoot(): string {
  return missionRoot(getMissionCwd())
}

/** Test/reset hook. */
export function _resetMissionCwdForTests(): void {
  lastMissionCwd = null
}
