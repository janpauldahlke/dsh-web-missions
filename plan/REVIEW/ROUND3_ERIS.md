# Round 3 — Eris comparison (2026-10-14)

Part of the review in `REVIEW.md` (finding ids F1–F15, R2.x refer there).

**Source verified fresh:** `/Users/jandahlke/dev/hagbards_stuff/eris`, branch `main`.
`refs/heads/main` = `refs/remotes/origin/main` = `FETCH_HEAD` main = `2b9ec28`. The local copy equals
the last fetched remote. (`git fetch` was not run by the reviewer, so "fresh" means "as of the
operator's last pull".)

Files read: `src/tools/web/{mod,fetch,fetch_inner,fetcher,find,search,ledger,allowlist,budget,context,bootstrap}.rs`,
`src/tools/specs.rs` (web descriptors), `src/tools/registration.rs`, `src/tools/routing_phrases.rs`,
`src/config.rs` (`WebConfig`), `src/executive/chat_session.rs` (tool wiring),
`src/orchestrator/llm_support/post_tool_guidance.rs`, `README.md`.
Not found or not read: the `web-fetch-workflow` skill body (it lives in the user vault, not in the
repo), `docs/WEB_BROWSER39.md` (referenced but missing from the tree), `consent.rs`, `cache.rs`,
`links.rs`.

## E1 · Eris is a short-lookup tool, not a long-mission tool

| Knob (Eris `WebConfig` default) | Value | Meaning |
| --- | --- | --- |
| `default_fetch_budget` | **2** | pages per mission |
| `max_fetches_per_mission` | **4** | hard cap |
| `max_fetch_budget_override` | 5 | the model cannot ask for more |
| `max_fetches_per_user_turn` | **2** | per turn |
| `max_fetches_per_chat_session` | 12 | per session |
| `max_web_tool_calls_per_turn` | 2 | |
| `require_find_before_refetch` | **true (hard gate)** | the same host is blocked until `web:find` runs |
| `cleanup_missions_on_chat_exit` | **true** | missions are deleted at session end |
| `persist_ledger` | false | the ledger resets each chat |

**Consequence:** Eris's anti-hallucination recipe is mostly "fetch very little, then answer from
what you have". dsh-web-missions reversed the goal: long horizon, 10 entities, persistence across
sessions, verbatim numbers. **Eris never proved that use case.** The port carried the mechanics
(ledger, cache, budget, consent, allowlist) into a regime they were not validated for. This is the
most important framing fact for the redesign.

Note (Round 4): Eris's small defaults reflect its own rig and use case. Long missions need larger
defaults, but they should be config knobs, not constants.

## E2 · Model-facing surface: Eris has 3 web tools, dsh has 6

| | Eris | dsh-web-missions |
| --- | --- | --- |
| Mission lifecycle | **implicit.** The first `web:fetch` without `mission_id` creates a mission; `mission_note` is a fetch argument | **explicit:** `mission_start` / `mission_stop` / `mission_list` / `mission_status` |
| Fetch | `web:fetch` | `mission_fetch` |
| Find | `web:find` (**per `artifact_id`, required**) | `mission_find` (across the whole mission) |
| Search | `web:search` (built in, on by default) | none (companion, unshipped) |

**Link to the operator's test:** the model saw and used only start / list / stop. Eris needs **zero
lifecycle tools**, so a model there cannot get stuck in lifecycle calls. dsh added four lifecycle
and bookkeeping tools, which are exactly the ones the agent used. A model facing six tools, four of
them "safe bookkeeping", can loop on those. This is a design-level hypothesis for F7, stronger than
the round-1 guesses, but still unproven without the transcript.

## E3 · Eris never gave the model full page text either

- `web:find` returns, per match, `trim_chars(chunk, max_snippet_chars)`, with
  `max_snippet_chars = (read_limit/3).clamp(300, 900)` and the total output clamped to
  1000–2500 chars (`chat_session.rs`).
- The Eris snippet is the **chunk head**, not a window around the hit. dsh's snippet (a window
  centred on the best hit) is in that respect *better* for quoting.
- Receipt `preview_head` ≤ 600 chars (dsh: 300).
- Eris chunks are large: `chunk_chars ≈ 0.9 × num_ctx`, with ≤6 chunks per page.
- **Eris does have the read pattern for documents:** `doc:read({doc_id, start, count})`, a
  "paginated sequential chunk reader" with good and bad examples. That is a proven in-house shape
  for the `mission_read` proposal (F3/R2.2), never applied to web.

**Result:** F3 is not a port regression. It is a *new* requirement created by the
long-horizon/verbatim-numbers goal. The finding stands on its own.

## E4 · Deny-all allowlist is inherited from Eris, but Eris made it survivable

| | Eris | dsh |
| --- | --- | --- |
| Default | `allowlist_enabled = true` | `allowlist: 'on'` |
| Off switch | `[web].allowlist_enabled = false` in the main config | `config.json` inside the mission store |
| Missing file | **seeds a commented template** `.fcp/web_allowlist.toml` at boot (`seed_web_operator_files`) | nothing is created |
| Empty error | distinct code `WEB_ALLOWLIST_EMPTY`: "no patterns … add glob patterns before fetching" | the same `allowlist_denied` as a real miss |
| Allow-all in the file | **`"**"` works** (`glob_match`: empty prefix → true) | `*` is rejected as `allowlist_invalid` |
| Search engine | must itself be allowlisted (`html.duckduckgo.com`) | n/a |

