# M_3 — cache

Phase: **M3** · Status: not started (see `M_3_cache.status.md`)
Depends on: M2 (fetcher, normalization, ledger writes).

---

## Green

**The heart of the project (D11).** `mission_fetch` on an already-stored
normalized URL returns an **immediate cache-hit receipt**: `cached: true`,
**same `artifact_id`**, zero browser39 batch invocation, zero budget decrement (budget
field absent until M5 — the *behavior* is free). Receipt carries `age_days`
(S4). The M8 proof assertion is implementable against this phase.

## Deep design

### Hit path (Host law — deterministic, not skill advice)

`mission_fetch` step 2 (M2's lookup) becomes:

1. Normalize URL (C2). Lookup in `manifest.fetched[]` by `normalized_url`.
2. **Hit** → no spawn. Return receipt:
   - `cached: true`, `artifact_id` = the stored one,
   - `fetched_at` + `age_days` (S4: `(now - fetched_at) / 86400000`, 2 decimals),
   - `page_quality` = stored quality, `chunk_count` = stored,
   - `preview_head` = first ~300 chars of stored text (read from disk, cheap),
   - `next_step_hint`:
     - `full` → `"cached: already stored (age Xd). Use mission_find, or pass force: true to re-fetch."`
     - `thin`/`blocked` → `"cached: stored as <quality> (age Xd). Re-fetch with force: true if you expect new content."`
   - `sample_links` from stored `links.json` (≤5).
3. **Miss** → M2 path unchanged.
4. `force: true` on a hit → re-fetch, **reuse `artifact_id`**, overwrite
   page.json/chunks/links.json, update the ledger row in place (same
   normalized_url, new `fetched_at`, new quality), receipt `cached: false`.
   The ledger stays one row per normalized URL per mission.

### Age (S4 resolution)

- `fetched_at` already exists in the ledger (M2). The receipt surfaces
  `fetched_at` + `age_days` on **both** hit and fresh receipts (fresh = 0).
  A long-lived mission (D8) therefore sees staleness in the receipt instead of
  silently synthesizing on stale pages. `force: true` stays the escape hatch.
  No automatic expiry in v0 — staleness is *information*, not a gate.

### Find-before-refetch soft gate (D11 rule 4, Eris-like)

- When a fetch **misses** but the mission already has ≥1 stored page on the
  **same host** (any path), the receipt adds
  `hint_find_first: "this host has N stored pages — consider mission_find before fetching a new path"`.
  It is a **soft** gate: the fetch proceeds (no refusal), the text points at
  `mission_find` (M4). No config knob; deterministic.

### Receipt additions (C4 — extended here)

`age_days` present on all receipts; `hint_find_first` present on same-host
misses. Nothing else changes.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | fetch URL A (miss) → fetch URL A again | second receipt: `cached: true`, same `artifact_id`, **batch counter +0 on the second** (assert exactly one batch invocation for both fetches) |
| V2 | fetch A (miss), fetch same host different path B (miss), fetch A again | V1 holds; B's first receipt carries `hint_find_first` |
| V3 | `force: true` on stored URL | new spawn, **same** `artifact_id`, ledger row updated in place (row count unchanged), receipt `cached: false`, `age_days: 0` |
| V4 | `age_days` arithmetic | stored page, sleep/wrap `fetched_at` -25h → receipt `age_days ≈ 1.04` (test with injected clock) |
| V5 | blocked URL re-fetch (no force) | `cached: true` with `page_quality: 'blocked'`, zero batch invocation |
| V6 | redirect-equivalent URL (the one that redirected to A, fetched directly) | cache hit (same normalized final-URL key as M2 V6) |

**The V1 assertion is the seed of the M8 DoD proof** — keep it as a named
script `scripts/accept-cache.mjs` (curl + **batch-invocation** counter check —
count `browser39 batch` spawns via a wrapper/log, not OS process scans) so M8
reuses it, not reinvents it.

## Scope guard

- **No budget decrement semantics** (M5 — cache-hit-freedom is defined there,
  asserted here only as "no spawn").
- **No expiry/refresh policy** (information, not gate — v0).
- No `mission_find` changes (M4); `hint_find_first` is text-only until the
  tool exists (the hint wording already references it by name).
- Commit after green: `m3: cache-hit path — visited URLs are Host law (zero-spawn re-fetch)`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M3.1 | Staleness | surfaced, not gated (no auto-expiry in v0) |
| D-M3.2 | force semantics | overwrite in place, same artifact_id, one ledger row per normalized URL |
| D-M3.3 | Soft gate trigger | ≥1 stored page on same host (any path) |
| D-M3.4 | Accept script | `scripts/accept-cache.mjs` from M3, reused by M8 |

## Seam consumption

- **S4** — resolved: `age_days` on every receipt; `force` stays the hatch.
- **D11** — rules 1–5 all live from this phase (rule 4 soft, rule 5 force).
- **C2/C4** — frozen at M3 green (hoisted `frozen`).
