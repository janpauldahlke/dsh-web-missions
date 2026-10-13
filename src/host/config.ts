/**
 * Mission config (M5, "one mechanism" per M_5_ledger.md config surface).
 *
 * Knobs live in `<cwd>/.dsh/web-missions/config.json` (root = missionRoot) —
 * OPTIONAL file; every field is optional and merges over the defaults below.
 * Absent file = all defaults. Present-but-corrupt file = StoreError
 * `config_corrupt` (fail loud, never guess). Unknown keys are ignored (a
 * newer/older plugin version may carry them).
 *
 * The file is named in the M5 plan (config surface, v0 table); DESIGN C4/C6
 * reference the knobs by name. No UI for knobs until M6.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StoreError } from './store.ts'

/** v0 knob surface (M_5_ledger.md "Config surface"). */
export interface MissionConfig {
  /** Artifact chunk size in chars (M2, default 2000). */
  chunkChars: number
  /** mission_start default budget in fetch calls (C6, default 10). */
  defaultFetchBudget: number
  /** Stored-content cap in bytes; overflow → quality_signals: ["truncated"] (5.6). */
  maxBytes: number
  /** Egress allowlist gate: 'on' = .dsh/allowlist.txt deny-all default (5.2). */
  allowlist: 'on' | 'off'
  /** Host-scoped browser39 sessions under ~/.dsh/browser39/sessions/<host>/ (5.4). */
  persistSessions: boolean
  /** Charge cache hits against the budget (default false = hits free, C6). */
  cacheHitCountsAsBudget: boolean
  /** browser39 fetch timeout (M2, default 30000). */
  fetchTimeoutMs: number
  /** Below this text length a page is `thin` (M2, default 300). */
  thinThresholdChars: number
  /** Max accept-labels tried per thin fetch (C10, default 2). */
  consentMaxAttempts: number
  /** Snippet window in chars ± around the best hit (M4, default 120). */
  snippetWindow: number
  /** Depth fence: max link-hops from the nearest seed (default 2). */
  maxDepth: number
  /** Depth fence: max distinct non-seed hosts per mission (default 3). */
  maxDiscoveredHosts: number
}

export const CONFIG_FILENAME = 'config.json'

/** Default mission budget in fetch calls (C6; was store.ts `DEFAULT_FETCH_BUDGET`). */
export const DEFAULT_FETCH_BUDGET = 10

export const DEFAULT_CONFIG: MissionConfig = {
  chunkChars: 2000,
  defaultFetchBudget: DEFAULT_FETCH_BUDGET,
  maxBytes: 2 * 1024 * 1024,
  allowlist: 'on',
  persistSessions: true,
  cacheHitCountsAsBudget: false,
  fetchTimeoutMs: 30000,
  thinThresholdChars: 300,
  consentMaxAttempts: 2,
  snippetWindow: 120,
  maxDepth: 2,
  maxDiscoveredHosts: 3,
}

type FieldSpec =
  | { key: keyof MissionConfig; kind: 'number' }
  | { key: keyof MissionConfig; kind: 'boolean' }
  | { key: keyof MissionConfig; kind: 'enum'; allowed: readonly string[] }

const FIELDS: FieldSpec[] = [
  { key: 'chunkChars', kind: 'number' },
  { key: 'defaultFetchBudget', kind: 'number' },
  { key: 'maxBytes', kind: 'number' },
  { key: 'allowlist', kind: 'enum', allowed: ['on', 'off'] },
  { key: 'persistSessions', kind: 'boolean' },
  { key: 'cacheHitCountsAsBudget', kind: 'boolean' },
  { key: 'fetchTimeoutMs', kind: 'number' },
  { key: 'thinThresholdChars', kind: 'number' },
  { key: 'consentMaxAttempts', kind: 'number' },
  { key: 'snippetWindow', kind: 'number' },
  { key: 'maxDepth', kind: 'number' },
  { key: 'maxDiscoveredHosts', kind: 'number' },
]

export function configPath(root: string): string {
  return join(root, CONFIG_FILENAME)
}

/**
 * Read + validate the optional config file and merge over DEFAULT_CONFIG.
 * `root` is the mission root (`<cwd>/.dsh/web-missions`).
 */
export function readConfig(root: string): MissionConfig {
  let raw: string
  try {
    raw = readFileSync(configPath(root), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_CONFIG }
    throw new StoreError('config_unreadable', `cannot read ${CONFIG_FILENAME}: ${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StoreError('config_corrupt', `${CONFIG_FILENAME} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StoreError('config_corrupt', `${CONFIG_FILENAME} must be a JSON object`)
  }
  const record = parsed as Record<string, unknown>
  const merged: MissionConfig = { ...DEFAULT_CONFIG }
  const set = (key: keyof MissionConfig, value: unknown): void => {
    ;(merged as Record<keyof MissionConfig, unknown>)[key] = value
  }
  for (const spec of FIELDS) {
    const value = record[spec.key]
    if (value === undefined) continue
    if (spec.kind === 'enum') {
      if (typeof value !== 'string' || !spec.allowed.includes(value)) {
        throw new StoreError('config_corrupt', `${CONFIG_FILENAME}: "${spec.key}" must be one of: ${spec.allowed.join(' | ')}`)
      }
      set(spec.key, value)
    } else if (spec.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new StoreError('config_corrupt', `${CONFIG_FILENAME}: "${spec.key}" must be a finite number`)
      }
      set(spec.key, value)
    } else {
      if (typeof value !== 'boolean') {
        throw new StoreError('config_corrupt', `${CONFIG_FILENAME}: "${spec.key}" must be true or false`)
      }
      set(spec.key, value)
    }
  }
  return merged
}
