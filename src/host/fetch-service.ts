/**
 * mission_fetch service (M2 base + M3 cache).
 *
 * Pipeline: resolve mission → normalize requested URL (pre-spawn guard) →
 * ledger lookup (M3: a hit returns an immediate cache receipt, ZERO spawn) →
 * fetcher.fetch → storeArtifact (new id, or in-place overwrite on force /
 * redirect-collapse) → ledger row (append, or update in place — one row per
 * normalized URL per mission) → C4 receipt.
 *
 * M3 (D11 rules live):
 * - hit (no force)  → cached:true, same artifact_id, age_days (S4), zero spawn
 * - force on a hit  → re-fetch, SAME artifact_id, row updated in place,
 *                     cached:false, age_days:0 (D-M3.2)
 * - fresh receipt   → age_days:0; same-host misses carry `hint_find_first`
 *                     (soft gate, D-M3.3: ≥1 stored page on the host)
 * - age is information, not a gate (D-M3.1): no expiry in v0
 *
 * M5 (C6 budget, S5):
 * - unit = fetch calls: a NON-CACHED attempt costs 1 (success, failure, or
 *   timeout — it was a browser spawn). The charge is persisted BEFORE the
 *   spawn, so a failed attempt still costs its call.
 * - cache hits are free (`cacheHitCountsAsBudget: false`, default; the knob
 *   comes from config.json and can be overridden per call).
 * - `budget.spent >= budget.max` → `budget_exhausted` (hard stop, D-M5.2: no
 *   override — a new `mission_start` continues; `force` does not bypass).
 * - every receipt carries `budget: { max, spent, remaining, unit }`.
 * - ledger rows written by a charged attempt carry `budget_charged: true`.
 *
 * M5 (5.2 egress allowlist, pre-spawn gate):
 * - `<cwd>/.dsh/allowlist.txt` (project-level) gates egress when config
 *   `allowlist: 'on'` (default is **off** — G2). Empty patterns →
 *   `allowlist_empty`; a miss → `allowlist_denied` (names the off-switch).
 * - only the spawn path is gated (D-M5.4: cache hits are not re-gated — the
 *   page was already admitted).
 *
 * M5 (5.3 depth fence, D-M5.7/D-M5.8 — crawl boundary):
 * - `maxDepth` (default 2): max link-hops from the nearest seed/root; a URL's
 *   depth is the deterministic lineage over the ledger rows + stored
 *   links.json (min over all parents; seeds and fresh roots are depth 0).
 * - `maxDiscoveredHosts` (default 3): max distinct NON-SEED hosts the mission
 *   may fetch; mission_start `seeds` are depth 0 and host-exempt, fresh roots
 *   are depth 0 but their host counts (D-M5.8: discovery is not seeds).
 * - gate order = allowlist → depth fence → budget: all BEFORE the spawn, all
 *   zero-cost when they fire (no spawn, no budget charge).
 * - rows + fresh receipts carry `depth` + `parent_artifact_id`; hit receipts
 *   carry the stored values (M2-era rows → 0/null).
 *
 * M5 (5.5 consent v0, C10):
 * - a FRESH fetch that comes back `thin` with a CMP marker signal runs the
 *   TACTICS seam (v0 = LabelClickTactic) in the SAME host session: per merged
 *   accept label (profile asset ∪ override ∪ generic, up to consentMaxAttempts)
 *   one browser39 batch tries to accept + measuring refetch; the longest
 *   result wins and is stored.
 * - budget (D-M5.5): the fetch was already charged pre-spawn; consent adds
 *   batch invocations only, never budget.
 * - consent link egress is allowlist-gated (it is egress); the depth fence
 *   does NOT apply — a consent navigation is part of the fetch of the
 *   requested URL, not a crawl step (nothing is stored at the link's URL).
 * - profiles: `.dsh/web-missions/consent_profiles.toml` override (fail-loud
 *   `consent_profiles_invalid`) → shipped asset → code defaults.
 * - receipts carry `consent_attempted` / `consent_improved`; a thin/blocked
 *   receipt after a failed consent attempt gets the do-not-claim hint (the
 *   5.6 honesty gate generalizes this).
 *
 * Errors propagate as StoreError / FetchError / ConsentProfilesError; the
 * tool layer renders `{ ok: false, error: '<code>: <msg>' }`.
 */
