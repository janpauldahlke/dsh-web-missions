# REVIEW — critical pass against the AC (2026-10-14)

Reviewer: GitHub Copilot (external, first contact with this repo).
Sources read: `PLAN.md`, `plan/DESIGN.md`, `plan/KICKOFF.md`, `plan/M_7*.status.md`,
`plan/M_8*.status.md`, `src/host/{index,tools,skill,fetch-service,allowlist,config,depth-fence,routes}.ts`,
`skills/web-mission-workflow/SKILL.md`, `package.json`, `scripts/run-s1-smoke.mjs`, `lib/index.js` (grep).
Not verified: the GitHub sibling repos (no web access; the terminal tool failed to start) and a live
`dsh web` run. Eris was read from the local checkout (Round 3).
Structure: Round 1 (F1–F15) → Round 2 (R2.x) → self-critique → Round 3 Eris (E1–E7) → Round 4
config knobs (R4.x) → Round 5 ideas (Q1–Q6). Round 4 overrides any model-size wording earlier on.

## Verdict (one paragraph)

The host engineering is solid: the ledger, cache hits, budget, normalization and receipts are
deterministic and well tested in isolation. **The product goal is not met yet.** The goal is
"a local agent navigates the web on long missions without hallucinating". The AC were proven by
**scripts that call `execute()` in-process** and by an implementer that could read chunk files from
disk. They were **never proven by a model running in a harness session using only the tools.**
In a real session the model (a) cannot search, (b) only sees stored pages through fixed windows
(preview 300 chars, hard-coded; snippet ±120, a config knob that the tool ignores, see R4.2) and
has no tool to read a whole chunk, (c) is denied every fetch on a fresh project unless the operator
set up or switched off the allowlist, and (d) on an npm install never receives the workflow skill.
Each of these on its own explains a "confused agent". **Rule for every fix (Round 4):** no
assumptions about model size; every size and limit is a config knob tuned to the local rig.

Severity: **P0** = blocks the product goal, **P1** = wrong or misleading behaviour, **P2** = polish.

---

## P0 — blocks real use

### F1 · The workflow skill is not shipped (`files[]` omits `skills/`)
- `skill.ts` reads `<pkgRoot>/skills/web-mission-workflow/SKILL.md` at apply time.
- `package.json` `files` = `lib, cordis.patch.yml, README.md, LICENSE, media`. **No `skills`.**
- The result: npm and GitHub-tarball installs log a warning and silently skip the skill. Only a
  local-path install (`dsh plugin add $(pwd)`) gets it. The model then sees six bare tools and no
  ritual. This fits the confusion you saw.
- **Change:** add `"skills/web-mission-workflow"` to `files[]` (not the vendored
  `dsh-out-of-tree-plugin`). Better still, inline the skill body into the bundle at build time so no
  runtime file read is needed. Add an acceptance check against `npm pack` output.

### F2 · Deny-all allowlist with no seed exemption → every fetch fails on a fresh project
- `config.allowlist` defaults to `'on'`. A missing `.dsh/allowlist.txt` denies everything
  (`allowlist.ts`).
- The README says "Seeds are exempt". **The code does not do this.** `fetch-service.ts` 4a calls
  `checkAllowlist(url, …)` without checking `manifest.seeds`. Seeds are exempt only from the
  *host-breadth* cap.
- Nothing in any tool description tells the model how to fix it. The error text names the file, but
  the model must not edit egress policy itself (and should not).
- So the first real session ends in `allowlist_denied` until the operator hand-writes a file they
  were never told about. The M8 run worked only because the implementer pre-wrote 11 hosts (8.2).
- **Change (pick one, record it in DESIGN C6/C10-style):**
  1. Make the README true: seeds given at `mission_start` are allowlisted for that mission (the
     operator or model declares the roots explicitly, so this is auditable in the manifest), **or**
  2. default `allowlist: 'off'` for the npm profile and `'on'` for dogfood, **and** in both cases
     return a receipt hint such as `operator must add <host> to .dsh/allowlist.txt` plus a pane
     banner "allowlist empty".

### F3 · The model cannot read what it fetched
- Tools: start / list / status / fetch / find / stop. There is **no `mission_read`** (artifact +
  chunk → text).