The operator's "knob to disable or allow ALL" exists in Eris twice: the config flag and the `**`
pattern. dsh lost both the template seeding and the allow-all pattern. Whatever default is chosen
(R2.1), port the **template seed**, the **distinct EMPTY error**, and an **allow-all pattern**.

## E5 · Eris search fetches a search-results page; it does not use `browser39 search`

- `web:search` builds a URL from the `[search].engine` template in `.fcp/browser39/config.toml`
  (default `https://html.duckduckgo.com/html/?q={}`). It runs that URL through the **normal fetch
  pipeline** (allowlist, ledger, budget) and stores the results page as an artifact. The hint
  says "use `web:find` on the results artifact, do not re-fetch".
- Cache keys for search results **keep the query** (`normalize_url_with_query`); normal pages drop
  the query entirely.
- No custom result parser is needed. The M7 companion instead wraps `browser39 search` plus a
  `uddg` unwrap. Both reach DuckDuckGo. The Eris shape is simpler and keeps search inside the
  budget, ledger and allowlist. A SearXNG URL template plugs into the same slot.
- **Strong candidate for R2.4/F4:** `mission_search` = fetch the results page from an engine
  template, then find over it.
- Budget: in Eris a search **costs one fetch**. Decide whether that is right for long missions.

## E6 · Much of Eris's reliability comes from its runtime, which a dsh plugin cannot copy

Eris has orchestrator features a plugin cannot replicate:
1. **A GBNF grammar per session plus a narrowed grammar per turn.** The model cannot emit
   malformed or unknown tool calls.
2. **Per-turn tool routing** via descriptors (`when_to_use`, **`when_not_to_use`**,
   `examples_good`, **`examples_bad`**, `routing_hints`, `suggested_skills`).
3. **Injected guidance after tool calls:** `POST_TOOL_FAILURE_TRUST_GUIDANCE` ("do not invent
   fetched or saved data…") and `REFLECT_CONTINUATION` for multi-step reads.
4. **A web-specific recovery message:** on `WEB_FIND_BEFORE_REFETCH` it injects "web:find is
   available … Do not claim web:find is missing from your toolset", and
   `ensure_web_find_paired_with_fetch_tools` always offers `web:find` alongside fetch or search.
5. **Per-turn and per-session fetch caps** in the ledger.

**Point 4 is the operator's bug, already met in Eris:** when tools are offered selectively, models
claim a tool is missing. Eris fixed it in its runtime. A dsh plugin controls only (a) the tool
surface, (b) descriptions, (c) the skill, and (d) error/hint strings. The redesign must move Eris's
runtime lessons into those four channels:
- fewer tools, so tool pairing cannot break (E2);
- a `when_not_to_use` line and one bad example in each description, kept short;
- hints that name the next tool *and* state that it exists ("mission_find is available");
- the skill as the only carrier of the workflow, so it must ship (F1).

## E7 · Smaller Eris details worth porting or deciding

- **`suggest_stop` on find:** a deterministic "mission terms appear in the top snippet, you may
  answer" signal. It counters the long-mission failure of never stopping or over-fetching. dsh has
  nothing like it.
- **Receipt field order:** diagnostics first (a one-line `receipt_summary`, `page_quality`,
  `next_step_hint`), large content last, enforced by a test. dsh returns the whole manifest JSON in
  schema order.
- **Paywall class:** `likely_paywall` quality with a "do not claim you read the full article"
  hint. dsh has only full/thin/blocked.
- **Noise sanitizer:** cookie, newsletter and ad lines dropped before chunking. Unknown whether dsh
  does this; check `artifacts.ts`/`fetcher.ts`.
- **Pagination via `offset`/`next_offset`:** Eris loops browser39 pages until `max_bytes`. Check
  whether dsh's `maxBytes` pages through or just cuts off.
- **Find-before-refetch:** a hard gate in Eris, only a soft hint (`hint_find_first`) in dsh. For
  long missions soft is probably right (D-M3.3), but record it as a deliberate divergence.

## Round 3 summary — what changes in the recommendations

| Finding | Before Eris | After Eris |
| --- | --- | --- |
| F2 allowlist | default problem | + port the template seed, the distinct EMPTY error and the `**` allow-all |
| F3 read path | "maybe lost in the port" | **new requirement;** model the shape on Eris `doc:read` |
| F4 search | fold in the companion? | **prefer the Eris shape:** search = templated results-page fetch + find, same gates |
| F7 confusion | install / tool-deferral guesses | **+ design cause:** 4 lifecycle tools vs Eris's 0; Eris already hit the "tool missing" claim |
| F8 descriptions | "too long" | **+ adopt the descriptor discipline** (when_not_to_use, a bad example, short) |
| new | — | `suggest_stop`, receipt field order, paywall class |
| framing | — | **Eris was never a long-mission system.** Validate the long-horizon goal with the R5 model-in-loop DoD before adding more machinery |

Self-critique #8 (missing Eris baseline) is resolved. One caveat remains: Eris's reliability leans
heavily on its runtime (E6), so "port more from Eris" is only part of the fix.