import { DO_NOT_CLAIM, type FetchedPage, type PageFetcher } from '../shared/types.ts'
import { readArtifact, storeArtifact, type StoredArtifact } from './artifacts.ts'
import { checkAllowlist, isAllowed, loadAllowlist } from './allowlist.ts'
import {
  consentNextStepHint,
  isConsentWall,
  labelsForHost,
  loadConsentProfiles,
  runConsent,
  type ConsentOutcome,
} from './consent.ts'
import { readConfig } from './config.ts'
import { checkDepthFence, type FenceCheck } from './depth-fence.ts'
import {
  hostOnCooldown,
  isNonRetriable,
  liftHostCooldown,
  recordHostOutcome,
} from './host-cooldown.ts'
import { normalizeUrl } from './normalize.ts'
import { classifyUrlSource } from './provenance.ts'
import { FetchError } from './fetcher.ts'
import { hintTools } from './tool-registry.ts'
import {
  StoreError,
  appendFetchedRow,
  budgetExhausted,
  budgetView,
  chargeBudget,
  readDiscoverySurface,
  readManifest,
  resolveMissionId,
  updateFetchedRow,
  writeHostCooldowns,
  type BudgetView,
  type FetchedRow,
  type Manifest,
} from './store.ts'

/** C4 receipt (M2 base; M3: `cached`/`age_days` become live values). */
export interface FetchReceipt {
  mission_id: string
  artifact_id: string
  url: string
  final_url: string
  /** M3: true when served from the ledger with zero browser spawn. */
  cached: boolean
  /** ISO 8601 UTC of the stored fetch (hit: the original; fresh: now). */
  fetched_at: string
  /** (now - fetched_at) / 86400000, 2 decimals, floored at 0 (S4). Fresh = 0. */
  age_days: number
  page_quality: FetchedPage['quality']
  quality_signals: string[]
  consent_attempted: boolean
  consent_improved: boolean
  chunk_count: number
  preview_head: string
  /**
   * M5 5.3 (depth fence): hops from the nearest seed/root. Fresh receipts:
   * the lineage computed at fetch time; hit receipts: the stored row value
   * (M2-era rows → 0).
   */
  depth: number
  /** M5 5.3: artifact achieving this url's minimal depth (null = root). */
  parent_artifact_id: string | null
  /**
   * C6 (M5, S5): the mission budget after this attempt — every receipt
   * carries it (unit = fetch calls).
   */
  budget: BudgetView
  visited_count: number
  next_step_hint: string
  sample_links: string[]
  /**
   * M3 soft gate (D-M3.3): present on fresh receipts when the mission already
   * has ≥1 stored page on the requested host. Text-only until mission_find
   * (M4); the fetch itself always proceeds.
   */
  hint_find_first?: string
  /** R4.7 — true when remaining fetch budget is 0 after this attempt. */
  budget_exhausted?: boolean
  /** R4.7 — wrap-up hint when budget is exhausted. */
  wrap_up_hint?: string
  /**
   * P_01 provenance (log-only): discovery | user | other.
   * Cache hits reuse the stored row's tag when present.
   */
  url_source?: 'discovery' | 'user' | 'other'
  /** R4.4 — host currently on wiedervorlage cool-down after this outcome. */
  host_cooldown?: boolean
}

/** v0 session key (C3): lowercased hostname, no port. */
export function hostSessionKey(url: string): string {
  return new URL(url).hostname.toLowerCase()
}

/**
 * Cache lookup by ledger key (M3): a row hits when the requested key matches
 * its `normalized_url` (the normalized FINAL url, D-M2.2) OR any of its
 * `requested_keys` (normalized URLs that previously redirected/stored onto
 * this row — makes a redirecting URL a zero-spawn hit on re-fetch, M3 V6).
 */
export function findLedgerRow(manifest: Manifest, key: string): FetchedRow | undefined {
  return manifest.fetched.find(
    (r) => r.normalized_url === key || (r.requested_keys?.includes(key) ?? false),
  )
}

