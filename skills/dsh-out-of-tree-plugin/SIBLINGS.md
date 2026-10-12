# Sibling atlas — local `~/dev/dsh-*` exemplars

Lab plugins already on this box. **Copy patterns, not whole trees.** Prefer
this atlas + `SKILL.md` over re-grepping the harness. If a sibling disagrees
with the **installed** pin (`dsh-v0.2.1-alpha.2`), the pin wins — note drift in
STATUS and keep shipping.

All paths absolute under `/home/hagbard/dev/`. Linked into the `web` profile
via `~/.dsh/profiles/web/package.json` (`dsh.profile.bundles`).

## Dual-face out-of-tree (steal for M0–M1 / pane / routes)

| Repo | npm `name` | Steal for |
| --- | --- | --- |
| `dsh-memento` | `dsh-local-memento` | Full dual-face reference: `boot-3090.sh`, `.env.local` / `LLAMACPP_API_KEY`, `/health`, rightbar pane, host routes, vault-style disk, inject scars |
| `dsh-local-long-horizon` | `dsh-local-long-horizon` | Project-scoped store under `<cwd>/.dsh/…`, tools + pane, STATUS/Next ritual |
| `dsh-agent-processes` | `dsh-agent-processes` | `webServer.register` + tools + rightbar tab |
| `dsh-gpu-monitor-nvml` | `dsh-gpu-monitor-nvml` | Host poll route + client pane; register at `apply` top level |
| `dsh-local-endpoint-health` | `dsh-slot-health` | Slot collector + `/api/dsh-slot-health`; corrections in `SKILL.md` |

## Preset only (not a dual-face template)

| Repo | npm `name` | Steal for |
| --- | --- | --- |
| `dsh-preset-standard-akqui-compact` | `dsh-preset-standard-akqui-compact` | Agent-preset `cordis.patch.yml` shape only. Persona vars = `provider`\|`model` (no `{{cwd}}` — runtime-context owns cwd since 0.2.1). Do not copy as a plugin scaffold. |

## This repo

| Repo | npm `name` | Note |
| --- | --- | --- |
| `dsh-web-missions` | `dsh-local-web-missions` (planned) | You are here. Acceptance cwd = this repo; `:3090` via `scripts/boot-3090.sh`. |

## Hard rules when reading siblings

1. **Patterns over paste** — lift route shape, `dsh.bundle`/`dsh.client`, build.mjs, pane inject; rewrite IDs/names for this package.
2. **Sacred ports** — never kill `:3080` / `:8080` while reading or dogfooding siblings.
3. **Acceptance cwd** — boot `:3090` from *this* repo, not from a sibling checkout.
4. **Open order** — `SKILL.md` → this file → sibling `src/` / `cordis.patch.yml` → harness pin only if still stuck.
