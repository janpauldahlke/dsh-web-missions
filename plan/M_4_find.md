# M_4 — find

Phase: **M4** · Status: not started (see `M_4_find.status.md`)
Depends on: M2 (chunks + links on disk), M3 (so find is the *point* — pages
  are cached and must be queried, not re-fetched).

---

## Green

`mission_find` — **lexical** search over a mission's stored chunks **and**
links — returns snippets + `best_match_url`. The skill `web-mission-workflow`
+ one thin template exist and the model-facing ritual is complete: start →
fetch (cached or fresh) → find → synthesize to `mission.md` with
`artifact_id` citations. **No ranking model, no embeddings, no cloud.**

## Deep design

### `mission_find` (C5 — born here)

```
mission_find({ query, mission_id?, limit?, url_only? })
```

- Scope: the resolved mission's `pages/*/chunks/*.md` + `pages/*/links.json`.
- **Lexical scoring (deterministic):**
  1. Tokenize: lowercase, split on non-alphanumerics, drop tokens < 3 chars
     (German plurals survive; v0 has no stemming — documented).
  2. Term frequency per chunk: `score = Σ (tf_t × w_t)`, `w_t = 1 +
     log10(chunkCount / chunksContaining(t))` (IDF-lite, no precomputed
     index — missions are small: tens of chunks, not millions).
  3. Chunks with score 0 are dropped; ties broken by `fetched_at` (newer
     first) then chunk order.
  4. `limit` default 5, max 20.
- Result:

```jsonc
{
  "mission_id": "…",
  "query": "…",
  "matches": [
    { "artifact_id": "p-…", "url": "…", "chunk": 3, "score": 2.41,
      "depth": 1,          // hops from nearest seed (receipt field; 0 = seed page)
      "snippet": "…±snippetWindow chars around the best hit, ellipsized…" }
  ],
  "best_match_url": "…",        // top match's URL, null if no matches
  "link_matches": [ { "url": "…", "text": "…", "score": … } ],  // links whose text matches, ≤5
  "hint": "no matches: stored pages may not cover this — consider mission_fetch"  // only when empty
}
```

- `url_only: true` → returns only `{ best_match_url, link_matches }` (cheap
  "which page talks about X" mode).
- Empty query / all tokens filtered → `error: empty_query`.
- Performance bound: v0 scans in-memory per call (mission-sized); if a mission
  ever exceeds ~2000 chunks, that is an amend-this-file moment, not a v0 worry.

### Snippet rule

Best hit position = first occurrence of the highest-weighted token; window
±`snippetWindow` chars (**config**, default 120 — knob table in
M_5_ledger.md; operator-sized to taste, no code change), clipped at line
boundaries; single-space collapse; `…` at clipped ends. Deterministic — same
stored page + query + config = same snippet.

### Retrieval seam (C8 — born here)

Operator note (2026-10-12): encapsulate retrieval from day one. The scorer
sits behind the C8 port (`RetrievalEngine.search`); v0 implements
`LexicalEngine` (tf × IDF-lite). Embeddings — or a lexical+embedding mix —
are future engine implementations, not a refactor: the C5 signature and the
result shape above stay stable across engine swaps. No embedding work in v0;
the weld point is named now so it stays a seam.

### Skill `web-mission-workflow` (D5: ritual + templates, not a second tool)

Registered as a DSH skill (out-of-tree skill file in the package, loaded like
the harness skills). Content = the ritual, short:

1. **Start** the mission (`mission_start`) with a note naming the goal.
2. **Fetch** each source URL once (`mission_fetch`). Watch `page_quality` —
   never claim you read a `thin`/`blocked` page (honesty contract).
3. **Find** over what's stored (`mission_find`) before fetching a new same-host
   path (the soft gate, M3, makes this a habit).
4. **Synthesize** into `mission.md`: findings + a Sources list citing
   `artifact_id` + URL per claim.
5. **Stop** (`mission_stop`) with the reason; the outcome is the model's
   writing, the host only recorded the receipts.

Template (thin asset, one): **`kurzprofil`** — per-entity block
(Name / HQ / short description / key numbers as found / sources
`[p-…](url)`). The template is *scaffolding for the model's text*, not host
logic (anti-creep, PLAN §11: outcomes are the model's).

### Receipts

No receipt schema change. `mission_find` results are tool results, not
fetch receipts.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | store 3 pages (one about a named bank, two unrelated) → `mission_find` for the bank's name | top match = the bank page, snippet contains the name, `best_match_url` = that page |
| V2 | query with zero overlap | `matches: []`, `best_match_url: null`, hint present |
| V3 | same query, same mission, twice | byte-identical results (determinism) |
| V4 | `url_only: true` | only `best_match_url` + `link_matches` |
| V5 | links whose text matches (e.g. a link labeled "Konditionen") | appears in `link_matches` |
| V6 | skill + template present | skill listed/available in the profile; `kurzprofil` template resolvable by the model (named check, not vibe) |
| V7 | 500-chunk synthetic mission, `mission_find` | < 1 s end-to-end (hand-timed is fine; recorded) |

## Scope guard

- **No embeddings, no fuzzy/phonetic matching, no stemming** (v0 lexical;
  amend here if the M8 smoke proves it hurts).
- Retrieval encapsulated behind the **C8 port** (operator note 2026-10-12):
  embeddings / lexical+embedding mix are future engines, not a refactor.
  No embedding work in v0.
- No new fetch behavior; find never fetches.
- No second search tool, no SERP (D5, D4 — discovery is M7).
- No pane UI for find results (M6 shows visited/budget; find results go to
  the model in-chat).
- Commit after green: `m4: mission_find (lexical) + web-mission-workflow skill + kurzprofil template`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M4.1 | Scoring | tf × IDF-lite, no precomputed index (mission-sized data) |
| D-M4.2 | Min token length | 3 (no stemming in v0) |
| D-M4.3 | Snippet window | ±`snippetWindow` chars (config, default 120), line-boundary clipped |
| D-M4.4 | Limit | default 5, max 20 |
| D-M4.5 | v0 template | one only: `kurzprofil` |

## Seam consumption

- **S2** — selection semantics live here, not on the fetcher (closed).
- **C5** — `mission_find` signature hoisted to DESIGN.
- **Honesty contract** — the skill states the `thin`/`blocked` rule; the
  receipts (M5 gate) enforce it.