/** (now - fetched_at) / 86400000, 2 decimals, floored at 0 (S4). */
export function ageDays(fetchedAt: string, nowMs: number): number {
  const t = Date.parse(fetchedAt)
  if (!Number.isFinite(t)) return 0
  return Math.max(0, Math.round(((nowMs - t) / 86400000) * 100) / 100)
}

function nextStepHint(quality: FetchedPage['quality'], signals: string[] = []): string {
  if (signals.includes('site_maintenance') || signals.some((s) => s.startsWith('cf_'))) {
    return `host looks under maintenance / CF challenge (quality_signals) — ${DO_NOT_CLAIM}; do not retry this host; pick another source`
  }
  if (signals.includes('empty_json') || signals.includes('zero_hits')) {
    return `empty or zero-hit JSON body — ${DO_NOT_CLAIM}; not useful evidence; try another URL or query`
  }
  if (signals.includes('js_required') || signals.includes('js_shell')) {
    return `page looks JS-gated or shell-only (quality_signals) — ${DO_NOT_CLAIM}; do not retry this URL; pick another source`
  }
  if (signals.includes('low_density')) {
    // Soft only — keep full; warn without the hard do-not-claim hammer.
    return `page stored but low_density (likely chrome/nav) — weak evidence; ${hintTools('mission_read')} to confirm or fetch another URL`
  }
  switch (quality) {
    case 'full':
      return `page stored — ${hintTools('mission_find', 'mission_read')} (or fetch a sample_links URL)`
    case 'thin':
      return `page is thin (short or likely a consent wall) — ${DO_NOT_CLAIM}; try a sample link or re-fetch with force`
    case 'blocked':
      return `fetch blocked (see quality_signals) — ${DO_NOT_CLAIM}; do not re-fetch this URL; pick another`
  }
}

function budgetWrapHint(budget: BudgetView): string | undefined {
  if (budget.remaining > 0) return undefined
  return `budget exhausted (0/${budget.max}) — write a conclusion and ${hintTools('mission_stop')}; do not invent more fetches`
}

/** M3 cached wording (M_3_cache.md hit path, verbatim intent). */
function cachedNextStepHint(quality: FetchedPage['quality'], age: number, signals: string[] = []): string {
  if (signals.includes('js_shell') || signals.includes('js_required')) {
    return `cached: stored as ${quality} with ${signals.filter((s) => s.startsWith('js_')).join(',')} (age ${age}d) — ${DO_NOT_CLAIM}. Prefer another URL.`
  }
  if (signals.includes('low_density')) {
    return `cached: already stored (age ${age}d) with low_density — weak evidence; ${hintTools('mission_read')}, or force: true to re-fetch.`
  }
  if (quality === 'full') {
    return `cached: already stored (age ${age}d). ${hintTools('mission_find', 'mission_read')}, or force: true to re-fetch.`
  }
  return `cached: stored as ${quality} (age ${age}d) — ${DO_NOT_CLAIM}. Re-fetch with force: true if you expect new content.`
}

/**
 * M5 5.6 honesty gate: EVERY thin/blocked receipt carries the deterministic
 * do-not-claim text in `next_step_hint` — enforced at the receipt choke point
 * (not by hoping each hint path remembers). Soft low_density/js_* already
 * include the claim text above.
 */
function honestyGate(hint: string, quality: FetchedPage['quality']): string {
  if (quality === 'full' || hint.includes(DO_NOT_CLAIM)) return hint
  return `${hint} — ${DO_NOT_CLAIM}`
}

export interface RunFetchArgs {
  url: string
  mission_id?: string
  /** M3: re-fetch even when stored — overwrite in place, same artifact_id. */
  force?: boolean
  /** Hand config (ENV.md); default 2000. */
  chunkChars?: number
}

export interface RunFetchOptions {
  /** Injectable clock (M3 V4: age_days arithmetic); default Date.now. */
  now?: () => number
  /**
   * C6: charge cache hits against the budget. Unset → config.json
   * `cacheHitCountsAsBudget` (default false = hits free).
   */
  cacheHitCountsAsBudget?: boolean
}

