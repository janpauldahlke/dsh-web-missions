# M_5 — ledger (budget + allowlist + sessions/consent v0)

Phase: **M5** · Status: not started (see `M_5_ledger.status.md`)
Depends on: M2 (fetch path), M3 (cache-hit receipts), M4 (skill honesty
  contract to enforce).

---

## Green

The **ledger closes**: budget (unit = fetch calls, S5) is enforced; the
**allowlist** gates egress for the dogfood profile; the **depth fence**
(host breadth + per-site link depth) caps how far a mission may wander from
its seeds; **host-scoped sessions**
(C7, S3) persist consent across missions; consent v0 (attempt → improve →
honesty fields) works; the honesty gate stops the model from claiming it read
a `thin`/`blocked` page. **Ship bar (M0–M5 green) reachable from here.**

## Deep design

### Budget (C6 — born here, S5)

- **Unit = fetch calls.** A *non-cached* `mission_fetch` attempt costs 1
  (success, failure, or timeout — it was a browser spawn). **Cache hits are
  free** (`cacheHitCountsAsBudget: false`, default; the knob exists, documented).
- Set at `mission_start` (`budget.max`, default `defaultFetchBudget: 10`),
  `budget.spent` incremented on each charged attempt, `budget.remaining =
  max - spent` in **every** receipt + `mission_status`.
- Exhausted (remaining would go < 0) → receipt `ok: false,
  error: budget_exhausted: N fetch calls used; pass force only re-fetches when…` —
  v0: **no** override for exhaustion except a new `mission_start` (documented;
  keep it boring).
- The ledger row gains `budget_charged: true|false` (audit: which fetches
  cost).

### Allowlist (egress control, dogfood on)

- Patterns file: `.dsh/allowlist.txt` (gitignored alongside ENV.md), one
  pattern per line, `#` comments. Pattern grammar (v0): `host.example.com`
  (exact host), `*.example.com` (suffix, includes apex), `http(s)://host/path`
  (exact origin+path prefix).
- Gate point: in `mission_fetch`, **after** normalization, **before** spawn
  (cache hits are not re-gated — the page was already admitted; documented).
- Denied → receipt `ok: false, error: allowlist_denied: <url> not in .dsh/allowlist.txt`,
  no spawn, no budget charge.
- Empty/missing file = **deny all** (dogfood is locked-down by default; an
  operator who wants open egress deletes the gate in config `allowlist: off`).
  Config knob: `allowlist: 'on' | 'off'`, default `on` for the dogfood profile.
- **S6 boundary (ISO claim):** the allowlist covers **fetch egress only**.
  Discovery (M7 SearXNG / browser39-search) is *out of scope for the
  no-cloud claim* — the claim is "no cloud **LLM** search; all stored content
  came through allowlisted local fetch." One paragraph, recorded here; if the
  claim later has to cover discovery, the allowlist extends to the discovery
  companion's upstream list (amend, don't rebuild).

### Depth fence (crawl boundary — host law)

Bounded wandering, operator-tunable, enforced by the host — same tier as
budget/allowlist, the agent cannot silently exceed it:

- **Knobs:** `maxDepth` (default **2**) = max link-hops from the nearest seed
  that may be fetched; `maxDiscoveredHosts` (default **3**) = max distinct
  **non-seed** hosts the mission may fetch. Seed URLs (given at
  `mission_start`, or fetched with no known lineage) are depth 0 and exempt
  from the host count — roots are deliberate, not wandering.
- **Lineage (deterministic):** a URL's depth = `min(parent depth + 1)` over
  every stored `links.json` / `manifest.fetched[]` entry that lists it as a
  link or final URL. A URL that appears in no stored page and is not a seed =
  fresh root (depth 0). The fence stops *unbounded auto-follow*; deliberate
  new roots are the agent's job.
- **Gate point:** in `mission_fetch`, **after** normalization, **before**
  spawn — exactly when a spawn is about to happen. Cache hits skip the spawn
  and are not re-gated (same precedent as the allowlist, D-M5.4).
- **Refusals (no spawn, no budget charge):**
  - `depth_exceeded: <url> is N hops from its nearest seed (maxDepth: M)`
  - `host_breadth_exceeded: <host> would be the Kth non-seed host (maxDiscoveredHosts: M)`
  - both carry a deterministic `next_step_hint`: "fence refused this fetch —
    follow a nearer link, raise the knob in config, or start a new mission
    rooted at the URL".
- **Discovery coupling (M7):** SearXNG / browser39-search results are *not*
  seeds — fetching one consumes discovered-host budget. This bounds the
  "overall query": search may surface links, the fence decides how far the
  mission may actually go.
- **Receipt:** `depth` + `parent_artifact_id` fields (C4 amendment; null/0 in
  M2 per the schema-stability rule, filled by the fence).

### Sessions/consent v0 (C7 — born here, S3)

- **Host-scoped session dirs:** `~/.dsh/browser39/sessions/<host>/` (host =
  lowercased hostname, no port). The fetcher passes `sessionKey` (M2 already
  shapes the port for it); browser39 persists cookies there per host.
  Consent is a **host property** — survives new missions, new projects.
- `persistSessions` on by default (PLAN §10). `Clear all` (pane, M6) wipes
  mission dirs + index + session dirs (operator escape hatch).
