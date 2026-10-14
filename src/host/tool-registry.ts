/**
 * Process-local registry of mission_* tools that actually registered.
 * Shared by tools.ts (writer), /health (reader), and hint wording (R2.1).
 */

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

export type MissionToolName = (typeof MISSION_TOOL_NAMES)[number]

let registeredMissionTools: string[] = []

export function resetRegisteredMissionTools(): void {
  registeredMissionTools = []
}

export function markMissionToolRegistered(name: string): void {
  if (!registeredMissionTools.includes(name)) registeredMissionTools.push(name)
}

export function getRegisteredMissionTools(): readonly string[] {
  return registeredMissionTools
}

export function hasMissionTool(name: string): boolean {
  return registeredMissionTools.includes(name)
}

/**
 * Hint fragment that only names tools known registered in this process.
 * Empty registry (unit tests / pre-apply) → name the preferred tools so
 * exact-string smokes and pre-boot receipts stay stable. After a partial
 * registration, never advertise a tool that failed to register (R2.1).
 */
export function hintTools(...preferred: string[]): string {
  if (registeredMissionTools.length === 0) return preferred.join(' / ')
  const have = preferred.filter((n) => registeredMissionTools.includes(n))
  if (have.length > 0) return have.join(' / ')
  return 'query the mission store (status / artifacts on disk)'
}
