# M_7 — discovery (companion, optional)

Phase: **M7** · Status: not started (see `M_7_discovery.status.md`)
Depends on: M5 (allowlist + egress semantics).
Timing: **after M5** (S8 / open item 4 — called here: SearXNG is deferred;
  fixture URLs carry the smokes until this phase exists).

---

## Green

A **discovery companion** exists behind a port: the model/operator can get
URLs from a local engine (self-hosted SearXNG and/or `browser39 search`),
encapsulated in its own package/row, and the mission core only sees
**URLs in / URLs out**. Discovery is *optional* — the mission core must stay
fully green with M7 absent.

## Deep design

### Companion shape (survival-encapsulated — PLAN §9)

- Own tiny package/row (e.g. `dsh-local-web-discovery`), **not** merged into
  the mission core. The core gains exactly one new optional surface:
  `mission_urls` (or a `discovery` object in `mission_status`) listing
  discovered URLs for a query — the core never calls an engine itself.
- Two engines, both local, both optional:
  1. **SearXNG** (self-hosted, on this box or a container): HTTP JSON API
     (`format=json`), `web_search`-shaped query in → `[{url, title, snippet}]`.
     Config: `searxng_endpoint`, hand-set in ENV.md (default
     `http://127.0.0.1:8888/searxng` — **not :8080**, that port is llama).
  2. **`browser39 search`** (CLI companion): same JSONL pattern as the
     fetcher — local CLI → JSON, behind the same `DiscoveryPort`:

```ts
interface DiscoveryPort {
  search(query: string, opts?: { limit?: number; engine?: 'searxng' | 'browser39' })
    : Promise<{ url: string; title?: string; snippet?: string }[]>
}
```

- Engine absence (no SearXNG running, no CLI subcommand) → companion reports
  `error: no_engine` — the mission core degrades to fixtures/human-supplied
  URLs. **Missing discovery is a supported state**, not a failure.

### Egress + ISO boundary (S6, restated)

- SearXNG is *still egress to upstream engines* (it fans out to Google/Bing/
  DDG etc.). The no-cloud-LLM claim is untouched (no LLM in the loop), but the
  **allowlist covers fetch only** — discovery results are *candidates*, and
  every candidate still passes the M5 allowlist gate when fetched.
- If the operator wants discovery egress locked too: the SearXNG instance is
  configured with a restricted engine set (hand config, outside this
  package) — documented, not built.
- **Never** DIY DDG HTML parsing in our code (Eris scar — PLAN §9 forbidden).

### Fixture lists (the other half of discovery-now)

- `fixtures/partner-daten.json` (see M8) doubles as the offline discovery
  surface: the skill's ritual includes "or take URLs from the fixture list"
  for smokes. Fixtures are *data*, not a discovery engine.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | no SearXNG, no browser39-search | `no_engine` error; mission core (M0–M5) fully green unchanged |
| V2 | SearXNG up (local test instance) | query → ≥1 URL; each fetched through the core passes the allowlist gate (denied ones show `allowlist_denied`) |
| V3 | `browser39 search` (if subcommand exists in 1.7.1 — probe first) | JSON results shaped to the same `DiscoveryPort` type |
| V4 | engine down mid-mission | `no_engine` on next query, prior mission data intact |
| V5 | encapsulation check | diff of mission-core package: no engine code, no engine config beyond the optional surface |

## Scope guard

- **Optional phase**: if M0–M5 + M8 are green and M7 fights the box, M7
  stays a documented companion — the ship bar does not include it.
- No multi-engine ranking/fusion, no result caching beyond the mission
  ledger (discovered-but-unfetched URLs are not "visited" — no ledger rows
  until fetched; documented).
- No SERP UI in the pane (M6 surface stays as designed; a results list in the
  pane is a post-ship stretch).
- Commit after green: `m7: discovery companion (SearXNG / browser39 search) behind DiscoveryPort`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M7.1 | Port | `DiscoveryPort` (query → `{url,title?}` list) |
| D-M7.2 | Engines | SearXNG (HTTP JSON) + browser39-search (CLI), both optional |
| D-M7.3 | Missing engine | supported state (`no_engine`), core degrades to fixtures |
| D-M7.4 | Discovered URLs | not ledger rows until fetched; allowlist gates the fetch |
| D-M7.5 | Package | separate companion package, own row |

## Seam consumption

- **S8** — resolved: discovery deferred past M5; fixtures carry the smokes.
- **S6** — restated and closed: fetch-egress allowlist + discovery boundary.
- **D4** — satisfied: SearXNG and/or browser39-search, never DIY parse.
