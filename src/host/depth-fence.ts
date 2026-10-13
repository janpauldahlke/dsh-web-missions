/**
 * Depth fence (M5 5.3, D-M5.7/D-M5.8 — the crawl boundary, host law).
 *
 * Bounded wandering, operator-tunable, enforced by the HOST (same tier as the
 * budget and the allowlist — browser39 can be told nothing, the agent can be):
 *
 * - `maxDepth` (default 2): max link-hops from the nearest seed/root that a
 *   fetch may be. A URL's depth is deterministic (lineage below).
 * - `maxDiscoveredHosts` (default 3): max distinct NON-SEED hosts the mission
 *   may fetch. Hosts of explicit mission seeds (mission_start `seeds`) are
 *   exempt. A "fresh root" (URL with no known lineage) is depth 0 but its
 *   host still counts — D-M5.8: discovery (M7 search results) is not seeds,
 *   fetching them consumes the discovered-host budget.
 *
 * Lineage (deterministic, D-M5.7): depth(U) = min over
 *   - 0 — U is a seed (mission_start), or U appears in no stored page
 *     (fresh root: deliberate roots, not wandering);
 *   - row.depth — the ledger row whose final key is U (one row per
 *     normalized URL; force re-fetches keep the row and its lineage);
 *   - row.depth + 1 — every stored page whose links.json lists U.
 * The parent is the artifact achieving the min (ties: lexicographically
 * smallest artifact id; roots have no parent).
 *
 * Gate point: in mission_fetch after the allowlist, before the budget, and
 * only on the spawn path (D-M5.4: cache hits are NOT re-gated — the page was
 * already admitted; `force` re-gates). Refusals throw StoreError
 * `depth_exceeded` / `host_breadth_exceeded` with a deterministic next-step
 * hint; they cost zero (no spawn, no budget charge).
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { StoreError, type Manifest } from './store.ts'
import { normalizeUrl } from './normalize.ts'

export interface FenceKnobs {
  maxDepth: number
  maxDiscoveredHosts: number
}

export interface Lineage {
  /** Hops from the nearest seed/root (0 = seed or fresh root). */
  depth: number
  /** Artifact achieving the minimal depth (null for roots). */
  parent_artifact_id: string | null
}

export interface FenceCheck extends Lineage {
  /** Distinct non-seed hosts already in the ledger (before this fetch). */
  discovered_hosts: number
  /** Set when this fetch would add a new (non-seed) host. */
  new_host: string | null
}

/**
 * Deterministic next-step hint (plan D-M5.7): appended verbatim to both
 * refusal messages.
 */
export const FENCE_HINT =
  'fence refused this fetch: follow a nearer link, raise the knob in config, or start a new mission rooted at the URL'

/**
 * Host key for the fence: lowercased hostname, no port (same rule as the C7
 * session keys — a redirect off-port on the same hostname is not a new site).
 */
export function hostKey(url: string): string {
  return new URL(url).hostname.toLowerCase()
}

/** Normalized seed URLs from a manifest (M2-era manifests predate them → []). */
export function manifestSeeds(manifest: Manifest): string[] {
  return Array.isArray(manifest.seeds) ? manifest.seeds : []
}

/** Hosts exempt from the discovered-host count: the explicit mission seeds. */
export function seedHosts(manifest: Manifest): Set<string> {
  const hosts = new Set<string>()
  for (const seed of manifestSeeds(manifest)) {
    try {
      hosts.add(hostKey(seed))
    } catch {
      /* non-URL seed key (should not happen — the store normalizes) */
    }
  }
  return hosts
}

/** Distinct non-seed hosts already fetched (final URLs in the ledger). */
export function discoveredHosts(manifest: Manifest): Set<string> {
  const exempt = seedHosts(manifest)
  const hosts = new Set<string>()
  for (const row of manifest.fetched) {
    try {
      const host = hostKey(row.url)
      if (!exempt.has(host)) hosts.add(host)
    } catch {
      /* legacy row with unparsable url — skipped for host counting */
    }
  }
  return hosts
}

