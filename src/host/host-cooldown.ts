/**
 * Host wiedervorlage (R4.4) — deterministic cool-down after repeated
 * non-retriable outcomes on the same host. No timers: state lives on the
 * mission manifest and lifts on mission end, `force: true`, or M successful
 * fetches on *other* hosts.
 */
import type { FetchedPage } from '../shared/types.ts'
import type { Manifest } from './store.ts'

export interface HostCooldownEntry {
  /** Count of non-retriable outcomes on this host in this mission. */
  non_retriable: number
  /** True once non_retriable ≥ K — further fetches refuse with host_cooldown. */
  cooldown: boolean
  /**
   * Successful (quality=full) fetches on *other* hosts since this host entered
   * cooldown. When ≥ M, cooldown lifts.
   */
  others_since_cooldown?: number
}

export type HostCooldownMap = Record<string, HostCooldownEntry>

/** Signals that mean "do not keep hitting this host" (even if quality is thin). */
const NON_RETRIABLE_SIGNALS = [
  'js_required',
  'site_maintenance',
  'cf_challenge',
  'empty_json',
  'zero_hits',
]

export function isNonRetriable(
  quality: FetchedPage['quality'] | string,
  signals: string[] = [],
): boolean {
  if (quality === 'blocked') return true
  return signals.some((s) =>
    NON_RETRIABLE_SIGNALS.some((m) => s === m || s.startsWith(`${m}:`) || s.startsWith(`${m}-`)),
  )
}

export function hostOnCooldown(manifest: Manifest, host: string): boolean {
  return manifest.host_cooldowns?.[host]?.cooldown === true
}

/**
 * Record a fetch outcome against host H. Mutates a copy of the cooldown map
 * (caller persists onto the manifesto). Returns the next map.
 */
export function recordHostOutcome(
  map: HostCooldownMap | undefined,
  host: string,
  opts: {
    nonRetriable: boolean
    /** quality === full on this host */
    successfulFull: boolean
    /** Lift threshold K (default 2). */
    K: number
    /** Lift after M successful other-host fetches (default 2). */
    M: number
  },
): HostCooldownMap {
  const next: HostCooldownMap = { ...(map ?? {}) }
  const entry: HostCooldownEntry = {
    non_retriable: next[host]?.non_retriable ?? 0,
    cooldown: next[host]?.cooldown ?? false,
    others_since_cooldown: next[host]?.others_since_cooldown,
  }

  if (opts.nonRetriable) {
    entry.non_retriable += 1
    if (entry.non_retriable >= opts.K) {
      entry.cooldown = true
      entry.others_since_cooldown = entry.others_since_cooldown ?? 0
    }
  }

  if (opts.successfulFull) {
    // Successful full on H itself does not clear H's cooldown (plan: other hosts).
    // Increment others_since for every *other* host currently in cooldown.
    for (const [h, e] of Object.entries(next)) {
      if (h === host || !e.cooldown) continue
      const count = (e.others_since_cooldown ?? 0) + 1
      if (count >= opts.M) {
        next[h] = { ...e, cooldown: false, others_since_cooldown: 0 }
      } else {
        next[h] = { ...e, others_since_cooldown: count }
      }
    }
  }

  next[host] = entry
  return next
}

/** Clear cooldown for one host (`force: true` escape). */
export function liftHostCooldown(map: HostCooldownMap | undefined, host: string): HostCooldownMap {
  if (!map?.[host]) return map ?? {}
  return {
    ...map,
    [host]: {
      ...map[host],
      cooldown: false,
      others_since_cooldown: 0,
    },
  }
}

/** Clear all cooldowns (mission end). */
export function clearAllHostCooldowns(): HostCooldownMap {
  return {}
}
