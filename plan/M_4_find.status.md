# M_4 find — phase status

Phase state: **in-progress** · Updated: 2026-10-13 · Last slice: 4.1

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 4.1 | `LexicalEngine` behind the C8 port (tf × IDF-lite over chunks) | done | `scripts/smoke-find.mjs` (41 checks): tokenize rules (unicode, min-3, minLen knob), empty_query FindError, exact scores on fixed 6-chunk corpus (10.41 / 2.6), zero-overlap empty result, byte-identical determinism, limit default/clamp (5/1/20/0.5), tie-breaks (fetched_at newer first → equal 2.95), depth from page.json (0 default / 2 M5-style), corrupt-dir skip, `urlOnly` passthrough; `npm run build` (tsc) clean; fetch smokes re-run green |
| 4.2 | link_matches + snippet rule + url_only | todo | — |
| 4.3 | mission_find tool + result shape | todo | — |
| 4.4 | skill web-mission-workflow + kurzprofil template | todo | — |
| 4.5 | run V1–V7 (M_4_find.md) | todo | — |

## Log (append-only)

- 2026-10-12 phase file frozen. S2 closed (selection lives here). Sub-decisions D-M4.1–D-M4.5.
- 2026-10-12 review #2: retrieval encapsulation (operator) — named port **C8** in DESIGN (`RetrievalEngine`; v0 = `LexicalEngine`); M4 gains deep-design section + scope-guard pointer; slice 4.1 builds behind the port; no v0 embedding work; open question flagged: search-time vs store-time vectors for a future mix.
- 2026-10-13 slice 4.1 done: `src/host/retrieval.ts` — C8 port (`RetrievalEngine`, `MissionScope`, `RetrievalResult/Options`, `FindError`) + `LexicalEngine` (tf × IDF-lite, `1 + log10(N/df)`; chunk corpus + link corpus; snippet rule D-M4.3; limit clamp D-M4.4; unicode tokenize, min 3, D-M4.2; ties fetched_at↓ → artifact_id↑ → chunk↑; scores 2-decimal display, raw-score ordering; corrupt-dir skip; `depth?: number` added to `StoredPageRecord` for M5). `urlOnly` consumed at the C5 tool layer (4.3) — engine result shape stays engine-stable per DESIGN C8. `scripts/smoke-find.mjs` (41 checks) green; regression smokes green.
