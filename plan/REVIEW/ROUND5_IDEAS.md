# Round 5 — ideas beyond the review (2026-10-14)

Part of the review in `REVIEW.md`. **None of these are decided.** They are input for the operator
to consider; each notes what it builds on.

## Q1 · Check claims after writing, not only before (highest leverage)

Everything so far tries to *prevent* made-up facts: read tools, hints, honesty fields. A
deterministic **check after writing** is more reliable, and most of the code already exists:
`scripts/check-s1-dod.mjs` checks citations against the ledger. Today nothing calls it during a
mission.

As a `mission_verify` tool, or an automatic check at `mission_stop`, it would:
- confirm every `[p-…](url)` resolves to a stored artifact that is not `thin`/`blocked`;
- confirm every number in a cited sentence appears verbatim in that artifact's chunks;
- return the failing claims so the model fixes them.

Why it matters: it works the same for any model size (no model assumptions, Round 4). It turns
"don't hallucinate" from a request into a check. **Rank: above `mission_read` (F3).**
Builds on: assertion A2, `check-s1-dod.mjs`, the F10 `mission_note` idea.
Limits to be honest about: verbatim matching catches invented numbers and dead citations; it does
not catch a wrong *interpretation* of a correct number. Number formats ("3,75 %" vs "3.75%") need
a normalisation rule, set by a knob.

## Q2 · Prompt injection from fetched pages is not addressed

Fetched pages are untrusted text. A long mission over many unknown pages is exactly where
"ignore previous instructions…" reaches the model's context. Neither Eris nor this plugin treats
page text as data rather than instructions.
- Cheap first step: clearly mark returned page text (preview, snippets, a future `mission_read`)
  as untrusted content in the tool output, and say so in the skill.
- Open question: stronger measures (e.g. stripping instruction-like lines) risk damaging real
  content. Decide deliberately.

## Q3 · Long missions fail at compaction, not at fetching

The store survives context compaction; the model's half-finished conclusions do not. The skill
writes `mission.md` once, at the end.
- Better: append a short note to `mission.md` **after every source** (findings + `artifact_id`).
  A resumed or compacted session continues from disk, not from memory.
- Fits the long-horizon "disk = law, chat = amnesia" pattern. Pairs with F10 (a path or
  `mission_note`) and Q1 (each note can be verified as it is written).

## Q4 · Possible name clash with `dsh-local-long-horizon`

This plugin uses "mission" for a web research job; the long-horizon plugin also manages multi-hour
work. With both loaded, a model may mix up *which* mission it is in. That could be one more
explanation for the confused test session (F7).
- **Unverified:** the long-horizon plugin was not read in this review (self-critique #9).
- If its tools or notes use the same word, consider a rename (`web_*` / `research_*`). Cheap now,
  expensive after publishing.

## Q5 · Four gates may be too many for a single-operator rig

Budget, allowlist, depth limit and host limit each refuse fetches with their own error code. Each
is another way a long mission stalls, and each refusal is a turn the model must interpret.
- Option: budget plus an optional allowlist on by default; depth and host limits as knobs **off by
  default**, for operators who want crawl bounds.
- Keeps the zero-cost pre-fetch design (the good part) and only changes defaults. Fits Round 4
  ("everything a knob").

## Q6 · Keep agent transcripts as a regression set

Once R5 (the agent-in-the-loop DoD) runs, save every transcript with its scores. When the model, a
knob or a tool description changes, re-run and compare.
- Catches *behaviour* drift the way the existing smoke scripts catch host bugs.
- Also builds the evidence for later decisions (Q5 defaults, F8 description length, E2 tool count).

## Summary

| # | Idea | Effort | Depends on |
| --- | --- | --- | --- |
| Q1 | Check claims after writing (`mission_verify` / check at stop) | S–M | reuse `check-s1-dod.mjs` |
| Q2 | Mark page text as untrusted | XS | skill + tool output |
| Q3 | Incremental `mission.md` notes | XS–S | F10 |
| Q4 | Check for the "mission" name clash | XS (check) | read long-horizon |
| Q5 | Fewer gates on by default | XS | Round 4 config pass |
| Q6 | Transcript regression set | S | R5 DoD |

If only one: **Q1.** It reuses existing code and comes closest to "doesn't hallucinate".