- What reaches the model: `preview_head` (~300 chars) and find snippets of ±`snippetWindow` = 120
  chars.
- The skill then asks for "key numbers verbatim from the cited page". With 240-char windows the
  model fills the gaps, which is the hallucination this plugin exists to prevent. The M8 mission.md
  numbers came from an implementer with shell access to `chunks/*.md`, not from the tool surface.
- **Change:** add `mission_read({ artifact_id, chunk?, mission_id? })` → `{ url, page_quality,
  chunk, chunk_count, text }`. It is read-only, zero-cost, and returns one chunk per call so context
  stays bounded. Have `mission_find` matches reference `artifact_id + chunk` so the loop is
  `find → read → cite`. This is the single most important change for "don't hallucinate".

### F4 · No discovery in the shipped surface → URLs come from model memory
- M7 discovery lives in a **separate companion** (`~/dev/dsh-web-discovery`, `discovery_search`).
  It is not in this repo, not in the README, and (as far as this repo shows) not published.
- `mission_status`'s description still advertises `discovery_search`, a tool the model does not
  have. That is a dangling reference, and those cause tool-call hallucinations in themselves.
- Without search, the only URL sources are: seeds the user typed, `sample_links` (≤5), and the
  model's memory. Memory gives hallucinated or 404 URLs, which burn budget (blocked pages are
  charged).
- **Change:** either (a) publish the companion and link it in the README "Requirements", or
  (b) fold `browser39 search` into this package as `mission_search` (it is already a dependency,
  results are recorded as candidates, and fetching stays allowlist-gated). Also remove the
  `discovery_search` mention from `mission_status` unless the tool is actually registered.
- **Update (Round 3, E5):** the preferred shape is now `mission_search` = fetch a results page from
  an engine template through the normal gates, then find over it (`PLAN_FINAL.md` R3.1).

### F5 · The AC were never run by a model
- `run-s1-smoke.mjs` / `run-s2s3-smoke.mjs` call `byName.mission_*.execute(...)` directly and
  **write `mission.md` from the script**. M8 A1–A6 therefore prove the host, not the agent loop.
  (Minor: `run-s1-smoke.mjs` logs `rec.budget_spent`, a field that does not exist.)
- **Change:** add an M10 "agent-in-the-loop" acceptance. A real `dsh` session on the local model
  gets the prompt "aggregiere PartnerDaten for 3 entities" with **only** the plugin tools plus a file
  write tool. Score the transcript on: tool calls made, zero `allowlist_denied` surprises,
  every number in mission.md found verbatim in a stored chunk (scriptable), and zero un-registered
  tool names called.

---

## P1 — wrong or misleading

### F6 · The pane and the tools can show different stores
- Tools resolve cwd from the session header. `routes.ts:97` uses `process.cwd()` (the documented
  "sanctioned" exception).
- If `dsh web` is started anywhere other than the project dir (the normal case for users), the
  rightbar shows an empty or other project's board, and **Clear all wipes the wrong store**.
- **Change:** routes take `?cwd=` from the client, which knows the active session/workspace, or
  look up the workspace through the harness session service. At minimum, show the resolved root in
  the pane header.

### F7 · "Your agent only saw start / stop / list": possible causes to check
I cannot see your harness, so these are ranked hypotheses:
1. **Stale install:** the profile's `node_modules/dsh-local-web-missions` points at an older
   published 1.0.0 or `lib/` built before M2/M4. Check with
   `grep -c 'name: "mission_' ~/.dsh/profiles/web/node_modules/dsh-local-web-missions/lib/index.js`
   (expect 6).
2. **Harness tool deferral / lazy listing:** some harness builds list only a subset of tools and
   expose the rest through a tool-search step. Very long descriptions (the `mission_fetch`
   description is ~1.4k chars) make this worse.
3. **Model-side:** without the skill (F1), nothing names `mission_fetch` / `mission_find` as the
   core loop, whatever the model size. (See also E2 and Q4.)
- **Change:** besides F1, add a `GET /api/web-missions/health` field `tools: [...]` (registered
  names) and `skill: true|false`, so "what did the model get" is one curl.

