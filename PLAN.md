# dsh-web-missions — scope (overnight / week-horizon)

**Status:** planning — iterate with human; agent milestone files later  
**Workspace:** `/home/hagbard/dev/dsh-web-missions`  
**Harness pin:** DeepSeek Harness **0.2.1-alpha.2** (re-pin in ENV when overnight starts)  
**Implementer:** local Qwen overnight agent (disk = law; chat = amnesia)  
**Protocol:** overnight long-horizon style — plan → small slice → verify → STATUS Next 3  
**Related:** `dsh-local-long-horizon`, `dsh-memento`, Eris `src/tools/web/` (inspiration), DeweyHarness (later consumer)

This file is the **scope reference**. Cordis recipes / M0…Mn acceptance come later in `plan/`.

---

## 1. One-sentence goal

Ship an out-of-tree DSH web plugin that owns **persist + query** for web research (missions on disk, receipts to the model, find over stored pages, **deterministic anti-refetch**), with **local** retrieve via **browser39** — no cloud LLM search (ISO 27001 / DSGVO).

---

## 2. Why this exists

| Driver | Note |
| --- | --- |
| **Long-horizon research** | Compaction kills “tabs in chat.” Missions keep sources. |
| **Dewey prep** | Same pattern later with `web:` vs `corpus:` trust labels. |
| **Architecture practice** | discovery → retrieve → **persist → query** → synthesize. |
| **Local / DSGVO** | No DeepSeek (or other) cloud search LLM. Controlled egress + allowlist. |

**Not** Perplexity. **Not** Playwright/Chrome-floor stacks. **Not** DIY HTML scrapers.

---

## 3. Frozen decisions

| # | Decision |
| --- | --- |
| D1 | **L0 retrieve = browser39** behind a **Fetcher port**. Not bare `ctx.web.fetch` as primary. Not `@truenix/agent-browser` (needs full Chrome ~420 MB — rejected for this lab). |
| D2 | **L1 own** = mission store + ledger + `mission_*` + find + visited-URL guard. |
| D3 | **No cloud LLM search.** Disable / do not mount `dsh-web-search-deepseek` (and Exa/Perplexity) on the dogfood profile. |
| D4 | **Discovery** = fixture URLs for early smokes; later **SearXNG self-hosted** and/or **`browser39 search`** (companion, encapsulated). Never DIY DDG HTML parse in our code. |
| D5 | **Overload / ritual** = skill + thin **templates** (not a second search tool). |
| D6 | **Storage** = `<cwd>/.dsh/web-missions/` (project-scoped, like long-horizon). |
| D7 | **Hygiene** = pane **Clear recents** / **Clear all**. |
| D8 | **Long-horizon** = multi-step logic layer; may sync a one-liner later — not required for first vertical slice. |
| D9 | **Acceptance** on `:3090`; never touch sacred `:3080` / `:8080`. |
| D10 | **Chunk sizing** = hand config (`chunkChars` or `numCtx × ratio`). Slot-health later optional. |
| D11 | **Visited URLs are Host law** — see §7. Local models must not burn budget re-fetching the same page. |
| D12 | **Cookies / sessions** — improve on Eris patterns; see §8. v0 = host sessions + preload + thin consent; stretch = better UX. |

---

## 4. browser39 install (question closed)

**Yes — npm package exists** (wrapper + platform binaries), not only Cargo:

| Path | Spec |
| --- | --- |
| npm | **`@aquintanar/browser39`** (e.g. `2.0.0`) — `bin: browser39`, optionalDeps for `linux-x64` / darwin / win |
| Cargo | `cargo install browser39` |
| Env override | `BROWSER39_BIN` if not on PATH |

**Amended 2026-10-12 (operator decision — S1 flipped):** the plugin
**depends on the npm package** `@aquintanar/browser39@2.0.0` — the platform
binary is pulled in via its optional-deps at plugin install (end users get
browser39 *with* the plugin; no cargo, no PATH state, no separate install).
Resolution: plugin `node_modules` → `BROWSER39_BIN` override → `PATH`
(legacy). Cargo 1.7.1 stays on the box (Eris) but is not the plugin's law.
ENV records the resolved binary; M2 probes the 2.0.0 CLI + session-dir
surface and pins the exact spawn contract in its status log.

