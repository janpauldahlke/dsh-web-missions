## Long horizon
Before coding, read `.dsh/task-status-inject.md` if present — it is binding
current task state (DeepSeek Harness injects this AGENTS.md; the inject file is
the live board).
You **must** use status_* tools to update Next (≤3), in-flight, done (with verify), and blocked.
Do not invent a parallel STATUS novel; the vault owns truth and STATUS.md is generated.
There might be deeper used Status files in e.g. `/plan/**` which are deeper level plans status and should be reflected on toplevel.
never stop after a phase in a subplan, when there are more phases left! You are a full plan implementer!

## Protocol guidance
- in case of doubt abouzt the rules here: see the `/PLAN/PROTOCOL.md`
- in case of memento what this project is about see `PLAN.md`or `/PLAN/KICKOFF.md`

## Acceptance `:3090` (keys + boot)
- Boot **only** via `scripts/boot-3090.sh` (sources gitignored `.env.local`, strips
  `DSH_*` session vars, unsets `LLAMA_API_KEY*` — stub is **`LLAMACPP_API_KEY`**).
- Prefer: human boots once; agent **reuses** (`curl` plugin `/health`). Sacred:
  never kill `:3080` / `:8080`. Never `pkill dsh` / `pkill node`.
- If restarting `:3090`: kill only the pid from `ss -ltnp | grep ':3090'`, then
  re-run the script. Never print `.env.local` / keys into chat, logs, or commits.
- Details: `plan/PROTOCOL.md` §5 · `plan/KICKOFF.md` §4 · `.env.local.example`

## DSH plugin how-to (always available)
- Packaging / install / dual-face / `:3090` scars:
  **`skills/dsh-out-of-tree-plugin/SKILL.md`** — read this in M0/M1 and whenever
  load, bundle, client, or acceptance boot is unclear.
- **Sibling atlas** (reuse solved patterns from `~/dev/dsh-*`):
  **`skills/dsh-out-of-tree-plugin/SIBLINGS.md`** — memento, long-horizon,
  gpu/slot/processes, akqui preset. Copy patterns, not whole trees.
- If the skill still disagrees with reality: check **installed** harness code at
  `~/dev/deepseek-harness` (`DSH_ROOT`, pin **0.2.1-alpha.2** / tag `dsh-v0.2.1-alpha.2`).

## Definition of DONE
- the whole plan in `/PLAN/**` is covered