### F8 · Tool descriptions are too long
- `mission_fetch`'s description includes the whole M3/M5 design (cache, alias, depth, breadth,
  budget, allowlist). That costs context on every turn for every model and buries the "when to
  use" line. A context-budget argument, not a model-size argument.
- **Change:** use about 2–3 sentences per tool. Move the gate semantics into the skill and into the
  error/hint strings, which already exist and are good.

### F9 · The depth fence can be bypassed by construction
- A URL that appears in no stored `links.json` is a "fresh root" at depth 0. A model that pastes a
  URL from memory, which is exactly the hallucination case, skips `maxDepth`. Only the host-breadth
  cap applies.
- This is not a security issue (the allowlist is the egress gate), but `depth` is then not a useful
  provenance signal.
- **Change:** record `origin: seed | link | discovery | unsourced` on each ledger row and surface
  `unsourced` in the receipt (`"this URL was not linked from any stored page"`). That turns a hidden
  bypass into an honesty signal, which matches the plugin's own philosophy.

### F10 · `mission.md` has no tool path
- The skill says "synthesize into mission.md", but no tool returns its absolute path and no tool
  writes it. The model has to guess `<cwd>/.dsh/web-missions/<id>/mission.md` and needs a generic
  file-write tool.
- **Change:** return `mission_md_path` from `mission_start` / `mission_status`. Optionally add
  `mission_note({ text, citations[] })` that appends and **rejects citations whose artifact is
  thin/blocked or unknown**. That moves A2 (citation honesty) from post-hoc script to host law.

### F11 · Budget exhaustion forks the research
- `budget_exhausted` says "start a new mission", but `mission_find` / `mission_read` are scoped to
  one mission. The new mission cannot find the old pages, which contradicts the "find it back
  across sessions" claim in the README.
- **Change:** either `mission_extend({ add })` (operator-visible, receipted) or `mission_start({
  continues: <id> })` so find spans the chain.

---

## P2 — polish

- **F12** `mission_fetch.execute` forwards an undeclared `args.chunkChars`
  (`additionalProperties: false` in the schema). Drop it or declare it.
- **F13** README claims "Seeds are exempt" from the allowlist (see F2). Fix the code or the docs.
- **F14** Tracking params (`utm_*`) are part of the cache key (documented non-goal, C2). M8 8.5
  already hit this ("exact stored link URLs"). Worth amending C2 now that there is evidence.
- **F15** `blocked` fetches cost budget. With memory-sourced URLs (F4/F9) a few 404s drain a
  10-call mission. Consider making 404/410 on an `unsourced` URL free, or raising the default budget.

---

## Suggested order

**Superseded:** the binding order is `PLAN_FINAL.md` (re-ordered after Rounds 3–5; see the
"Order changes" section there). The round-1 order below is kept for history.

1. F1 (one-line ship fix) → F2 (decision + small code) → F7 diagnosis curl.
2. F3 `mission_read` + F10 path → shrink descriptions (F8).
3. F4 discovery decision (fold in vs companion).
4. F5 agent-in-the-loop acceptance as the new DoD; re-run S1 with a real model.
5. P1/P2 remainder.

## Open questions for the operator

1. F2: should seeds auto-allow (auditable, model-declared), or must egress stay operator-only?
2. F4: fold `browser39 search` into this package, or keep the companion and publish it?
3. Which local model or harness build showed the 3-tool view? (This tells us whether F7.1 or F7.2
   applies.)
4. Is a model-writable `mission_note` (F10) acceptable, or must mission.md stay free-form?

---
---

# Round 2 — operator answers, deeper analysis (2026-10-14)

No code changed. This section is for thinking, not deciding.

## R2.1 · Allowlist: "a knob to disable it or allow all"

**What the code already has:** `<cwd>/.dsh/web-missions/config.json` → `{ "allowlist": "off" }`
fully disables the gate (`fetch-service.ts` 4a: `config.allowlist === 'on' ? loadAllowlist : null`).
So the knob **exists**. The problem is narrower than F2 claimed:

| Aspect | Today | Why it hurt your test |
| --- | --- | --- |
| Default | `'on'` + missing file = deny all | A fresh project denies the very first fetch |
| Where the knob lives | inside the mission store dir (`.dsh/web-missions/config.json`) | Not where a user looks. The README mentions it in one line. |
| Per-project only | Yes | Every new project starts locked again |
| Error text | `<url> not in .dsh/allowlist.txt` | Does not mention the off-switch. The model can only relay a dead end. |
| "Allow all" pattern | Not in the grammar (`*` alone is rejected as `allowlist_invalid`) | There is no way to say "all" inside the file. You must use the config knob. |

**Design options to think about (no decision taken):**
- A. Flip the default to `'off'`, so the allowlist is opt-in, matching your sentence "the whitelist
  is for users that want to use it". This conflicts with PLAN D3/§10 ("on for dogfood"). That is
  fine, because the dogfood profile can set `'on'` explicitly.
- B. Keep `'on'`, but treat **missing file = allow all** and **existing file = enforce**. The
  presence of the file becomes the opt-in. This is simple, but "deleting a file widens egress" is a
  surprising security property.
- C. A tri-state: `allowlist: 'off' | 'on' | 'seeds'`, where `'seeds'` admits hosts declared at
  `mission_start`. This is a middle ground for auditable missions.
- Whichever you pick, the `allowlist_denied` message should name the switch, and the pane should
  show the current mode. Also consider a global default (profile-level or `~/.dsh/…`) so it is not
  per project.

My lean: **A** (default off, opt-in file). It matches your stated intent and keeps the code
change tiny.

## R2.2 · "Wasn't `mission_list` for this?"

No. Checked in `store.ts:480`: `mission_list` returns index rows plus counts
(`pages`, `visited`, `budget`). It reads **no page content**. `mission_status` returns the manifest
and visited ledger (URLs, artifact ids, quality), also with no content. Neither lets the model read
a stored page. Correction to F3: `mission_find` matches already carry `artifact_id` + `chunk`
(`retrieval.ts:58`). So the "pointer" half of `find → read` exists; only the "read" half is
missing. F3 stands, but the change is smaller than written.

Two reasonable shapes for the operator:
- `mission_read({ artifact_id, chunk })`: explicit and bounded (about 2000 chars/call at the
  default `chunkChars`).
- Or `mission_find({ …, expand: true })`, which returns the full best chunk instead of the snippet.
  This adds no new tool, which matters if F7.2 (tool-count sensitivity) is real.

## R2.3 · Compare with Eris?

**Yes, worth it.** The design explicitly ports Eris (`src/tools/web/fetcher.rs`, `consent.rs`;
PLAN §8, DESIGN C3/C10). But I **could not read it** in this session (see header). Concretely, I
would check:
1. **Model-facing tool surface in Eris.** How many tools, how is page text returned (full markdown?
   paged with `offset`/`next_offset`?), and does the model ever read beyond a preview? DESIGN C3
   mentions `truncated`/`next_offset` from browser39. If Eris exposes paging to the model, that is
   the proven answer to F3 and was lost in the port.
2. **How Eris discovers URLs.** PLAN §9 says "DIY DDG HTML parse = Eris scar". So what replaced it?
3. **Allowlist default in Eris.** Did Eris run deny-all? If not, the deny-all default is new to this
   repo and not inherited "proven" behaviour.
4. **Which parts of Eris actually stopped hallucination on long missions.** Was it the ledger, the
   full-text read, or the prompt/skill? This repo ported the ledger very carefully. Make sure it did
   not drop the part that mattered.

To do this, either paste `src/tools/web/` from Eris here, clone it next to this repo, or run me in
an environment with web access.

**Status 2026-10-14: RESOLVED. See Round 3 (E1–E7) below.** Eris was read by absolute path from
the local checkout.

## R2.4 · Search without cloud: browser39

You want no cloud search from dsh and browser39 instead. Facts from this repo's own logs
(`M_7_discovery.status.md`):
- `browser39 search` exists in 2.0.0. It is a **local CLI, but it queries DuckDuckGo over the
  network**. It is not a cloud *LLM*, but it **is** a third-party search engine receiving your
  queries. Whether that is acceptable under your ISO/DSGVO stance (PLAN §2/§9) is your call.
  README "Privacy" currently says "No search engine". That stays true only while search is in the
  companion.