/**
 * Stored links of one artifact (links.json; missing/unreadable → [] — same
 * degradation policy as readArtifact: the page record is the truth, links are
 * advisory for lineage).
 */
function readStoredLinks(root: string, missionId: string, artifactId: string): Array<{ url: string; text: string }> {
  const path = join(root, missionId, 'pages', artifactId, 'links.json')
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Deterministic lineage for a URL (D-M5.7) — see module doc for the rule.
 * Pure over the mission store: same manifest + artifacts ⇒ same answer.
 */
export function computeLineage(root: string, manifest: Manifest, url: string): Lineage {
  const key = normalizeUrl(url)
  if (manifestSeeds(manifest).includes(key)) {
    return { depth: 0, parent_artifact_id: null }
  }

  const candidates: Lineage[] = []
  for (const row of manifest.fetched) {
    const rowDepth = typeof row.depth === 'number' ? row.depth : 0
    if (row.normalized_url === key) {
      // The URL was itself fetched (this row, one per key).
      candidates.push({ depth: rowDepth, parent_artifact_id: row.parent_artifact_id ?? null })
    }
    for (const link of readStoredLinks(root, manifest.mission_id, row.artifact_id)) {
      let linkKey: string
      try {
        linkKey = normalizeUrl(link.url)
      } catch {
        continue // non-normalizable link (should not happen — the fetcher filters)
      }
      if (linkKey === key) {
        candidates.push({ depth: rowDepth + 1, parent_artifact_id: row.artifact_id })
      }
    }
  }
  if (candidates.length === 0) {
    return { depth: 0, parent_artifact_id: null } // fresh root
  }

  let best = candidates[0]
  for (const c of candidates.slice(1)) {
    if (
      c.depth < best.depth ||
      (c.depth === best.depth && (c.parent_artifact_id ?? '') < (best.parent_artifact_id ?? ''))
    ) {
      best = c
    }
  }
  return best
}

/** English ordinal (1st, 2nd, 3rd, 11th, 21st…) for the "Kth" fence message. */
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/**
 * Pre-spawn fence gate (D-M5.7/D-M5.8). Throws:
 *   - `depth_exceeded: <url> is N hops from nearest seed (maxDepth: M) — …`
 *   - `host_breadth_exceeded: <host> would be the Kth non-seed host (maxDiscoveredHosts: M) — …`
 * (K = discovered hosts so far + 1, rendered as a proper English ordinal).
 * Zero cost: the caller must not spawn or charge when this throws. Returns
 * the lineage + host facts on success.
 */
export function checkDepthFence(
  root: string,
  manifest: Manifest,
  url: string,
  knobs: FenceKnobs,
): FenceCheck {
  const key = normalizeUrl(url)
  const lineage = computeLineage(root, manifest, key)

  if (lineage.depth > knobs.maxDepth) {
    throw new StoreError(
      'depth_exceeded',
      `${url} is ${lineage.depth} hops from nearest seed (maxDepth: ${knobs.maxDepth}) — ${FENCE_HINT}`,
    )
  }

  const host = hostKey(key)
  const exempt = seedHosts(manifest)
  const discovered = discoveredHosts(manifest)
  const isNewHost = !exempt.has(host) && !discovered.has(host)
  if (isNewHost && discovered.size >= knobs.maxDiscoveredHosts) {
    throw new StoreError(
      'host_breadth_exceeded',
      `${host} would be the ${ordinal(discovered.size + 1)} non-seed host (maxDiscoveredHosts: ${knobs.maxDiscoveredHosts}) — ${FENCE_HINT}`,
    )
  }
  return {
    ...lineage,
    discovered_hosts: discovered.size,
    new_host: isNewHost ? host : null,
  }
}
