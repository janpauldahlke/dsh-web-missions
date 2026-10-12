# PROTOCOL — how the build runs

Status: **frozen 2026-10-12** (peer planning, Dynamis + Hagbard)
Applies to: the implementer (currently Dynamis, in-session) and any future overnight agent.

---

## 1. Roles

| Role | Who | Job |
| --- | --- | --- |
| Implementer | Local agent (Dynamis) | Small slices → verify → record. Owns the vault. |
| Operator / reviewer | Hagbard | Drives direction, calls sub-decisions, publishes. |

The implementer is *not* the rubber duck: it writes code, then defends it with
verify evidence. The operator does not run tests on the agent unless he says so.

## 2. Three-level status (the only progress system)

- **Top level = long-horizon vault** (`status_*` tools, generated `STATUS.md` +
  `.dsh/task-status-inject.md`). It tracks **all** phases M0→M9: current phase,
  Next (≤3), in-flight slice, done list (each with verify evidence), blocked.
- **Deep level = `plan/M_<n>_<name>.status.md`** — the phase's slice board:
  phase state, slice table with verify evidence, append-only dated log. This is
  the deeper-level plan status.
- **Design level = `plan/M_<n>_<name>.md`** — deep design for exactly one
  phase; frozen except dated amendments. No progress tracking inside it.
- **Reflect rule:** any deep-level change is reflected to the top level in the
  *same working step* — phase state change → vault phase/Next; slice verified
  → slice board evidence + vault done line (with verify). The vault never lags
  the slice board.
- **No parallel STATUS novel.** No hand-written `plan/STATUS.md`. The vault
  owns top-level truth; the slice board owns in-phase truth. If a plan file
  and the vault disagree: the plan file's *design* wins; the vault's
  *progress* wins.
- Resume = read the inject file → read the current phase file **and** its
  status file → continue the in-flight slice. That is the whole interruption
  story: disk = law, chat = amnesia.

## 3. The loop

```
read phase file → small slice → verify (evidence) → vault record → next ≤3
```

1. Open the phase file, implement only what its **Green** line requires.
2. Run its **Verify** checks. No "should work" — evidence is command + expected
   output, or a named assertion.
3. Record: `status_mark_done` with the verify evidence; refresh `next` (≤3);
   set the next in-flight slice.
4. Local `git commit` after each verified slice. Conventional-ish messages
   (`m0: dual-face scaffold, /health green`).

## 4. Full-plan implementer — no stopping after a phase

- The implementer runs the **whole plan**: once implementation starts,
  continue through **all remaining phases** — never stop after a phase in a
  subplan while phases are left. Stopping is allowed only on: (a) operator
  stop, (b) a recorded blocked state, (c) end of the run window. In all three
  cases the slice board + vault must be current so resume is clean.
- A phase is green only when its Verify section passes **in full**. No partial
  greens get recorded as done.
- In-flight is **always** a small slice named after what it will produce.
- After every verified slice: commit + slice-board evidence + vault record
  (done + verify + next) + reflect (rule in §2).
- On resume: inject file is binding current state. If the in-flight slice is
  ambiguous, run `status_get` and re-read the phase file + status file before
  touching code.

## 5. Ops guardrails (do not violate)

| Rule | Detail |
| --- | --- |
| Sacred ports | `:3080` (dsh web), `:8080` (llama), `:11434` (ollama) — never kill/restart. |
| Acceptance | `:3090` via **`./scripts/boot-3090.sh`** only (sources gitignored `.env.local`; unsets `LLAMA_API_KEY*`; strips `DSH_*` session vars; stub `LLAMACPP_API_KEY` — checked-in reference: `.env.local.example`). cwd = this repo. Prefer: human boots once; agent reuses via `curl /health`. See KICKOFF §4 / root `AGENTS.md`. |
| Keys | Never print `.env.local` or its values into chat, logs, STATUS, or commits. `.env.local` is gitignored (chmod 600); `.env.local.example` is the checked-in template. |
| Port hygiene | Never `pkill dsh` / `pkill node`. Identify pids via `ss -ltnp`; kill only the specific acceptance pid. |
| Git | Local commits only. **Never push** unless Hagbard asks. Never force-push. |
| ENV.md | Gitignored. Holds pins (harness **0.2.1-alpha.2**, `BROWSER39_BIN`, browser39 version, allowlist notes, chunkChars). |
| Plugin skill | `skills/dsh-out-of-tree-plugin/SKILL.md` — first stop for M0/M1 packaging. Harness tree only after that. |
| Stale acceptance | A running `:3090` may answer from a stale build. After host-half changes, verify the route reflects the latest build before trusting it. |

## 6. Drift protocol

- Frozen decisions **D1–D12** (PLAN.md §3) are closed. Reopening requires Hagbard to open them.
- If reality contradicts a plan file: **the file wins over chat**, but the file
  gets a dated amendment (or a seam noted with a lean), not a silent deviation.
- If a plan file contradicts PLAN.md: PLAN.md wins; note the drift for the next review.
- Seams S1–S8 (HANDOVER §5) are `proposed` — each phase file states which seams
  it consumes and how, so decisions get made *at the phase that needs them*.

## 7. Scope discipline

- Each phase does its Green line + its own sub-decisions. Nothing from a later
  phase gets pulled forward unless this file says so.
- Anti-creep is explicit in every phase file's **Scope guard** section.
- Dewey (`deweyHarness`) is a *later consumer* of this pattern — never build
  for it yet; keep the `web:`/`corpus:` trust split in mind only.

## 8. Done / ship

- **Phase green** = Verify section fully passing + vault done-item with evidence + commit.
- **Ship bar** = M0–M5 green.
- **Proof** = M8 smoke: `aggregiere PartnerDaten` over the fixture set, with a
  second `mission_fetch` of the same URL asserting `cached: true` and **no
  second browser spawn**.

## 9. Context hygiene (the memento rule)

Compaction erases context; only what is on disk survives. Work so that losing
the context costs nothing:

- **One work unit per turn.** A unit = one small, verifiable slice (one file,
  one tool, one route, one config knob) — **not** a whole phase, and never a
  batch of phases in one prompt. Small unit, clean seam.
- **Persist before the turn ends.** Every turn closes with: slice-board
  evidence + vault (in-flight / done / next) + local `git commit`. The disk is
  the only memory that outlives compaction.
- **Let compaction land between units, not inside one.** If a unit is getting
  big, that's the signal to split it and commit at the seam — don't ride a
  giant context until it nausea-compacts mid-thought.
- **Reconstruct from disk on resume.** Never rely on "what I was thinking."
  Read the slice board + vault status + the relevant phase-file section, then
  continue. Disk = law, chat = amnesia (and context = amnesia too).
- **The rule scales down, not up:** if a phase is genuinely one small file,
  one turn is fine — but never pad a turn to look busy, and never defer the
  persist to "later in the same prompt."
