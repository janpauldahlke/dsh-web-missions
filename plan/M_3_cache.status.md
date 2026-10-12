# M_3 cache — phase status

Phase state: **GREEN** · Updated: 2026-10-13 · Last slice: 3.6

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 3.1 | ledger lookup by normalized_url (hit path) | done | `findLedgerRow` (row key OR requested_keys alias) — smoke "M3: hit zero spawn" + "hit adds no row"; accept V1 "exactly one batch invocation for both fetches" |
| 3.2 | cache-hit receipt (same artifact_id, age_days, zero spawn) | done | smoke "M3: hit cached:true, same artifact, age 0"; accept V1 (cached:true, same id, age_days 0, hint wording, 1 row); ageDays 25h→1.04 + floor at 0 (smoke) |
| 3.3 | force:true overwrite-in-place (same artifact_id) | done | smoke "force fresh receipt, same artifact" + "force row refreshed, alias kept" + "kept one row"; accept V3 (fresh receipt, same id, 1 new batch, row count unchanged, fetched_at refreshed) |
| 3.4 | find-before-refetch soft gate (same-host hint) | done | smoke "hint_find_first on same-host miss" (+ first fresh had no hint); accept V2 (B's first receipt carries exact hint text, fetch proceeds) |
| 3.5 | scripts/accept-cache.mjs (spawn-counter proof) | done | `scripts/accept-cache.mjs` — built-lib in-process tools + counting BROWSER39_BIN wrapper + live :3090 cross-check; M8 reuses (D-M3.4) |
| 3.6 | run V1–V6 (M_3_cache.md) | done | "M3 ACCEPTANCE: all checks passed" (35/35: V1–V6 + 4 live checks); smoke-fetch-service 48/48 (harness A + B); accept-m2 32/32 (V4/V5 assertions evolved to M3 semantics, still green) |

## Log (append-only)

- 2026-10-12 phase file frozen. S4 resolved. D11 rules live from here. Sub-decisions D-M3.1–D-M3.4.
- 2026-10-13 M3 GREEN. Hit path (zero-spawn, same artifact, age_days on all receipts, cached hint wording per plan), force overwrite-in-place (storeArtifact replace, updateFetchedRow, requested_keys merge), hint_find_first soft gate (same host, ≥1, excludes own row, text-only). V6 (redirect-equivalent re-fetch → hit) via `requested_keys` alias — D-M3.2 one-row-per-normalized-URL preserved. :3090 restarted onto M3 build (pid 282237); sacred :3080/:8080 untouched. Commit: `m3: cache-hit path — visited URLs are Host law (zero-spawn re-fetch)`.
