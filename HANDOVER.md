# HANDOVER — Cursor rescue of dsh-web-missions (product loop)

*For a fresh Cursor agent. Disk = law. Local commits only — **never `git push`**
(origin exists: `janpauldahlke/dsh-web-missions`). Sacred: never kill `:3080` /
`:8080` / `:11434`.*

**Ports while operator naps:** `:8080` (Hauhau) and optionally `:3080` stay up —
**reuse, never restart/kill.** `:3090` acceptance: if free, **you may boot once**
via `./scripts/boot-3090.sh` (cwd = this repo); if already up, reuse. Never
`pkill dsh` / `pkill node`.

**Goal of this handover:** finish the plugin so the operator can:

1. Start **dsh** on the usual local stack (**Hauhau / llama `:8080`**, profile
   `web`, chat on `llama-local`) — no cloud chat model required.
2. Run **web-missions** whose retrieve path is **browser39 only** (npm dep /
   `BROWSER39_BIN`) — pages fetched, stored, found, read, cited.
3. Optionally use **discovery** via the local companion (SearXNG and/or
   `browser39 search`) — still no cloud LLM search in dsh.

A real local model in a real dsh session, using only plugin tools, must complete
a short web mission without seeking ghost tools or inventing numbers. Host
M0–M9 is already green; **this product loop is not.**

---

## 1. Idea (one breath)

Out-of-tree DSH plugin **`dsh-local-web-missions`**: persist + query for local
web research (missions on disk, receipts, lexical find, **deterministic
anti-refetch**), retrieve via **browser39** — no cloud LLM search (ISO/DSGVO).

Companion **`dsh-local-web-discovery`** at `~/dev/dsh-web-discovery`: optional
SearXNG / `browser39 search` → candidate URLs → core only sees URLs in/out.

Inspiration: Eris `src/tools/web/` (short-lookup). This repo aimed at
**long-horizon + verbatim numbers** — Eris never proved that regime.

---

## 2. Current state (2026-10-14)

| Layer | State |
| --- | --- |
| Host phases M0–M9.3 | **GREEN**, committed through `b979982` / review docs `9f113ea` |
| Vault / long-horizon | Was marked DONE for overnight agent; **product rescue is NOT done** |
| Profile install | Symlink: `~/.dsh/profiles/web/node_modules/dsh-local-web-missions` → this repo |
| Tools in `lib/` | `mission_start\|list\|status\|fetch\|find\|stop` (6) — **registered in code** |
| Discovery companion | Built & M7-green; **NOT in profile bundles** |
| Operator test | Failed: model sought tools that felt “not registered” / stuck on lifecycle; could not complete a real web mission |
| External review | `plan/REVIEW/` (INDEX → REVIEW → ROUND3–5 → **PLAN_FINAL.md**) — no code changed by review |

**Truth:** overnight optimised for host AC (`execute()` smokes). Operator asked
for **agent-in-the-loop**. Different finish lines.

---

## 3. What is lacking (save list)

Binding roadmap: **`plan/REVIEW/PLAN_FINAL.md`** (R0–R5). Do **not** rewrite
store/cache/budget/fence.

### Must fix for “usable by a model”

1. **Ghost discovery** — `mission_status` still mentions `discovery_search` while
   companion is not on the profile → model hunts missing tools.
2. **No read path** — only preview (~300) + find snippets; no `mission_read` →
   invents “verbatim” numbers (F3).
3. **Skill not in npm `files[]`** — local symlink OK; publish path broken (F1).
   Still ship skill into bundle / `files[]`.
4. **`snippetWindow` bug** — config knob ignored; `tools.ts` builds
   `new LexicalEngine()` with no config (R4.2).
5. **Allowlist UX** — default `on` + missing file = deny-all; no template seed;
   README “seeds exempt” is false (F2/E4).
6. **No claim check in-loop** — `scripts/check-s1-dod.mjs` exists but nothing
   runs it during a mission (Q1 — highest leverage).
7. **No model-in-loop DoD** — need transcript harness (R0/R5).
8. **Tool descriptions too long / lifecycle-heavy** — 6 tools, 4 bookkeeping;
   Eris uses 3 with implicit lifecycle (E2).

### Nice / later (R3–R4)

- Pane cwd vs `process.cwd()` mismatch (F6)
- Budget continue/extend (F11)
- Eris-style `mission_search` fold vs companion-only
- utm tracking in cache key (F14)

---

## 4. Locked leans (so Cursor is not blocked)

Operator asked to **finish** this. Until he overrides, treat these as decided:

| Gate | Lean |
| --- | --- |
| **G6 Discovery** | **KEEP companion.** Add `dsh-local-web-discovery` to the web profile bundles (link `~/dev/dsh-web-discovery`). Document in README. Until wired: **remove** dangling `discovery_search` text from tool descriptions. Eris-fold `mission_search` = later R3, not blocking. |
| **G2 Allowlist** | Default **`off`** (opt-in). Dogfood may set `on` in project config. Port Eris survivability: seed template file on first need, distinct `allowlist_empty`, support `**` allow-all pattern, denial text names the switch. |
| **G5 Read** | Add **`mission_read({ artifact_id, chunk?, mission_id? })`** — one chunk, zero budget, quality + text. Size = config knob. |
| **G4 Claims** | Auto check at **`mission_stop`** + optional **`mission_verify`** tool; reuse `check-s1-dod.mjs` logic. |
| **G1 Surface** | Keep existing 6 names for now; **add** `mission_read` (+ `mission_verify`). Shrink descriptions to 2–3 sentences. Q4 rename (`web_*`) only if long-horizon clash confirmed. |
| **G3 Knobs** | Flat knobs first (`previewChars`, `snippetWindow` wired, `readChars`, find limits). Global `~/.dsh/web-missions/config.json` layer after flat works. |
| **G7 Model** | Local Hauhau IQ4 @ 128k / reasoning medium / budget 4096; record in every transcript run. |