- **Consent v0 flow** in the fetcher:
  1. Fetch page → quality computed.
  2. If `thin` **and** CMP markers hit → **one** retry: instruct browser39 to
     click the first element matching the shared label list
     (`CMP_LABELS` asset: "Alle akzeptieren", "Akzeptieren", "Accept all",
     "Accept", "Zustimmen", "Allow all" + the M2 marker words), re-extract.
  3. `consent_attempted: true` (step 2 ran); `consent_improved: true` iff the
     re-extract is `full` (or text grew ≥ 3×).
  4. Retry budget: exactly one attempt per fetch call (no loops); the retry
     does **not** cost extra budget (same call).
- **Cookie preload escape hatch:** documented path — operator drops a cookie
  file into `~/dsh/browser39/sessions/<host>/` (format per browser39 session
  layout; documented in the pane hint text + README), next fetch picks it up.
  No UI import in v0.
- Receipt honesty gate: if a receipt is `thin`/`blocked`, `next_step_hint`
  **must** carry `"do not claim content from this page"` — deterministic text
  (the model's honesty contract, enforced by the receipt, not by hoping).

### Config surface (v0, boring — PLAN §10)

| Knob | Default | Where |
| --- | --- | --- |
| `chunkChars` | 2000 | hand |
| `defaultFetchBudget` | 10 | hand |
| `maxBytes` | 2 MB | hand (truncates stored content, `quality_signals: ["truncated"]`) |
| `allowlist` | `on` | hand |
| `persistSessions` | `true` | hand |
| `cacheHitCountsAsBudget` | `false` | hand |
| `fetchTimeoutMs` / `thinThresholdChars` | 30000 / 300 | hand (M2) |
| `snippetWindow` | 120 | hand (M4: chars ± around the best hit, line-boundary clipped) |
| `maxDepth` | 2 | hand (depth fence: max link-hops from nearest seed that may be fetched) |
| `maxDiscoveredHosts` | 3 | hand (depth fence: max non-seed hosts per mission; seeds exempt) |

All knobs read from ENV.md / a `config.json` under `.dsh/web-missions/` —
one mechanism, named in DESIGN when the file exists. No UI for knobs until M6.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | budget: start (max 3), 3 fresh fetches, 4th | 4th → `budget_exhausted`, no spawn; receipts 1–3 show `remaining` 2/1/0 |
| V2 | cache hit with remaining 0 | `cached: true` receipt succeeds (hits free) |
| V3 | allowlist: file with `www.sparda-berlin.de` → fetch that host | ok; fetch `www.example.com` | `allowlist_denied`, no spawn, no charge |
| V4 | empty allowlist file + `allowlist: on` | every fetch denied (deny-all default) |
| V5 | consent: fixture/known CMP page (or synthetic CMP test page served locally) | `consent_attempted: true`, `consent_improved: true` on a passable label; exactly one retry (assert spawn count = 2 for the call) |
| V6 | session persistence: fetch host A (consent given) → new mission → fetch host A again | no CMP markers on second mission's fetch (cookies persisted under `~/.dsh/browser39/sessions/`) |
| V7 | honesty gate: fetch a 404 | `next_step_hint` contains the do-not-claim text |
| V8 | `maxBytes` truncation on a large page | `quality_signals: ["truncated"]`, stored content ≤ limit |
| V9 | depth fence: seed page with a sublink, sublink with a sub-sublink; `maxDepth: 1` | seed fetch depth 0 ok; sublink depth 1 ok; sub-sublink → `depth_exceeded`, no spawn, no budget charge |
| V10 | host breadth: seed host + 3 reachable non-seed hosts; `maxDiscoveredHosts: 2` | hosts 1–2 fetch ok; 3rd → `host_breadth_exceeded`, no spawn, no budget charge |

## Scope guard

- **No pane** (M6), **no discovery** (M7), **no SearXNG**, **no session
  status card / consent-asset v0.1 stretch** (post-ship, only if M8 hurts).
- No per-URL budget overrides, no mission budget top-ups (boring on purpose).
- No autonomous crawl loop: the fence only *refuses* — the agent (or a
  future M7+ walker) still issues every fetch.
- No automatic re-fetch scheduling, no TTLs (S4: information, not gate).
- Commit after green: `m5: budget (fetch-call unit) + allowlist + host sessions + consent v0 — ship bar`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M5.1 | Budget unit | fetch calls; charged on non-cached *attempts*; hits free |
| D-M5.2 | Exhaustion | hard stop; new mission to continue (no override flag in v0) |
| D-M5.3 | Allowlist default | deny-all with file on; `allowlist: off` is the documented escape |
| D-M5.4 | Cache-hit re-gating | no (page already admitted) |
| D-M5.5 | Consent retries | exactly one per fetch call, no extra budget |
| D-M5.6 | S6 boundary | allowlist = fetch egress; discovery explicitly outside the no-cloud claim |
| D-M5.7 | Depth fence | `maxDepth` (default 2) + `maxDiscoveredHosts` (default 3); lineage via stored links; seeds depth 0 / host-exempt; gate pre-spawn; refusals free (no budget charge) |
| D-M5.8 | Discovery vs fence | search results are not seeds; fetching them consumes discovered-host budget (M7 coupling) |

## Seam consumption

- **S3** — resolved: host-scoped `~/.dsh/browser39/sessions/<host>/`, mission
  store project-scoped.
- **S5** — resolved: budget unit named in C6 + every receipt.
- **S6** — resolved: one-paragraph boundary (above), no rebuild.
- **S7** — resolved at M2 (our deterministic label); M5 makes the receipt
  enforce the honesty contract.
- **C4 amendment (2026-10-12)** — receipt gains `depth` + `parent_artifact_id`
  (null/0 in M2, filled by the fence).
- **C6/C7** — born here, frozen at M5 green.