**Rejected for L0:** `@truenix/agent-browser` (real Chrome floor). Keep as footnote if a site only works with full Chromium later.

---

## 5. Architecture

```
  discovery (optional)              retrieve (local)
  SearXNG / browser39 search        browser39 fetch/batch
        │                                  │
        │  URLs                            │  Fetcher port
        ▼                                  ▼
  skill / template ──► mission_fetch ──► store .dsh/web-missions/
                         │  if URL already in mission
                         │  → CACHE HIT receipt (no browser)
                         ▼
                   mission_find / mission_status (visited list)
                         │
                         ▼
                   synthesize (model) + long-horizon Next 3
```

| Owner | Responsibility |
| --- | --- |
| browser39 (+ optional SearXNG) | Retrieve / optional discovery — **local** |
| **This plugin** | Persist, query, budget, **visited guard**, cookies config surface, pane |
| Stock `web_search` / DeepSeek | **Off** for this profile |
| Long-horizon | Multi-hour resume |
| Skill | When to start mission, template, cite `artifact_id` |

**Fetcher port:**

```text
interface PageFetcher {
  fetch(url: string, opts?: {
    signal?: AbortSignal
    sessionKey?: string   // host / mission session
    selector?: string
  }): Promise<FetchedPage>
}
```

v0 impl: `Browser39Fetcher` (subprocess JSONL / CLI — Eris-proven).  
Optional later: HTTP fallback for trivial static pages only.

---

## 6. Model-facing surface

| Surface | Role |
| --- | --- |
| `mission_start` | Open mission (note, optional template id, budget) |
| `mission_fetch` | Fetch **or return cache hit** → receipt |
| `mission_find` | Lexical search over chunks + links → snippets / `best_match_url` |
| `mission_list` / `mission_status` | Active mission, **visited URLs**, budget, page list |
| `mission_stop` | Mark done / stop reason |
| Skill `web-mission-workflow` | Ritual + templates |
| Rightbar **Missions** | Board, visited list, Clear recents / Clear all, cookie/session hints |

Receipt fields (intent): `mission_id`, `artifact_id`, `cached` (bool), `page_quality`, `chunk_count`, `preview_head`, `budget_remaining`, `next_step_hint`, `visited_count`, sample links.

**Do not** register `web_fetch` / `web_search` under our names.  
**Do not** mount cloud search providers on the dogfood profile.

---

## 7. Visited sites & anti-refetch (deterministic — ADHD but real)

Local agents re-open the same URL in a loop. **Do not trust skill text alone.**

### Rules (Host-enforced)

1. Every successful fetch records **normalized URL** → `artifact_id` in the mission manifest / ledger.  
2. `mission_fetch` on an already-stored normalized URL → **immediate cache-hit receipt** (`cached: true`, same `artifact_id`) — **zero browser39 call**, **zero budget decrement** (or configurable).  
3. `mission_status` / pane always expose **visited list** (url, artifact_id, quality, fetched_at) so the model can see it without inventing memory.  
4. Optional (Eris-like): **find-before-refetch** on same *host* for a *new* path — soft gate with clear error text pointing at `mission_find`.  
5. Force re-fetch only via explicit flag e.g. `force: true` (default false) — for human/smoke, not the happy path.

Normalization (intent): lowercase host, strip fragment, strip trailing slash, stable query sort — exact algorithm in DESIGN later.

This is a **deterministic function**, not “be smart.” Smartness = the ledger.

---

## 8. Cookie / session handling — how to improve (on Eris, not copy-paste hell)

Eris already proved the shape; we improve where agents actually fail.

### What Eris does today (baseline)

- Per-host **browser39 session** dir (cookies persist when enabled)  
- Thin page → try **click accept labels** (“Alle akzeptieren”, …) → refetch  
- Hard CMPs → **human cookie preload** in config TOML  

Limits (their docs): JS/iframe CMPs often fail; no magic UA.

### Improvements for this plugin (phased)