- DDG **rate-limits** quickly: ~17 queries in 30 min caused sustained HTTP 202 bot challenges and a
  ~60 min cooldown. On a long agent mission that is a real failure mode, not an edge case.
- The browser39 engine is configurable (`BROWSER39_CONFIG [search] engine = "…q={}"`). The M7 log
  says a local SERP fallback was verified. Self-hosted SearXNG remains the only option where queries
  never leave your network.
- The companion `dsh-local-web-discovery` already implements both engines and the `no_engine`
  degrade path. The open question is **packaging**, not engineering: fold in or publish alongside.

Questions for you:
- Is DDG-via-browser39 acceptable, or do you require SearXNG-only for "no queries leave the box"?
- Should search results count against the budget? (They currently do not, since the budget counts
  fetches only.) Given the DDG rate limit, a separate small `search_budget` may help.

## R2.5 · Re-ranked priorities after round 2

1. **F1** skill not shipped. Unchanged, still the top suspect for the confused agent.
2. **F7.1** diagnose what was actually installed (one grep). Do this before designing anything.
3. **F2 / R2.1** allowlist default plus a discoverable switch.
4. **F3 / R2.2** reading stored text (tool or `expand`).
5. **F4 / R2.4** search packaging and privacy decision.
6. **F5** agent-in-the-loop acceptance. This needs 1–5 first, or it will just fail on the same
   walls.

---

# Reviewer's own critical findings (self-critique of this review)

Things I got wrong, overstated, or could not back up in round 1. Read these before trusting the P0
list.

1. **F2 overstated.** I said "every fetch fails" with no fix besides editing the allowlist, but
   `allowlist: 'off'` already exists. The real defect is the *default plus discoverability*
   (R2.1).
2. **F3 partly overstated.** `mission_find` already returns `artifact_id` + `chunk`. The missing
   piece is only a read path.
3. **F7 is speculation.** I have not seen your harness, transcript, or installed tree. "Only
   start / stop / list" might also be the model *mentioning* only those, not the harness exposing
   only those. Without the transcript, this is a hypothesis list, not a finding.
4. **The F1 severity depends on your install path.** If you installed via `dsh plugin add <local
   path>` (as in KICKOFF §4), the skill *was* found and F1 did not cause your test failure. F1 is
   still a real publish bug.
5. **I did not run anything.** There was no build, no tests, and no `npm pack`. Every claim is from
   reading source. The round-1 claim that the README is wrong is now verified (README L130-131
   "Seeds are exempt"). I also found a **new README mismatch**: README "Surfaces" lists
   `artifacts/`, `receipts.json`, and `links.json` at mission level, while the code stores
   `pages/{artifact_id}/{page.json,chunks/,links.json}` (`artifacts.ts`) and has no
   `receipts.json`. The README was likely written from intent, not from code. Audit it as a
   whole, not line by line.
6. **I under-weighted what the 22h run did well.** Gates are pre-spawn and zero-cost, errors are
   classed, and the honesty hint is enforced at a single point. This is better discipline than
   most agent tooling. My review reads harsher than the code quality deserves. The gap is
   **integration and product validation**, not engineering.
7. **Systemic finding (process, not code).** The long-horizon run's own acceptance criteria were
   satisfiable without a model in the loop, so the agent optimised for them. Every Mx "green" is
   host-green. The lesson for the next long-horizon plan is that at least one AC per phase must be
   checked against a real model transcript. Otherwise the run converges on testable plumbing and
   drifts away from the goal. This is probably the most valuable finding for your workflow
   overall, beyond this repo.
8. **Missing comparison baseline.** I judged "will the agent hallucinate" without the Eris
   reference that this design came from (R2.3). Some of my P0s may be things Eris also lacked and
   handled fine through prompting. Treat F3/F4 as "likely", pending that comparison.
   **Resolved in Round 3:** F3 and F4 stand. Caveat: Eris's reliability leans on its own runtime
   (E6), which a dsh plugin cannot copy, so "port more from Eris" is only part of the fix.
9. **The sibling repos (`dsh-memento`, `dsh-local-long-horizon`, …) remain unread.** DESIGN's C9
   sibling-form claims and the Q4 name-clash question are unverified.

