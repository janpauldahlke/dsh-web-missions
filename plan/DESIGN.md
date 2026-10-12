# DESIGN — contract ledger (cross-cutting only)

Status: **seed 2026-10-12** (lifted from PLAN.md intent + seam resolutions S1–S8).
This file is **not** the home of detail. Rule:

> A contract (interface, data shape, algorithm, layout) is defined **where it is
> born** — in that phase's `M_<n>_<name>.md`. It is **hoisted here the moment a
> second phase consumes it**. Until then it stays in the birth file. This file
> accretes; it does not front-load.

Every entry below carries: **born** (phase), **consumed by**, and status
(`seed` = lifted from PLAN.md intent, not yet nailed by a phase; `frozen` = a
phase has implemented it and Verify passed).

| # | Contract | Born | Consumed by | Status |
| --- | --- | --- | --- | --- |
| C1 | Mission store layout | M1 | M1–M8, pane, vault | seed |
| C2 | URL normalization | M2 | M2–M5 (cache key = law) | seed |
| C3 | `PageFetcher` port + `FetchedPage` | M2 | M2, M3, M7 | seed |
| C4 | Receipt schema | M2 | M3, M5, M6, M8 | seed |
| C5 | `mission_*` tool signatures | M1–M4 (per tool) | skill, pane, M8 | accreting |
| C6 | Budget unit | M5 | M5, M6, M8 | seed (S5) |
| C7 | Session/consent layout | M5 | M5, M6, M8 | seed (S3) |
| C8 | Retrieval seam (engine port) | M4 (v0 = lexical) | post-v0 embeddings / hybrid | seed |
| C9 | Package & publish form (sibling form-speak) | M0 (scaffold), frozen M9 | M0, M9, dsh.pub | seed |

---

## C1 — Mission store layout

Born: M1 · Layout frozen at M1 green.

```text
<cwd>/.dsh/web-missions/          # project-scoped (D6) — cwd of the acceptance server = this repo
  index.json                      # recents: [{mission_id, note, template_id?, status, started_at, updated_at}]
  {mission_id}/
    manifest.json                 # note, template_id?, budget, status, created/updated, fetched[] (visited ledger)
    mission.md                    # model-written outcome (Kurzprofile, digests) — Host never formats it
    pages/{artifact_id}/
      page.json                   # canonical page record (see C3 FetchedPage + storage fields)
      chunks/*.md                 # chunkChars split, hand config (D10)
      links.json                  # extracted links: [{url, text, artifact_id?}]
```

- `manifest.json.fetched[]` is the **visited ledger** (D11):
  `[{normalized_url, url, artifact_id, quality, fetched_at, consent_improved?}]`.
- `artifact_id` = `p-<8 hex>` (stable per stored page; a cache hit reuses it).
- `mission_id` = `m-<8 hex>`, created by `mission_start`.
- Sessions do **not** live here (S3): host-scoped sessions are under
  `~/.dsh/browser39/sessions/<host>/` (C7). PLAN.md §13's `_sessions/` row is
  amended by this entry.
- Recents = `index.json` until Clear (D7). `Clear recents` empties the list;
  `Clear all` deletes mission dirs + index + (M6 pane action) host session dirs.

## C2 — URL normalization

Born: M2 (first ledger write) · **the cache key — treat as law, not style.**

v0 algorithm (deterministic; exact code lands in M2):

1. Parse with WHATWG `URL`; unparsable → fetch rejected (receipt `error`), never stored.
2. Lowercase scheme + host.
3. Drop default ports (`:80` http, `:443` https); keep non-default.
4. Drop fragment entirely.
5. Drop trailing slash on path (root path becomes empty).
6. Query: keep params, **stable-sort by key then value** (insertion order is not law).
   v0 does **not** drop tracking params (`utm_*`, session ids) — documented
   non-goal; a `?utm_source=x` variant is a different key. If that proves
   painful in the M8 smoke, amend here with a dated note.
7. Keep userinfo, keep protocol-relative resolution already applied by `URL`.

Result: the normalized string is the ledger key. `force: true` bypasses the
lookup but still writes/overwrites under the same key (re-fetch replaces the
artifact; same `artifact_id`, new `fetched_at`).

## C3 — `PageFetcher` port + `FetchedPage`

Born: M2 · **`selector` is NOT on this port (S2).** Fetch stores the *canonical
page*; selection is a query-time concern and lives on `mission_find`.

```ts
interface PageFetcher {
  fetch(url: string, opts?: {
    signal?: AbortSignal
    sessionKey?: string      // host key (see C7) — v0 = hostname, no port
  }): Promise<FetchedPage>
}

interface FetchedPage {
  url: string               // as requested
  finalUrl: string          // after redirects
  status: number
  contentType: string
  title: string
  content: string           // main text/markdown (browser39 output)
  links: { url: string; text: string }[]
  byteLength: number
  fetchedAt: string         // ISO 8601 UTC
  quality: 'full' | 'thin' | 'blocked'   // deterministic, see below
  qualitySignals: string[]  // why (e.g. "text<300chars", "cmp-marker", "http-403")
  consentAttempted: boolean
  consentImproved: boolean
}
```

