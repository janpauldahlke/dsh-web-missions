# Round 4 — no model-size assumptions; every limit is a config knob (2026-10-14)

Part of the review in `REVIEW.md`.

**Operator correction:** the rig now runs a 27B model at Q4 locally. Earlier review wording that
assumed small (7–9B) models is withdrawn. That affects the `REVIEW.md` verdict, F7.3, F8, and E2
in `ROUND3_ERIS.md`.

**Principle for the redesign:** the plugin does not guess the model. Every size, limit and count is
a config knob with a sane default, tuned by the operator to the local setup.

### Corrections to `REVIEW.md` wording

| Where | Old | Corrected |
| --- | --- | --- |
| Verdict (b) | "cannot read a stored page beyond about 300 + 240 chars" | Pages are only visible through fixed windows: preview 300 chars (hard-coded) and snippet ±120 (a config knob the tool ignores, R4.2). No tool reads a whole chunk. |
| Verdict (c) | "is denied every fetch on a fresh project" | …unless the operator set the allowlist or turned it off |
| F7.3 | "small local models often summarize the tool list" | Without the skill (F1), nothing names fetch/find as the core loop, whatever the model size |
| F8 | "Local 7–32B models handle … better" | Long descriptions cost context on every turn for every model. A context-budget argument, not a model-size one |

## R4.1 · Inventory: knob today vs hard-coded

| Value | Where | Today | Knob? |
| --- | --- | --- | --- |
| `chunkChars` (2000) | `config.ts` | knob | ✅ |
| `snippetWindow` (±120) | `config.ts` → `retrieval.ts` | knob **declared** | ⚠️ ignored by the tool, see R4.2 |
| `minTokenLength` (3) | `retrieval.ts` `cfg.minTokenLength` | engine option only | ❌ not in `config.ts` |
| find `limit` default 5 / max 20 | `retrieval.ts`, `tools.ts` schema text | hard-coded | ❌ |
| `preview_head` (300 chars) | `artifacts.ts` `PREVIEW_HEAD_CHARS` | hard-coded | ❌ |
| `sample_links` (5) | `fetch-service.ts` (2×) | hard-coded | ❌ |
| recents cap (50) | `store.ts` `RECENTS_CAP` | hard-coded | ❌ |
| `maxBytes`, `thinThresholdChars`, `fetchTimeoutMs`, `defaultFetchBudget`, `maxDepth`, `maxDiscoveredHosts`, `consentMaxAttempts`, `cacheHitCountsAsBudget`, `persistSessions`, `allowlist` | `config.ts` | knobs | ✅ |
| future read size (`mission_read`) | — | n/a | must be a knob from day one |

## R4.2 · Bug: the `snippetWindow` knob never reaches `mission_find`

`tools.ts` calls `runFind(root, new LexicalEngine(), …)` with no engine options, and
`find-service.ts` never calls `readConfig`. So `snippetWindow` in `config.json`, which the README
documents, has **no effect** on the tool, and the engine falls back to its default of 120. This is a
real defect, separate from the design questions.
Fix: build the engine from `readConfig(root)` (snippetWindow, minTokenLength, limits).

## R4.3 · Possible knob shapes (to decide, not decided)

- **Flat knobs** (status quo, extended): `previewChars`, `sampleLinks`, `findLimitDefault`,
  `findLimitMax`, `minTokenLength`, `readChars` (or `readChunks`), `recentsCap`.
- **One context-derived base plus overrides** (Eris pattern: in `budget.rs`,
  `num_ctx × vault_read_ratio` drives chunk, preview and snippet sizes): `numCtx` + `readRatio`, with
  defaults calculated from them and every derived value still overridable. Changing the model or
  `num_ctx` means one edit. This fits "we change rigs" best.

Either way:
- `readConfig` already validates and merges over defaults. Extend `FIELDS` and keep fail-loud.
- **Location:** today config is per project (`<cwd>/.dsh/web-missions/config.json`). Rig-level
  values (context size, budgets) fit better in a **global layer** (e.g.
  `~/.dsh/web-missions/config.json`) with project overrides. This also solves R2.1's "every new
  project starts locked again" for the `allowlist` knob.
- Show the **effective config** (merged, with the source of each key) in `/health` or the pane, so
  the operator sees what the model actually gets.

## R4.4 · Effect on earlier findings

| Finding | Change |
| --- | --- |
| F2 / R2.1 / E4 | The allowlist knob already exists. The fix is its **default, a global layer, and discoverability**. No model assumption involved. |
| F3 / R2.2 | `mission_read` returns a window sized by a knob. A large context can take whole chunks or several; a smaller rig sets less. Nothing hard-coded. |
| F8 | Stands, reworded: description length is a context cost, not a model weakness. |
| E1 | Eris's small defaults (budget 2/4) were rig- and use-case choices. Long missions need larger defaults, set as knobs. |
| E7 receipt order | Still worth doing (cheap, deterministic), but not argued from model size. |