| Phase | Improvement | Why |
| --- | --- | --- |
| **v0** | Mission-scoped or host-scoped session dir under `.dsh/web-missions/_sessions/` (or `~/.dsh/browser39/…`) | Predictable, project-isolatable, Clear-all can wipe |
| **v0** | Receipt fields: `consent_attempted`, `consent_improved`, `page_quality` | Model must not claim it “read” a CMP wall |
| **v0** | Documented **cookie preload** path + pane hint “session thin — export cookies” | Operator escape hatch |
| **v0.1** | Shared **consent profile** list (DE/EN labels) shipped as asset; override file in cwd | Less vault TOML archaeology |
| **v0.1** | `mission_session_status` or pane card: hosts with cookies / last consent outcome | Visibility |
| **Later** | Optional “open headful once” / import from browser39 profiles if upstream supports cleanly | Human establishes consent; agent reuses |
| **Out** | Reimplementing a full stealth Chromium (agent-browser tax) | Rejected |

UA: use browser39 defaults; allow config override string — do not invent fingerprint farms in v0.

**Principle:** cookies are **infra + honesty in receipts**, not an LLM judgment call.

---

## 9. Discovery without cloud LLM (ISO)

| Option | Role | When |
| --- | --- | --- |
| Fixture URL lists | Smokes / S1 | **Now** |
| Self-hosted **SearXNG** | `web_search`-shaped provider or browser39 search backend | When you want live discovery |
| **`browser39 search`** | Local CLI → JSON | Companion behind Fetcher/search port |
| DeepSeek / Exa / Perplexity | Cloud LLM/search-as-service | **Forbidden** on this profile |
| DIY DDG HTML scrape | Parse SERP HTML in our code | **Forbidden** (Eris scar) |

Companion stays survival-encapsulated (own row / tiny package). Mission core only sees URLs in / URLs out.

---

## 10. Config (v0 — boring)

| Knob | v0 |
| --- | --- |
| `chunkChars` / `numCtxRatio` | Hand-set |
| `maxBytes`, `defaultFetchBudget` | Defaults |
| `BROWSER39_BIN` | ENV |
| `allowlist` | On for dogfood; patterns file under `.dsh/` |
| `persistSessions` / consent | On by default for real fetches |
| `cacheHitCountsAsBudget` | Default **false** |

---

## 11. Templates vs outcomes vs mission log (anti-creep)

| Noun | Plugin? |
| --- | --- |
| **Mission** | Yes — id, pages, visited, budget |
| **Template** | Thin skill/asset only |
| **Outcome** (Kurzprofil, traffic lights) | Model writes `mission.md` — not Host domain logic |
| **Mission log / recents** | Yes — `index.json` until Clear |

---

## 12. DoD smoke — `aggregiere PartnerDaten`

Fixture ~10 banks/insurers. Plugin does **not** implement ratings.

| Step | Intent | Plugin | Outcome owner |
| --- | --- | --- | --- |
| S1 | Kurzprofil | Multi-fetch + find + **no refetch loops** | Model → `mission.md` |
| S2 | News dig | Depth + citations | Model |
| S3 | Chart snapshot | Stored artifact | Fixture OK |

**Proof:** S1 end-to-end + cache-hit on second `mission_fetch` of same URL (accept script asserts `cached: true`, no second browser spawn).

---

## 13. Storage layout (intent)

```text
<cwd>/.dsh/web-missions/
  index.json
  _sessions/                 # browser39 host sessions (optional layout)
  {mission_id}/
    manifest.json            # note, template_id?, budget, status, fetched[] (visited)
    mission.md
    pages/{artifact_id}/
      page.json
      chunks/*.md
      links.json
```

---

## 14. Milestone sketch

| M | Deliverable | Idea? |
| --- | --- | --- |
| M0 | Dual-face skeleton, `/health`, empty Missions tab | scaffold |
| M1 | Store + start/list/status + recents + **visited in status** | **yes** |
| M2 | Fetcher port + **Browser39Fetcher** + `mission_fetch` receipts | **yes** |
| M3 | **Cache-hit path** + accept assert no double browser | **yes** |
| M4 | `mission_find` + skill + thin template | **yes** |
| M5 | Ledger budget + allowlist + session/consent v0 | **yes** |
| M6 | Pane: board, visited, Clear, cookie hint | human |
| M7 | SearXNG or browser39-search companion docs (optional) | discovery |
| M8 | `partner_daten` S1 smoke | proof |

