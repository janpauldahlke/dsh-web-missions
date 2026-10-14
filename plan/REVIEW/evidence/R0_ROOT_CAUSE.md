# R0 — Root cause (2026-10-14)

## Diagnose facts

| Check | Result |
| --- | --- |
| Tool count in installed `lib/index.js` | **6** (`mission_start\|list\|status\|fetch\|stop\|find`) |
| Install path | **symlink** → `/home/hagbard/dev/dsh-web-missions` (F1 does not hit local; still breaks npm pack) |
| Discovery companion in profile | **absent** (`dsh-local-web-discovery` not in `~/.dsh/profiles/web` bundles) |
| Q4 long-horizon clash | **none** — LH tools are `status_*` only; no `mission_*` |
| `:8080` / `:3080` | up (reuse); `:3090` free for acceptance |
| Failed operator transcript | not found on disk; no `skill file unreadable` in recent `~/.dsh/logs` |

## Root cause (one paragraph)

The host AC path (M0–M9 `execute()` smokes) is green, but the **agent loop is not**.
`mission_status` advertises `discovery_search` while the companion is not on the profile,
so the model hunts a ghost tool. There is no `mission_read`, only ~300-char previews and
±120 snippets, so verbatim numbers are invented. Allowlist defaults to `on` with a missing
file = deny-all, which blocks first fetches on a fresh project. The workflow skill lives on
disk via the symlink but is omitted from `files[]` (publish break). `snippetWindow` is a
config knob that `tools.ts` never passes into `LexicalEngine`. No claim check runs at stop.

## Baseline (pre-rescue scores)

Harness stub: `scripts/transcript-harness.mjs`. Live baseline deferred until `:3090` boots
with R1–R2 fixes. Expected pre-fix failure modes: ghost `discovery_search`,
`allowlist_denied` on first fetch (if allowlist on + empty file), no `mission_read` /
`mission_verify` in tool list.