---

## 5. Execution order (Cursor)

Follow **PLAN_FINAL** with leans above. Never stop after one phase while R0–R2 remain.

1. **R0** — Diagnose: `grep -c 'name: "mission_' …/lib/index.js` (expect 6+ after read);
   confirm install path; save any failed transcript under `plan/REVIEW/evidence/` if found;
   Q4: skim `dsh-local-long-horizon` tool names for “mission” clash; minimal transcript
   harness stub (even if human must boot `:3090`).
2. **R1** — Skill in `files[]` (or inline); fix `snippetWindow`; strip/fix discovery
   mention; wire companion to profile; `/health` → `tools[]`, `skill`, effective config;
   allowlist lean; README truth pass.
3. **R2** — Claim check + `mission_read`; mark page text untrusted; `mission_md_path`;
   short descriptions; skill ritual `fetch → find → read → note → verify → stop`.
4. **R3+** only after a model transcript proves read+verify help.

**Verify culture:** every slice → build → smoke/accept where applicable → **local commit**.
≥1 model-facing check when `:3090` is up (human boots). If `:3090` down → continue
hermetic unit/smokes; record blocker, don’t invent ports.

---

## 6. House rules / Cursor blockers

| Rule | Detail |
| --- | --- |
| Git | **Commits OK. Never push.** Never force-push. |
| Ports | Never kill `:3080` / `:8080`. `:3090` = `scripts/boot-3090.sh` only; prefer reuse; boot yourself if free (operator AFK). |
| Finish line | Local Hauhau + browser39 mission loop works end-to-end (read + verify); take as long as needed; commit locally; **no push**. |
| Keys | Never print `.env.local` / `COMPACT_API_KEY`. |
| Plans | `plan/REVIEW/PLAN_FINAL.md` is binding for rescue. Old M0–M9 phase files = history of host build. |
| Status | Prefer vault/`STATUS.md` updates when long-horizon on; else append to this file’s log + slice commits. |
| Siblings | `skills/dsh-out-of-tree-plugin/SKILL.md` + `SIBLINGS.md`. |
| Compaction | Akqui thinking-off already fixed in `~/.dsh/profiles/web/cordis.patch.yml` — don’t regress. |

**Will plans block Cursor?** Only if you wait on undecided gates — **leans in §4 remove that.**
Real blockers: (a) human must boot `:3090` for live agent transcripts, (b) don’t touch sacred
ports, (c) no network publish. Everything else is local code.

---

## 7. Key paths

```
/home/hagbard/dev/dsh-web-missions          # this plugin (core)
/home/hagbard/dev/dsh-web-discovery         # companion (KEEP + wire)
plan/REVIEW/PLAN_FINAL.md                   # rescue plan
plan/REVIEW/REVIEW.md                       # F1–F15 + R2
plan/REVIEW/ROUND3_ERIS.md                  # Eris comparison
plan/PROTOCOL.md                            # overnight discipline
skills/dsh-out-of-tree-plugin/{SKILL,SIBLINGS}.md
scripts/boot-3090.sh
scripts/check-s1-dod.mjs                    # claim-check seed
```

---

## 8. First Cursor actions

1. Read this file + `plan/REVIEW/PLAN_FINAL.md` §R0–R2.
2. Confirm tools in live lib; note discovery not in profile.
3. Start R1.1–R1.3 (skill ship, snippetWindow, discovery mention) — XS, unblocks honesty.
4. Profile-add discovery companion (link) + README Requirements.
5. Implement `mission_read` + stop-time claim check.
6. Local commits after each green slice. **No push.**

**Operator smoke (definition of “it works”):**

```text
:8080 llama (Hauhau) up → dsh web (:3080 or :3090)
→ mission_start → mission_fetch (browser39) → mission_find → mission_read
→ mission_verify / stop with citations that resolve to stored full pages
```

No DeepSeek/Exa cloud search. Discovery companion optional. Show transcript proof
for one entity without ghost-tool thrash.

---

*Created 2026-10-14 for Cursor continuation. Operator: Hagbard. Prior overnight: M0–M9 host.*

---

## 9. Rescue log (Cursor)

**2026-10-14 — R0–R2 GREEN (product loop)**

- R0: 6→8 tools after read/verify; symlink install; Q4 no clash; evidence in
  `plan/REVIEW/evidence/`; harness `scripts/transcript-harness.mjs`.
- R1: skill in `files[]` + assets; `snippetWindow` wired; discovery companion
  linked into `~/.dsh/profiles/web`; allowlist default **off** + template /
  `allowlist_empty` / `**`; flat knobs + global config layer; `/health` reports
  `tools[]`, `skill`, `config`.
- R2: `mission_read`, `mission_verify`, stop-time claim check; short
  descriptions; skill ritual `fetch → find → read → note → verify → stop`.
- Prove: `node scripts/prove-product-loop.mjs` ALL GREEN; live `:3090` health
  shows 8 tools + skill + allowlist off. Sacred `:3080`/`:8080` untouched.
- Local commits only — **never pushed**.