export async function runFetch(
  root: string,
  fetcher: PageFetcher,
  args: RunFetchArgs,
  opts: RunFetchOptions = {},
): Promise<FetchReceipt> {
  const now = opts.now ?? Date.now
  const config = readConfig(root)
  const hitsCost = opts.cacheHitCountsAsBudget ?? config.cacheHitCountsAsBudget

  // 1. resolve mission (D-M1.4 default rule; explicit id wins)
  const url = args.url?.trim()
  if (!url) throw new StoreError('bad_args', 'url is required')
  const missionId = resolveMissionId(root, args.mission_id)

  // 2. normalize BEFORE any spawn (V3: unparsable → normalize_failed, zero batch)
  const requestedKey = normalizeUrl(url)
  let manifest = readManifest(root, missionId)
  if (!manifest) throw new StoreError('unknown_mission', `no such mission: ${missionId}`)

  // 3. M3 hit path — no spawn (V1/V2/V5/V6)
  const hit = findLedgerRow(manifest, requestedKey)
  const force = args.force === true
  const hitFree = hit && !force

  // 4. M5 pre-spawn gates — all fire BEFORE the spawn and are zero-cost
  //    (no spawn, no budget charge). Order: allowlist → depth fence → budget.
  //    Cache hits skip the spawn-path gates (D-M5.4: the page was already
  //    admitted); a charged hit (knob on) still pays the budget.
  if (hitFree) {
    if (hitsCost && budgetExhausted(manifest.budget)) {
      throw new StoreError(
        'budget_exhausted',
        `${manifest.budget.max} fetch calls used; budget exhausted — start a new mission to continue (no override in v0)`,
      )
    }
    if (hitsCost) {
      manifest = chargeBudget(root, missionId)
    }
    return buildHitReceipt(root, missionId, url, manifest, hit, now(), config.previewChars, config.sampleLinks)
  }

  // 4a. Allowlist (M5 5.2): only when config allowlist === 'on' (default off).
  //     Loaded once: the consent hook (5b) reuses it for consent-link egress.
  const allowlist = config.allowlist === 'on' ? loadAllowlist(root) : null
  if (allowlist) {
    checkAllowlist(url, allowlist)
  }
  //
  // 4b. Depth fence (M5 5.3, D-M5.7/D-M5.8, crawl boundary): max link-hops
  //     from the nearest seed (maxDepth) + max distinct non-seed hosts
  //     (maxDiscoveredHosts). Refusals: depth_exceeded / host_breadth_exceeded.
  //     `force` re-gates (the hit path above is the only skip).
  //     Per-mission fence (manifest.fence) wins over project/global config.
  const fenceKnobs = {
    maxDepth: manifest.fence?.maxDepth ?? config.maxDepth,
    maxDiscoveredHosts: manifest.fence?.maxDiscoveredHosts ?? config.maxDiscoveredHosts,
  }
  const fence = checkDepthFence(root, manifest, url, fenceKnobs)

  // 4b′. R4.4 host wiedervorlage — refuse spawn (zero budget) when host is
  //      cooled down, unless force:true lifts the cool-down for this attempt.
  const sessionHost = hostSessionKey(url)
  if (hostOnCooldown(manifest, sessionHost)) {
    if (force) {
      manifest = writeHostCooldowns(root, missionId, liftHostCooldown(manifest.host_cooldowns, sessionHost))
    } else {
      throw new StoreError(
        'host_cooldown',
        `${sessionHost} is on wiedervorlage after repeated non-retriable outcomes — pick another host, or force: true to lift once (0 budget charged)`,
      )
    }
  }
  //
  // 4c. C6 budget gate: a spawn attempt is always CHARGED. Exhausted → hard
  //     stop BEFORE the spawn (D-M5.2: no override; a new mission_start
  //     continues). Persist the charge BEFORE the spawn: a failed/timeout
  //     fetch still costs its call (it was a browser spawn).
  if (budgetExhausted(manifest.budget)) {
    throw new StoreError(
      'budget_exhausted',
      `${manifest.budget.max} fetch calls used; budget exhausted — write a conclusion and mission_stop (or start a new mission). Remaining=0.`,
    )
  }
  manifest = chargeBudget(root, missionId)

  // 5. fetch (timeout / spawn failures surface as FetchError fetch_failed / spawn_failed)
  let page = await fetcher.fetch(url, { sessionKey: hostSessionKey(url) })

  // 5b. M5 5.5 (C10, consent v0): thin + CMP marker → TACTICS in the same
  //     host session (the fetch above was already charged — consent adds
  //     batch invocations only, D-M5.5). A malformed profiles override
  //     fails loud here (consent_profiles_invalid), before anything is
  //     stored — config/allowlist discipline.
  let consentOutcome: ConsentOutcome | null = null
  if (isConsentWall(page) && config.consentMaxAttempts > 0 && typeof fetcher.consentAttempt === 'function') {
    const host = hostSessionKey(url)
    const profiles = loadConsentProfiles(root)
    const res = await runConsent(page, {
      host,
      url,
      labels: labelsForHost(profiles, host),
      // consent-link egress is allowlist-gated; the fence does not apply
      // (part of the fetch, not a crawl step).
      links: allowlist ? page.links.filter((l) => isAllowed(l.url, allowlist)) : page.links,
      thinThreshold: config.thinThresholdChars,
      maxAttempts: config.consentMaxAttempts,
      attempt: (label, linkUrl) =>
        fetcher.consentAttempt!(url, label, linkUrl, { sessionKey: host }),
    })
    page = res.page
    consentOutcome = res.outcome
  }

  // 6. ledger target (D-M3.2: one row per normalized URL per mission)
  //    - a row already exists for the FINAL key (redirect-collapse onto a
  //      stored page) → update it in place;
  //    - force on a hit whose final key moved → update the hit row in place;
  //    - otherwise a brand-new row.
  const finalKey = normalizeUrl(page.finalUrl)
  const target =
    manifest.fetched.find((r) => r.normalized_url === finalKey) ?? (force && hit ? hit : undefined)
  const sampleCap = Math.max(0, Math.floor(config.sampleLinks))
  const stored: StoredArtifact = storeArtifact(root, missionId, page, {
    chunkChars: args.chunkChars,
    previewChars: config.previewChars,
    ...(target ? { artifactId: target.artifact_id, replace: true } : {}),
    // M5 5.3: persist the fetch depth onto page.json (M4 find matches read it).
    depth: fence.depth,
  })

  // Merge the requested alias into the row's alias list (ordered, deduped) so
  // every redirecting URL that stores onto this row keeps hitting.
  const requestedKeys = [...new Set([...(target?.requested_keys ?? []), requestedKey])]
  const discoveryUrls =
    readDiscoverySurface(root, missionId)?.urls.map((u) => u.url) ?? []
  const url_source = classifyUrlSource(url, discoveryUrls, manifest.seeds)
  const row: FetchedRow = {
    normalized_url: finalKey,
    url: page.finalUrl,
    artifact_id: stored.artifactId,
    quality: page.quality,
    fetched_at: page.fetchedAt,
    // M6 6.1: the pane's thin-page hint needs attempted AND improved (the
    // receipt has both; the ledger row now carries both too).
    consent_attempted: page.consentAttempted,
    consent_improved: page.consentImproved,
    requested_keys: requestedKeys,
    // C6 audit: a ledger row is only ever written by a charged (non-cached)
    // attempt in v0 — the field makes that explicit.
    budget_charged: true,
    // M5 5.3 (depth fence): lineage at the moment of fetch — the min over
    // the ledger BEFORE this row was written (deterministic, D-M5.7).
    depth: fence.depth,
    parent_artifact_id: fence.parent_artifact_id,
    url_source,
  }
  const updated = target
    ? updateFetchedRow(root, missionId, target.normalized_url, row)
    : appendFetchedRow(root, missionId, row)

  // 6b. R4.4 — record non-retriable / successful-full against host cooldown map.
  const outcomeHost = (() => {
    try {
      return hostSessionKey(page.finalUrl)
    } catch {
      return sessionHost
    }
  })()
  const cooldownMap = recordHostOutcome(updated.host_cooldowns, outcomeHost, {
    nonRetriable: isNonRetriable(page.quality, page.qualitySignals),
    successfulFull: page.quality === 'full',
    K: Math.max(1, Math.floor(config.hostCooldownK)),
    M: Math.max(1, Math.floor(config.hostCooldownLiftAfterM)),
  })
  const withCooldown = writeHostCooldowns(root, missionId, cooldownMap)
  const hostCooled = withCooldown.host_cooldowns?.[outcomeHost]?.cooldown === true

  // 7. M3 soft gate (D-M3.3): same-host stored pages, excluding the row this
  //    fetch just wrote/updated (a first-ever page on the host gets no hint).
  const others = manifest.fetched.filter((r) => r !== target)
  const sameHost = others.filter((r) => {
    try {
      return hostSessionKey(r.url) === hostSessionKey(url)
    } catch {
      return false
    }
  }).length
  const hintFindFirst =
    sameHost >= 1
      ? `this host has ${sameHost} stored pages — consider ${hintTools('mission_find')} before fetching a new path`
      : undefined

  // 8. C4 receipt (fresh: cached:false, age_days:0; C6 budget after the charge)
  const budget = budgetView(withCooldown.budget)
  const wrap = budgetWrapHint(budget)
  let hint = honestyGate(
    consentOutcome?.attempted
      ? consentNextStepHint(page, consentOutcome)
      : nextStepHint(page.quality, page.qualitySignals),
    page.quality,
  )
  if (wrap) hint = `${hint} · ${wrap}`
  if (hostCooled) {
    hint = `${hint} · host ${outcomeHost} now on wiedervorlage (host_cooldown) — pick another host`
  }

  return {
    mission_id: missionId,
    artifact_id: stored.artifactId,
    url,
    final_url: page.finalUrl,
    cached: false,
    fetched_at: page.fetchedAt,
    age_days: 0,
    page_quality: page.quality,
    quality_signals: page.qualitySignals,
    consent_attempted: page.consentAttempted,
    consent_improved: page.consentImproved,
    chunk_count: stored.chunkCount,
    preview_head: stored.previewHead,
    // M5 5.3: live lineage from the depth fence (gate 4b, pre-spawn).
    depth: fence.depth,
    parent_artifact_id: fence.parent_artifact_id,
    budget,
    visited_count: withCooldown.fetched.length,
    next_step_hint: hint,
    sample_links: stored.links.slice(0, sampleCap).map((l) => l.url),
    url_source,
    ...(hintFindFirst ? { hint_find_first: hintFindFirst } : {}),
    ...(budget.remaining === 0 ? { budget_exhausted: true, wrap_up_hint: wrap } : {}),
    ...(hostCooled ? { host_cooldown: true } : {}),
  }
}

