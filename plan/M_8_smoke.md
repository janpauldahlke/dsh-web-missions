# M_8 — smoke (`aggregiere PartnerDaten`)

Phase: **M8** · Status: not started (see `M_8_smoke.status.md`)
Depends on: M0–M5 green (ship bar), fixtures (open item 1 — frozen here).
M6/M7 not required (pane is optional for the smoke; discovery is fixtures-only).

---

## Green

**DoD smoke (PLAN §12):** `aggregiere PartnerDaten` over the frozen fixture
set, run by the model in a normal mission, end-to-end on `:3090`:

- **S1 Kurzprofil** — multi-fetch + find + **no refetch loops**; the model
  synthesizes Kurzprofile to `mission.md` with `artifact_id` citations.
  **The plugin does not implement ratings — the model does.**
- **Proof assertion:** S1 end-to-end **plus** a second `mission_fetch` of the
  same URL asserts `cached: true` with **no second browser spawn**
  (`scripts/accept-cache.mjs`, built in M3, run here as the formal DoD check).
- **S2 news dig** (secondary): depth + citations, same mission or a second
  one — model-owned outcome.
- **S3 chart snapshot** (secondary): a stored artifact that is a chart/image
  page — fixture OK, no chart parsing (non-goal, PLAN §15).

## Deep design

### Fixture set (open item 1 — frozen here)

`fixtures/partner-daten.json` — **10 entities, German market, bank + insurer
mix**, each with 1–2 URLs that a Kurzprofil plausibly needs (home +
impressum/konditionen/news). Candidate list (finalize at implementation —
URLs must be live + allowlist-able; the *set* below is the frozen intent):

| # | Entity | Type | URLs (intent) |
| --- | --- | --- | --- |
| 1 | Sparda-Bank Berlin | bank | sparda-berlin.de (home, privatkunden) |
| 2 | DKB | bank | dkb.de (home, konditionen) |
| 3 | ING-DiBa | bank | ing-diba.de (home, zinsen) |
| 4 | comdirect | bank | comdirect.de (home, konto) |
| 5 | Sparkasse (fz. Berlin) | bank | sparkasse.de / sparkasse-berlin (home) |
| 6 | Allianz | insurer | allianz.de (home, private) |
| 7 | DBV | insurer | dbv.de (home) |
| 8 | ERV | insurer | erv.de (home) |
| 9 | HUK-Coburg | insurer | huk-coburg.de (home) |
| 10 | Union Investment | fund/insurer-ish | union-investment.de (home) |

- The allowlist for the smoke = exactly these hosts (+ `www.` forms) in
  `.dsh/allowlist.txt`.
- Entities may be swapped at implementation for liveness, but **10 entities,
  bank/insurer mix, German market** is the frozen shape. The list doubles as
  the offline discovery surface (M7).

### The run (ritual, per the M4 skill)

1. `mission_start` note `aggregiere PartnerDaten: Kurzprofile 10 Partner`,
   budget 10 (fixtures are ~10–15 URLs → the budget pressure is *real*;
   cache hits keep it green — this is the point: the ledger must make the
   mission cheaper than the fetch count). All fixture URLs are **seeds**
   (depth 0, host-exempt) — the M5 depth fence (`maxDepth` 2,
   `maxDiscoveredHosts` 3) stays inactive in the smoke by construction.
2. Model fetches fixture URLs (skill: fetch once, check `page_quality`).
3. Model `mission_find`s for the specifics (Kurzprofil facts) instead of
   refetching.
4. Model writes `mission.md`: per-entity Kurzprofil block (name, HQ, what
   they are, key numbers *as found*, sources `[p-…](url)`).
5. `mission_stop` reason `smoke S1 complete`.

### Acceptance assertions (named, scripted where possible)

| # | Assertion | How |
| --- | --- | --- |
| A1 | ≥ 8 of 10 entities have a stored `full` page | script over the ledger |
| A2 | no entity Kurzprofil cites a `thin`/`blocked` page as its source | script: grep mission.md citations × ledger quality |
| A3 | **zero-spawn cache proof** | `accept-cache.mjs`: second fetch of a stored URL → `cached: true`, spawn counter unchanged |
| A4 | no refetch loops | ledger: ≤ 1 non-forced row per normalized URL; total spawns ≤ budget |
| A5 | budget never exhausted (or exhaustion handled cleanly) | manifest `budget` + receipts |
| A6 | `mission.md` has per-entity blocks + citations for all A1 entities | script: 10 sections, each with ≥1 `p-…` citation |

A1–A6 all green = M8 green = **project proof**.

### Known-honesty expectations (recorded, not failures)

- German banking sites are CMP-heavy → expect several `consent_attempted`;
  any entity stuck at `thin` after consent is *recorded in mission.md as
  "no usable page"*, which is the honest outcome (A2 allows it; A1 needs 8/10).
- Chart pages (S3): one fixture URL may be a chart/graph page — stored as an
  artifact, no parsing. If the fixture set has no good chart page, S3 is
  satisfied by any image-heavy stored artifact.

## Verify

- Run A1–A6; paste outputs into the vault done item.
- Operator pass: Jan reads `mission.md` on `:3090` — the Kurzprofile must
  read like *his* aggregator, not like a search engine. His notes fold in as
  dated amendments.
- Commit after green: `m8: partner_daten S1 smoke green — DoD proof (zero-spawn cache)`.

## Scope guard

- No rating engine, no chart parsing, no news scheduler (S2 is one manual
  digest, not a pipeline).
- No new tools/routes — the smoke exercises the **existing** surface. If the
  smoke reveals a missing surface, that is a dated amendment to the *right*
  phase file, not a new tool born here.
- No push, no publish (human gate).

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M8.1 | Fixture shape | 10 entities, bank/insurer mix, German market, 1–2 URLs each |
| D-M8.2 | Budget for the smoke | 10 (real pressure; cache must save the mission) |
| D-M8.3 | A1 threshold | 8/10 `full` pages (CMP-honest floor) |
| D-M8.4 | Citation check | A2 script: no thin/blocked cited as source |
| D-M8.5 | S2/S3 | secondary — S1 + A3 are the DoD; S2/S3 are "nice while the machine is warm" |

## Seam consumption

- **S8** — the smoke runs on fixtures (discovery absent is the supported
  state).
- **D11/§7** — the zero-spawn proof is this phase's reason to exist.
- **§12** — DoD satisfied when A1–A6 + operator pass are green.
