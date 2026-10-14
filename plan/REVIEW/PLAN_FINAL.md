# REFACTOR PLAN — final, in sync with REVIEW Rounds 1–5 (2026-10-14)

**This file is the only binding plan.** It supersedes the "Suggested order" in `REVIEW.md`.
Nothing here is decided; operator gates are marked G1–G7.

IDs: F = `REVIEW.md` round 1, R2.x = round 2, E = `ROUND3_ERIS.md` (reference-design comparison),
R4.x = `ROUND4_CONFIG.md`, Q = `ROUND5_IDEAS.md`. The reasoning for every ID lives there.

**Verified in source (2026-10-14):** `package.json` `files[]` has no `skills/` (F1); `tools.ts`
builds `new LexicalEngine()` without config, so `snippetWindow` is ignored (R4.2);
`PREVIEW_HEAD_CHARS = 300` and `sample_links` (5) are hard-coded (R4.1); `mission_status`
advertises the unregistered `discovery_search` (F4); `allowlist` defaults to `'on'` and a missing
file denies every fetch (F2).

**North star:** a local model in a real `dsh` session, using only the plugin tools, finishes a
3-entity PartnerDaten mission, and every number in `mission.md` passes the claim check.

**Rules for every phase:**
1. ≥1 acceptance check against a **real model transcript**, not only `execute()` scripts.
2. **No model-size assumptions.** Every size and limit is a config knob tuned to the rig.

---

## Order changes after Rounds 3–5 (what moved, and why)

| # | Change | Why |
| --- | --- | --- |
| 1 | **A minimal transcript harness moves from R5 to R0.** | The rule "every phase has a model-in-loop check" was impossible: the harness only existed in R5. R0 now builds the smallest version (run a prompt, save the transcript, score a few things); R5 extends it into the full DoD. Saved runs become the Q6 regression set from day one. |
| 2 | **The claim check (Q1) moves ahead of the read tool,** and becomes the first item of R2. | Ranked highest. It reuses `check-s1-dod.mjs`, needs no new design decisions, and is the same code that scores every later transcript. It also shows *which* claims fail, which tells you how much the read tool is needed. |
| 3 | **Tool-surface design is decided once, in R1, covering the final set.** | The old plan said "≤4 tools" (1.8) and then added read, verify and search in R2/R3. These contradict. Decide the end state (names, which tools, which merge) once, so descriptions (2.5) are written once and the model-facing surface does not change three times. |
| 4 | **The name-clash check (Q4) moves into R0;** any rename joins the R1 surface decision. | A rename is cheap only before descriptions, skill and README are rewritten. |
| 5 | **Gate defaults are decided together in R1** (allowlist + depth + host limits). | Q5 and R2.1 are the same question: which refusals are on by default. One decision, one config pass. |
| 6 | **The config pass (1.6) must land before the read tool (2.2).** | The read size is a knob (R4); building `mission_read` first would hard-code it. |
| 7 | **"Mark page text as untrusted" (Q2) goes into R2 with the read tool.** | The read tool is when large page text starts reaching the model; one output-format pass with field order (E7). |
| 8 | **Search (R3) stays after R2.** | Unchanged: URL sourcing only matters once read + verify prove the loop works. |

Net effect: R0 grows (diagnosis + harness), R1 becomes "decide once, then quick fixes",
R2 becomes "verify, then read".

---

## R0 — Diagnose and measure (no plugin code)

1. Count installed tools:
   `grep -c 'name: "mission_' ~/.dsh/profiles/web/node_modules/dsh-local-web-missions/lib/index.js` → expect 6.
2. Install path: symlink to this repo or npm copy? (decides whether F1 hit)
3. Host log: `skill file unreadable` / `skills face unavailable`?
4. Save the failed session's transcript to `plan/REVIEW/evidence/`.
5. **Q4:** do `dsh-local-long-horizon` tools or notes also use "mission"?
6. **Minimal transcript harness:** one script that runs a fixed prompt in a real `dsh` session on
   the rig, saves the transcript + store snapshot, and scores: tools called, unregistered tool
   names, refusals by code. Run it once on today's build = **baseline**.

Exit: a one-paragraph root cause + the baseline scores.

## R1 — Decide once, then quick fixes

**Operator gates (decide together):**
- G1 **Tool surface, final set and names** (E2, F7, Q4): e.g. implicit lifecycle; fetch, find
  (+expand or a separate read), search, verify/note; ≤ N tools; rename if Q4 confirms a clash.
- G2 **Gate defaults** (R2.1, E4, Q5): allowlist A/B/C; depth/host limits on or off by default.
- G3 **Knob shape** (R4.3): flat vs `numCtx`-derived; global config layer.

Then:

| # | Change | From | Size |
| --- | --- | --- | --- |
| 1.1 | Ship the skill (inline into the bundle, or add to `files[]`) + `npm pack` check | F1 | XS |
| 1.2 | Bug: `mission_find` reads `snippetWindow` etc. from config | R4.2 | XS |
| 1.3 | Remove the dangling `discovery_search` mention | F4 | XS |
| 1.4 | `/health`: registered `tools[]`, `skill: bool`, effective config | F7, R4.3 | XS |
| 1.5 | Allowlist per G2: template file on first use, distinct `allowlist_empty` error, `**` allow-all, denial text names the switch, pane shows the mode | F2, E4 | S |
| 1.6 | Config pass per G3: every hard-coded size becomes a knob (preview, sample links, find limits, min token length, recents cap, read size); global layer | R4.1 | S–M |
| 1.7 | Apply G1 surface (lifecycle/merge/rename) — mechanics only; descriptions come in R2 | E2 | M |
| 1.8 | README truth pass (seeds claim, store layout, privacy) | F13 | S |

Model-in-loop check: the harness on a fresh project with no config ("fetch dkb.de and summarise")
succeeds or fails with a message the operator can act on. Compare with the R0 baseline.

## R2 — Verify what was written, then read what was stored

| # | Change | From |
| --- | --- | --- |
| 2.1 | **Claim check** (`mission_verify` and/or at stop), reusing `check-s1-dod.mjs`: citations resolve to non-thin artifacts; numbers appear verbatim; number-format rule as a knob. Also becomes the harness scorer | Q1 |
| 2.2 | Read path per G1 (a paged chunk reader `{ artifact_id, chunk }` → text + quality + `chunk_count`, zero budget cost; or find `expand`); size from config, so 1.6 lands first | F3, E3 |
| 2.3 | Output pass: diagnostics-first field order; page text marked untrusted | E7, Q2 |
| 2.4 | `mission_md_path` in results; skill appends a note after **every** source | F10, Q3 |
| 2.5 | Descriptions written once for the final surface: 2–3 sentences, a `when_not_to_use` line, one bad example; hints name the next tool and say it exists | F8, E6 |
| 2.6 | Skill ritual: `fetch → find → read → note → verify → stop` | Q1, Q3 |
| 2.7 | `suggest_stop` on find | E7 |

Model-in-loop check: every number in `mission.md` passes 2.1; every cited chunk was read through a
tool in the transcript.

## R3 — URL sourcing

Gate G6: DuckDuckGo acceptable, or SearXNG only? Search budget cost? Search runs through
browser39, never through a cloud search service in dsh.

| # | Change | From |
| --- | --- | --- |
| 3.1 | `mission_search`: fetch a results page from an engine template through the normal gates, then find over it | F4, E5 |
| 3.2 | Rate-limit handling (search budget or cooldown, as knobs); a blocked engine gives an honest error | R2.4 |
| 3.3 | Ledger `origin: seed\|link\|search\|unsourced`; results flag `unsourced` | F9 |
| 3.4 | (optional) 404/410 on `unsourced` URLs cost no budget | F15 |

Model-in-loop check: a mission with no seeds finds and fetches ≥3 real entity pages, zero
`unsourced` rows.

## R4 — Long-horizon robustness

| # | Change | From |
| --- | --- | --- |
| 4.1 | Continue past budget exhaustion (`continues` / `extend`) | F11 |
| 4.2 | Pane and tools use the same store; the pane shows the root | F6 |
| 4.3 | Revisit G2 gate defaults with the transcript evidence | Q5, Q6 |
| 4.4 | Drop the undeclared `chunkChars` arg; reconsider tracking-param normalization | F12, F14 |

## R5 — Full DoD (extends the R0 harness)

- The S1 prompt, 3 → 10 entities, real local model, only plugin tools + file write.
- Score: no unregistered tools, zero surprise refusals, claim check passes, citations resolve to
  `full` artifacts, zero refetch loops.
- Every run saved as the regression set (Q6); re-run on any model, knob or description change.
- Keep the existing smoke/accept scripts as the host regression suite.

---

## What NOT to do

- Do not rewrite the store, cache, budget or fence. They are the good part.
- Do not add consent tactics or search engines before R2 proves verify + read.
- Do not let a long-horizon run take R1–R5 unattended without the model-in-loop checks.

## Decisions needed (in order)

1. G1 tool surface + names (after the R0 Q4 check)
2. G2 gate defaults (allowlist A/B/C; depth/host on/off)
3. G3 knob shape + global config layer
4. G4 claim check: tool, at stop, or both; number-format rule (2.1)
5. G5 read shape (2.2), if not already settled in G1
6. G6 search engine policy + budget cost (R3)
7. G7 target model + harness build. No size assumption: record model, quantization and `num_ctx`
   with every saved run.
