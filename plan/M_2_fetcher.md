# M_2 — fetcher

Phase: **M2** · Status: not started (see `M_2_fetcher.status.md`)
Depends on: M1 (store + tools registered), M0 (build/boot loop).
External: `browser39` 1.7.1 on PATH or via `BROWSER39_BIN` (verified in ENV.md).

---

## Green

`mission_fetch` works end-to-end via the **Fetcher port** against real local
`browser39`: fetch → `FetchedPage` → store artifact (page.json + chunks +
links.json) → ledger row in `manifest.fetched[]` → **receipt (C4 base)** to the
model. Normalization (C2) is implemented and is the ledger key. First
`fetched_at` lands in the ledger. **Zero** fetch of a URL that fails
normalization. No cache-hit path yet (that is M3).

## Deep design

### Fetcher port (C3 — born here)

```ts
interface PageFetcher {
  fetch(url: string, opts?: {
    signal?: AbortSignal
    sessionKey?: string      // host key; v0 = lowercased hostname (no port)
  }): Promise<FetchedPage>
}
```

`FetchedPage` per **C3** (DESIGN). **No `selector` field** (S2: selection is a
query-time concern, lives on `mission_find`, M4). No options may influence the
stored canonical page — the cache key (URL-only) depends on it.

### Browser39Fetcher (v0 impl)

- **Binary law (S1 flipped, 2026-10-12):** `@aquintanar/browser39@2.0.0` is a
  plugin **dependency** (npm shim `bin.js` + platform binary via
  optional-deps). Resolution order:
  1. `BROWSER39_BIN` env (explicit override — escape hatch, e.g. cargo 1.7.1),
  2. `require.resolve('@aquintanar/browser39/package.json')` → dir → `bin.js`,
     spawned as `node <bin.js> …` (deterministic; no exec-bit/PATH dependence),
  3. `browser39` on `PATH` (global installs, legacy Eris box).
  Missing everywhere → `error: spawn_failed: browser39 not found (no
  BROWSER39_BIN, no node_modules binary, not on PATH)`.
- Subprocess per fetch, parse CLI JSONL/JSON stdout (Eris-proven pattern;
  do not re-invent the CLI surface — probe the 2.0.0 CLI at implementation
  and pin the exact subcommand/flags in the status log; contract stays
  version-agnostic).
- **Session dir (v0.1 of C7):** upstream persists cookies to
  `~/.local/share/browser39/session.enc` (encrypted, single shared file).
  If the 2.0.0 CLI/config exposes a per-invocation session dir (probe
  `docs/config.md` at implementation), pass the host-scoped dir per C7
  (`~/.dsh/browser39/sessions/<host>/`); otherwise document the shared-file
  reality here and keep C7's *wipe* semantics (Clear all deletes the file) —
  host-scoping then applies at the cookie level, not the dir level. The probe
  decides; the plan holds the requirement (consent persists across missions;
  Clear all resets it).
- **One spawn per non-cached fetch** (M3 asserts this; design for it now).
- Timeout: 30 s per spawn (hand config `fetchTimeoutMs`); on timeout →
  `fetch_failed` receipt, no ledger row, budget still decremented (attempted).
- Exit/parse failures → `fetch_failed` with the stderr tail (≤200 chars) in the
  error message. No stack traces to the model.

### Normalization (C2 — born here, law from M3)

Per C2 (DESIGN): WHATWG `URL`, lowercase scheme+host, drop default ports,
drop fragment, drop trailing slash, stable query sort (key then value), no
tracking-param dropping in v0. Output string = ledger key. Unparsable URL →
`error: normalize_failed` **before** any spawn.

### Artifact storage

On successful fetch (quality ≠ `blocked`-and-empty):

```
pages/{artifact_id}/
  page.json    = FetchedPage + { artifact_id, mission_id, normalized_url, stored_at }
  links.json   = FetchedPage.links (deduped by normalized url, first-seen text wins)
  chunks/NNN.md = content split at chunkChars (default 2000, hand config),
                  boundary = nearest newline within ±20% of the limit;
                  each chunk file: raw text only (find does the context)
```

- `artifact_id` = `p-<8 hex>`, new per stored page (M3: re-fetch under `force`
  reuses the id, overwrites files, new `fetched_at`).
- `blocked` pages (4xx/5xx, empty body): **stored as a ledger row with
  `quality: 'blocked'`** and a page.json containing status/signals but no
  chunks — so the model sees *why* a URL is dead, and M3's cache-hit returns
  the blocked receipt (fetching a 404 twice should not spawn twice either).