/** M3 cache-hit receipt: read the stored artifact, zero spawn. */
function buildHitReceipt(
  root: string,
  missionId: string,
  url: string,
  manifest: Manifest,
  hit: FetchedRow,
  nowMs: number,
  previewChars: number,
  sampleLinks: number,
): FetchReceipt {
  const stored = readArtifact(root, missionId, hit.artifact_id)
  const age = ageDays(hit.fetched_at, nowMs)
  const sampleCap = Math.max(0, Math.floor(sampleLinks))
  const budget = budgetView(manifest.budget)
  const wrap = budgetWrapHint(budget)
  return {
    mission_id: missionId,
    artifact_id: hit.artifact_id,
    url,
    final_url: hit.url,
    cached: true,
    fetched_at: hit.fetched_at,
    age_days: age,
    page_quality: stored.page.quality,
    quality_signals: stored.page.qualitySignals ?? [],
    consent_attempted: stored.page.consentAttempted ?? false,
    consent_improved: stored.page.consentImproved ?? false,
    chunk_count: stored.chunkCount,
    preview_head: (stored.page.content ?? '').slice(0, previewChars),
    // M5 5.3: the stored lineage (hits are not re-gated, D-M5.4). M2-era
    // rows predate the fields → 0/null (schema stability).
    depth: hit.depth ?? 0,
    parent_artifact_id: hit.parent_artifact_id ?? null,
    budget,
    visited_count: manifest.fetched.length,
    url_source: hit.url_source,
    next_step_hint: honestyGate(
      wrap
        ? `${cachedNextStepHint(stored.page.quality, age, stored.page.qualitySignals ?? [])} · ${wrap}`
        : cachedNextStepHint(stored.page.quality, age, stored.page.qualitySignals ?? []),
      stored.page.quality,
    ),
    sample_links: stored.links.slice(0, sampleCap).map((l) => l.url),
    ...(budget.remaining === 0 ? { budget_exhausted: true, wrap_up_hint: wrap } : {}),
  }
}

export { FetchError }
