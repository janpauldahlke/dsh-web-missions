/**
 * Pane ↔ tools cwd bridge (Refactoring 2 / R2.3).
 *
 * Tools resolve the mission root from the agent session header (or an
 * explicit `cwd` arg). Pane routes have no session — they used to freeze
 * `process.cwd()` at register time, so F6 / playground sessions wrote to
 * one store while the sidebar read another (empty board).
 *
 * Fix: remember the last cwd any mission_* tool used in this process, and
 * let pane routes resolve the root from that (falling back to process.cwd
 * before any tool has run — acceptance boot).
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