- v0 impl: `Browser39Fetcher` — subprocess, CLI JSONL (Eris-proven pattern).
  **Binary (S1 flipped 2026-10-12, operator decision):** the npm package
  `@aquintanar/browser39@2.0.0` is a plugin **dependency** — the platform
  binary ships via its optional-deps and is resolved from the plugin's own
  `node_modules` (`require.resolve` → `bin.js`, spawned via node).
  `BROWSER39_BIN` stays the override; `PATH` is the legacy fallback. Contract
  is version-agnostic. Spawn budget: **one spawn per non-cached fetch** — the
  M3 proof asserts on this.
- HTTP fallback for trivial static pages: optional later, not in v0 scope.
- `quality` is set by **our** deterministic code on the fetch output (S7
  resolution): `blocked` on HTTP 4xx/5xx or empty body; `thin` on
  `text_length < thinThresholdChars` (default 300, hand config) or CMP markers;
  `full` otherwise. browser39 may *contribute* signals (error strings,
  redirect chain) but the label is ours. Receipt honesty contract: the model
  must not claim it "read" a page labeled `thin`/`blocked` (M5 gates this).
- Consent (M5): if the first fetch is `thin`+CMP, one accept-click retry is
  attempted (shared DE/EN label asset); `consent_attempted`/`consent_improved`
  record the outcome. Cookie preload escape hatch: documented path + pane hint.

## C4 — Receipt schema

Born: M2 (base) · M3 adds `age`/`ageDays` (S4) · M5 adds budget + consent.

```jsonc
{
  "mission_id": "m-…",
  "artifact_id": "p-…",          // same id on cache hit
  "url": "…", "final_url": "…",
  "cached": false,               // true = ledger hit, zero browser spawn
  "fetched_at": "…", "age_days": 0.0,   // S4: long-lived missions see staleness
  "page_quality": "full",        // full | thin | blocked
  "quality_signals": [],
  "consent_attempted": false, "consent_improved": false,   // M5
  "chunk_count": 12,
  "preview_head": "first ~300 chars of stored text",
  "budget": { "remaining": 9, "max": 10, "unit": "fetch_calls" },  // M5 (S5)
  "depth": 0, "parent_artifact_id": null,   // M5 depth fence (0/null in M2)
  "visited_count": 5,
  "next_step_hint": "…",         // deterministic, e.g. "cached — use mission_find"
  "sample_links": ["…"]          // ≤5
}
```

Error shape (fetch failed / rejected): same envelope, `ok: false`,
`error: <class>: <message>` — error classes: `fetch_failed`, `allowlist_denied`,
`budget_exhausted`, `normalize_failed`, `spawn_failed`, `depth_exceeded`,
`host_breadth_exceeded` (M5 depth fence — refused pre-spawn, zero cost). The
model sees the class, not a stack trace.

## C5 — `mission_*` tool signatures (accreting)

Each tool is born in its phase file; signatures are copied here once stable.

```ts
// M1
mission_start({ note, template_id?, budget? })            // → { mission_id }
mission_list()                                            // → active + recents
mission_status({ mission_id? })                           // → manifest + visited list + budget
// M2
mission_fetch({ url, mission_id?, force? })               // → receipt (C4)
// M4
mission_find({ query, mission_id?, limit?, url_only? })   // → snippets + best_match_url
// M1/M2
mission_stop({ mission_id?, reason? })                    // → { mission_id, status }
```

**Do not** register anything named `web_fetch` / `web_search` (PLAN §6).
Discovery stays out of the model-facing surface until M7.

## C6 — Budget unit (S5 resolution)

Born: M5.

- **Budget = fetch calls** (non-cached, successful-or-attempted browser
  fetches). Cache hits are **free** (`cacheHitCountsAsBudget: false`, default).
- Set at `mission_start` (default `defaultFetchBudget`, hand config),
  decremented per non-cached fetch attempt, exposed in every receipt +
  `mission_status`. Exhausted → `error: budget_exhausted`, no spawn.
- One line, no unit ambiguity: the overnight/implementer agent must never
  guess what a budget unit is.

## C7 — Session/consent layout (S3 resolution)

Born: M5.

- **Consent is a host property; the mission store is a project property.**
  Host-scoped session dirs: `~/.dsh/browser39/sessions/<host>/` — shared
  across missions *and* projects, so consent survives into every new mission.
  (Mission-scoped sessions would re-hit the same CMP wall per mission — the
  re-fetch loop wearing a cookie hat.)