- Links stored absolute (resolved against finalUrl).

### Quality + consent flags (deterministic, per C3)

- `blocked`: HTTP 4xx/5xx or zero-content.
- `thin`: text length < 300 chars (`thinThresholdChars`, hand config) **or**
  CMP markers (v0 marker list: "cookie", "consent", "datenschutz", "akzeptieren",
  "accept all", "alle akzeptieren" in title + first ~500 chars; list is a
  named constant in code, amended here when it misbehaves).
- `full`: otherwise.
- `consent_attempted` / `consent_improved`: **false/false in M2** (the retry
  logic is M5); fields exist in the receipt now so the schema never changes
  under the model's feet.
- `depth` / `parent_artifact_id`: **`0` / `null` in M2** (the fence that
  fills them is M5); same schema-stability rule. M2's `links.json` is the
  lineage data the fence later walks — no shape change needed (url + text,
  deduped by normalized url).

### `mission_fetch` (C5 — born here)

```
mission_fetch({ url, mission_id?, force? })
```

1. Resolve mission (default rule D-M1.4; error `no_mission` if none).
2. Normalize → ledger lookup (lookup code lands in M3; in M2 the lookup always
   misses, but the **code path exists and is correct** — M3 only flips the
   behavior on).
3. Spawn fetch → store artifact → append ledger row → receipt.
4. Receipt = **C4 base**: `cached: false`, `age_days: 0`, quality fields,
   `chunk_count`, `preview_head` (first ~300 chars of stored text),
   `next_step_hint`, `sample_links` (≤5), `depth: 0` /
   `parent_artifact_id: null`. Budget block + real depth values appear in
   M5; until then schema additive, not changing.

### Config (hand-set, in ENV.md / code default)

`chunkChars: 2000`, `fetchTimeoutMs: 30000`, `thinThresholdChars: 300`.
No UI surface for these until M6+.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | `mission_fetch` on a known-good URL (e.g. a fixture page, plain HTML) | receipt `ok`, `cached: false`, `page_quality: 'full'`, `chunk_count ≥ 1`; page.json + chunks + links.json on disk; ledger row present |
| V2 | fetch a 404 URL | receipt `page_quality: 'blocked'`, no chunks, ledger row with quality `blocked` |
| V3 | fetch an unparsable URL | `error: normalize_failed`, **no** browser39 spawn (assert via spawn counter/log) |
| V4 | two fetches of the same URL (M2: no cache yet) | two ledger rows, two artifacts — *expected until M3*; V4 exists to have the pre-state for the M3 diff |
| V5 | `browser39` killed / `BROWSER39_BIN` pointed at a dead path | `error: spawn_failed`, no crash, mission stays usable |
| V6 | redirect chain (http→https, www→bare) | `final_url` recorded; **ledger key = normalized final URL**, so a direct fetch of the final URL and the redirected one share a key (assert both normalize equal) |

## Scope guard

- **No cache-hit receipt** (M3), **no budget decrement** (M5), **no consent
  retry** (M5), **no find** (M4), **no allowlist** (M5).
- No HTTP fallback fetcher (optional later, not v0).
- No `selector`, no query-time options on fetch (S2 closed).
- No npm browser39 dependency in `package.json` — subprocess + `BROWSER39_BIN`.
- Commit after green: `m2: fetcher port + Browser39Fetcher + mission_fetch receipts`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M2.1 | Blocked pages | stored as ledger + page.json (no chunks) — dead URLs are known, not guessed |
| D-M2.2 | Ledger key | normalized **final** URL (post-redirect) |
| D-M2.3 | Timeout | 30 s/spawn, `fetch_failed`, budget counts it (M5) |
| D-M2.4 | Chunk boundary | nearest newline within ±20% of `chunkChars` |
| D-M2.5 | v0 marker list | constant in code, named `CMP_MARKERS`, amended in this file when misfiring |

## Seam consumption

- **S1** — **flipped 2026-10-12 (operator):** npm `@aquintanar/browser39@2.0.0`
  is the plugin dependency (platform binary via optional-deps); `BROWSER39_BIN`
  stays the override; contract version-agnostic; cargo 1.7.1 demoted to
  box-local (Eris).
- **S2** — `selector` removed from the port; selection deferred to M4.
- **C2/C3** — born here, frozen at M2 green (hoisted to DESIGN as `seed`→`frozen`).