Ship bar: **M0–M5 green**.

---

## 15. Non-goals (v0 / first week)

- Cloud LLM search providers on dogfood profile  
- DIY SERP HTML parsers  
- Full Chrome/Playwright/`@truenix/agent-browser` as default L0  
- Domain engines for investor ratings/charts  
- Forking upstream browser engines on day one (pin + adapter first)  
- Killing `:3080` / `:8080`

---

## 16. Sacred / ops

- `:3090` acceptance; browser open OK  
- Local commits only  
- Vendored `overnite/skills/dsh-out-of-tree-plugin` when scaffolding  
- ENV.md gitignored: harness pin, `BROWSER39_BIN`, `@aquintanar/browser39` version, allowlist notes, chunkChars  

---

## 17. Open items (next iterate)

1. Freeze **10 fixture entities + URLs** for S1.  
2. Package publish name (`dsh-local-web-missions`?).  
3. M6 pane same week or follow-up?  
4. SearXNG on this box now, or discovery-deferred until after M5?  
5. Session root: under project `.dsh/` vs `~/.dsh/` — confirm isolation preference.

---

## 18. Document pack

**Amended 2026-10-12 (post-review session):** the pack is written.

```text
plan/PROTOCOL.md               # frozen — run protocol, three-level status
plan/DESIGN.md                 # contract ledger C1–C9 (accrues as phases land)
plan/KICKOFF.md                # frozen — pre-checks, scaffold, M0 boot
plan/M_<n>_<name>.md           # per-phase deep design (M_0_scaffold … M_9_publish)
plan/M_<n>_<name>.status.md    # per-phase slice board (deep-level status, reflected to top)
plan/OUTDATED_DOCS_NO_NEED_TO_READ/  # pre-pack docs (superseded; read-only)
skills/… (web-mission-workflow + templates — born in M4)
```

No hand-written `plan/STATUS.md`: the long-horizon vault is the **top-level**
status (all phases); the slice boards are the deep level (PROTOCOL §2).

---

*2026-10-12 — peer planning. Amended: ISO no-cloud-search; L0=browser39; npm `@aquintanar/browser39`; rejected Chrome-floor agent-browser; visited/anti-refetch Host law; cookie improvement phases; no DIY DDG scrape. Amended 2026-10-12 (post-review): §4 S1 flipped — npm `@aquintanar/browser39@2.0.0` is the plugin dependency (binary via optional-deps), `BROWSER39_BIN` override, cargo demoted to box-local; §18 document pack written (plan/). Amended 2026-10-12 (review #2): depth fence — `maxDepth` (default 2, per-site link hops) + `maxDiscoveredHosts` (default 3, non-seed host breadth) as M5 host law; seeds depth 0 / host-exempt; C4 receipt gains `depth` + `parent_artifact_id`; search results are not seeds. Amended 2026-10-12 (review #3): M9 publish phase + C9 sibling form-speak (npm name / description / keywords base block / `prepare` fallback / `media/` / MIT / README form; `lib/` tracked; version 1.0.0; C8 retrieval seam) — design aligned to sibling docs form; HANDOVER retired to `plan/OUTDATED_DOCS_NO_NEED_TO_READ`. **Review closed — pack frozen (M0–M9).** Amended 2026-10-12 (review #4 — Eris `src/tools/web/` dig): browser39 transport = **`browser39 batch`** JSONL (not one-shot fetch; one-shot can't `click`), proof metric = **batch invocations** not OS spawns (M2/M3/M8); **consent = C10 tactic seam** (`ConsentTactic`+`LabelClickTactic`+`consent_profiles.toml` labels, ported from Eris `consent.rs`) — deterministic Host code, never model-facing, `persistSessions` is its precondition; **cwd resolution** per-call from agent session (`exec.agent.session.header.cwd`, not `process.cwd()`), exemplar `dsh-local-long-horizon`; tool-registration scar (no `required:true` on scalar schema nodes); C9 reconciled to `dsh-memento` exactly (license/engines/react/no prepare+test); browser39 2.0.0 npm install verified + 2.0.0 runs page JS (1.7.x "no-JS" note stale). dsh 0.2.x pin operator-tested OK.