- Mission store stays `<cwd>/.dsh/web-missions/` (C1).
- `Clear all` (pane, M6) wipes mission dirs + index **and** the host session
  dirs (operator escape hatch for "start clean").
- `persistSessions` on by default for real fetches (PLAN §10).
- v0.1 stretch (post-M5, only if the M8 smoke hurts): shared consent label
  asset (DE/EN) + `mission_session_status` pane card. Not on the ship bar.
- Cookie preload: documented path (operator drops cookies into the host dir),
  pane hint "session thin — export cookies".

## C8 — Retrieval seam (engine abstraction; born M4, v0 = lexical)

Born: M4 (v0 engine + port) · Consumed by: post-v0 embeddings / hybrid
(unnumbered phase — amend, don't rebuild).

The scorer is an **implementation**, not the architecture. Named port:

```ts
RetrievalEngine
  search( scope: MissionScope, query: string,
          opts: { limit?, urlOnly? } )
    → { matches: [{ artifact_id, url, chunk, score, depth, snippet }],
        best_match_url: string | null,
        link_matches: [{ url, text, score }] }
```

- **v0 implementation: `LexicalEngine`** (tf × IDF-lite, D-M4.1).
  Deterministic; config-driven (`snippetWindow`, min token length, limit).
- **Future (operator note 2026-10-12):** an embeddings engine and/or a
  lexical+embedding **mix** plugs in here. `mission_find`'s signature (C5)
  and result shape (M4) stay unchanged across engine swaps. The engine
  selection knob arrives **with** the first non-lexical engine — not before
  (boring v0).
- **Engine-agnostic (outside the seam):** mission store (C1), budget /
  allowlist / depth fence (M5), tool registration (C5).
- **Open at implementation:** *when* are vectors computed — search-time
  scoring (zero storage change) or store-time vectors (C1 artifact layout
  gains its own seam in M2/M3)? A mix leans store-time; decide in the
  embeddings phase and amend C1 deliberately, not by surprise.

## C9 — Package & publish form (sibling form-speak)

Born: review #3 (2026-10-12, operator: "design MUST match the other
siblings in form-speak") · Frozen at M9 green · Consumed by: M0 (scaffold
shape), M9 (publish).

Law: the package form is **identical in shape** to the five published
siblings (atlas: `skills/dsh-out-of-tree-plugin/SIBLINGS.md`); only name /
description / domain keywords / deps differ. Exemplar of record:
`dsh-memento`.

| Aspect | Form (sibling law) |
| --- | --- |
| `name` | npm `dsh-local-web-missions` · repo `dsh-web-missions` (memento precedent) |
| `version` | **1.0.0** at publish (all siblings 1.0.x; no 0.x public) |
| `description` | one sentence: what + "for DeepSeek Harness …" + negative scope — "Persist-and-find web research for DeepSeek Harness local agents (browser39 fetch, mission store, lexical find, budget + allowlist + depth fence). No cloud search in v0." |
| `files` | `["lib", "cordis.patch.yml", "README.md", "LICENSE", "media"]` |
| `scripts` | `build` (`node build.mjs && tsc --noEmit`) + sibling `prepare` fallback (build or warn, rely on prebuilt `lib/`) + `test` |
| `repository` / `homepage` / `bugs` | `janpauldahlke/dsh-web-missions` triple |
| `keywords` | base block `dsh-plugin, deepseek-harness, deepseek-harness-plugin, dsh, cordis, cordis-plugin` + domain block (D-M9.4) + tail `sidebar, web-ui` |
| `devDependencies` | `@types/node`, `@types/react` (pinned to installed web shell), `esbuild`, `typescript` + `tsconfig.json` at root |
| `dependencies` | `@aquintanar/browser39` 2.0.0 — the only runtime dep |
| `LICENSE` | MIT, header `Copyright (c) 2026 Jan (HagbardCeline) / janpauldahlke` |
| `lib/` | **tracked** (siblings track it; `prepare` falls back to prebuilt lib) |
| `media/` | pane screenshots, committed, in files[] (M6 pane shots, added M9) |
| README | hook → npm-name note → **related-plugins table (all five siblings)** → npm+source links → "Verified against DSH 0.2.1-alpha.2" → Requirements → Screenshots → Install / Usage / Privacy |
| cordis.patch.yml | 3-line comment header (layer / host half / client half) + single `insert` row (short `id`, `name` ≡ package name) |
| gitignore | `ENV.md`, `.env` / `.env.*` / `*.key`, `node_modules/`, `dist/`, `*.log`, `.DS_Store`, `**/.dsh-session`, `.dsh/`, `STATUS.md` (generated here — memento's is hand-written, documented divergence) |
| documented divergences | `plan/` + `skills/` tracked here as design record (memento gitignores them); `files[]` keeps both out of the tarball |
