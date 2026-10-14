/**
 * Mission config (M5, "one mechanism" per M_5_ledger.md config surface).
 *
 * Knobs live in `<cwd>/.dsh/web-missions/config.json` (root = missionRoot) —
 * OPTIONAL file; every field is optional and merges over the defaults below.
 * Optional global layer: `~/.dsh/web-missions/config.json` (rig defaults),
 * then project file wins. Absent file = all defaults. Present-but-corrupt
 * file = StoreError `config_corrupt` (fail loud, never guess). Unknown keys
 * are ignored.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { StoreError } from './store.ts'

/** v0 knob surface (M_5_ledger.md "Config surface" + R1.6 flat knobs). */
export interface MissionConfig {
  /** Artifact chunk size in chars (M2, default 2000). */
  chunkChars: number
  /** mission_start default budget in fetch calls (C6, default 10). */
  defaultFetchBudget: number
  /** Stored-content cap in bytes; overflow → quality_signals: ["truncated"] (5.6). */
  maxBytes: number
  /** Egress allowlist gate: 'on' = .dsh/allowlist.txt; default 'off' (G2 lean). */
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
  /** Receipt preview_head length (R4.1, default 300). */
  previewChars: number
  /** Max sample_links on a fetch receipt (R4.1, default 5). */
  sampleLinks: number
  /** mission_read text cap per chunk return (G5, default 8000). */
  readChars: number
  /** mission_find default match limit (default 5). */
  findLimit: number
  /** Minimum find token length (default 3). */
  minTokenLength: number
  /** Recents cap on the board (default 50). */
  recentsCap: number
  /** Claim check: require numbers in mission.md to appear in cited pages (default true). */
  numberFormatCheck: boolean
}

export const CONFIG_FILENAME = 'config.json'

/** Default mission budget in fetch calls (C6; was store.ts `DEFAULT_FETCH_BUDGET`). */
export const DEFAULT_FETCH_BUDGET = 10

/** Default stored-content cap in bytes (M5 5.6: overflow → `truncated`). */
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024

export const DEFAULT_CONFIG: MissionConfig = {
  chunkChars: 2000,
  defaultFetchBudget: DEFAULT_FETCH_BUDGET,
  maxBytes: DEFAULT_MAX_BYTES,
  allowlist: 'off',
  persistSessions: true,
  cacheHitCountsAsBudget: false,
  fetchTimeoutMs: 30000,
  thinThresholdChars: 300,
  consentMaxAttempts: 2,
  snippetWindow: 120,
  maxDepth: 2,
  maxDiscoveredHosts: 3,
  previewChars: 300,
  sampleLinks: 5,
  readChars: 8000,
  findLimit: 5,
  minTokenLength: 3,
  recentsCap: 50,
  numberFormatCheck: true,
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
  { key: 'previewChars', kind: 'number' },
  { key: 'sampleLinks', kind: 'number' },
  { key: 'readChars', kind: 'number' },
  { key: 'findLimit', kind: 'number' },
  { key: 'minTokenLength', kind: 'number' },
  { key: 'recentsCap', kind: 'number' },
  { key: 'numberFormatCheck', kind: 'boolean' },
]

export function configPath(root: string): string {
  return join(root, CONFIG_FILENAME)
}

export function globalConfigPath(): string {
  return join(homedir(), '.dsh', 'web-missions', CONFIG_FILENAME)
}

function parseConfigObject(raw: string, label: string): Partial<MissionConfig> {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new StoreError('config_corrupt', `${label} is not valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StoreError('config_corrupt', `${label} must be a JSON object`)
  }
  const record = parsed as Record<string, unknown>
  const out: Partial<MissionConfig> = {}
  for (const spec of FIELDS) {
    const value = record[spec.key]
    if (value === undefined) continue
    if (spec.kind === 'enum') {
      if (typeof value !== 'string' || !spec.allowed.includes(value)) {
        throw new StoreError('config_corrupt', `${label}: "${spec.key}" must be one of: ${spec.allowed.join(' | ')}`)
      }
      ;(out as Record<string, unknown>)[spec.key] = value
    } else if (spec.kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new StoreError('config_corrupt', `${label}: "${spec.key}" must be a finite number`)
      }
      ;(out as Record<string, unknown>)[spec.key] = value
    } else {
      if (typeof value !== 'boolean') {
        throw new StoreError('config_corrupt', `${label}: "${spec.key}" must be true or false`)
      }
      ;(out as Record<string, unknown>)[spec.key] = value
    }
  }
  return out
}

function readOptionalConfigFile(path: string, label: string): Partial<MissionConfig> {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new StoreError('config_unreadable', `cannot read ${label}: ${(error as Error).message}`)
  }
  return parseConfigObject(raw, label)
}

/**
 * Read + validate optional global + project config files and merge over
 * DEFAULT_CONFIG. `root` is the mission root (`<cwd>/.dsh/web-missions`).
 */
export function readConfig(root: string): MissionConfig {
  const global = readOptionalConfigFile(globalConfigPath(), `~/.dsh/web-missions/${CONFIG_FILENAME}`)
  const project = readOptionalConfigFile(configPath(root), CONFIG_FILENAME)
  return { ...DEFAULT_CONFIG, ...global, ...project }
}
