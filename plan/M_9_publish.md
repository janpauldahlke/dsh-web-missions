# M_9 — publish (sibling form-speak + public release)

Phase: **M9** · Status: not started (see `M_9_publish.status.md`)
Depends on: M0–M5 green (ship bar) + M8 proof. M6/M7 optional.
Timing: **post-ship** — M9 does not block the ship bar.

## Purpose

Align the package with the **sibling form-speak** (the five published `dsh-*`
plugins on this box) and prepare public release: public GitHub root, `dsh.pub`
submission, optional npm publish.

Form law: **C9** (DESIGN). Atlas: **`skills/dsh-out-of-tree-plugin/SIBLINGS.md`**.
Exemplar of record: `dsh-memento` (full dual-face reference). Copy patterns,
not whole trees; where a sibling disagrees with the installed pin, the pin wins.

## Scope

### 9.1 Package metadata (sibling form)

- `name`: `dsh-local-web-missions` (registry availability confirmed 2026-10-12;
  GitHub repo stays `dsh-web-missions` — memento precedent).
- `version`: **1.0.0** (sibling law: all published siblings are 1.0.x; no 0.x public).
- `description`: one sentence, what + for whom + negative scope (sibling style) —
  frozen in C9.
- `files`: `["lib", "cordis.patch.yml", "README.md", "LICENSE", "media"]`
  (sibling-identical; `plan/` + `skills/` stay out via files[]).
- `scripts`: `build` (`node build.mjs && tsc --noEmit`) + the sibling
  **`prepare` fallback** (build or warn, rely on prebuilt `lib/`) + `test` if
  tests exist.
- `repository` / `homepage` / `bugs`: `janpauldahlke/dsh-web-missions` triple.
- `keywords`: base block `dsh-plugin, deepseek-harness, deepseek-harness-plugin,
  dsh, cordis, cordis-plugin` + domain block + tail `sidebar, web-ui`
  (sibling shape; domain list in D-M9.4).
- `devDependencies`: `@types/node`, `@types/react` (pin to installed web shell),
  `esbuild`, `typescript` + `tsconfig.json` at root (sibling law).
- `dependencies`: `@aquintanar/browser39` 2.0.0 — the only runtime dep.

### 9.2 License + README (sibling form)

- `LICENSE`: **MIT**, header line identical to siblings:
  `Copyright (c) 2026 Jan (HagbardCeline) / janpauldahlke`.
- `README.md` in sibling form (order = memento's):
  1. title + one-sentence hook; npm-name note (repo `dsh-web-missions` ≠ npm
     `dsh-local-web-missions`).
  2. **Related plugins table** — links to all five siblings (sibling ritual).
  3. npm + source link line.
  4. "Verified against DeepSeek Harness **`0.2.1-alpha.2`**".
  5. Requirements (DSH web profile; Node ≥ 20; browser39 binary via
     `@aquintanar/browser39` optional-deps — no separate install, no cargo).
  6. Screenshots (2–3 pane shots in `media/`, taken from the M6 pane).
  7. Install (`dsh plugin --profile web add <path>` / npm), Usage
     (`mission_start` / `mission_fetch` / `mission_find`, config knobs),
     Privacy (local-only, no cloud search, allowlist + depth fence, consent).

### 9.3 Repo hygiene (public-root form)

- Repo root = npm package root = public GitHub root (sibling law).
- `lib/` **tracked** (sibling law; `prepare` falls back to prebuilt lib).
- Gitignore per C9: `ENV.md`, `.env` / `.env.*` / `*.key`, `node_modules/`,
  `dist/`, `*.log`, `.DS_Store`, `**/.dsh-session`, `.dsh/`, **`STATUS.md`**
  (generated here; memento's is hand-written — documented divergence).
- **D-M9.5:** `plan/` + `skills/` stay tracked as the design record
  (memento gitignores them as builder stuff; files[] keeps them out of the
  tarball).
- No secrets, no `ENV.md`, no `.dsh/` contents in the public tree (SKILL
  "Publish later" rules).

### 9.4 Release actions (operator-gated)

- `npm pack --dry-run` → exactly the files[] set, nothing else.
- Clean-room proof: fresh clone → `npm install && npm run build` →
  `dsh plugin --profile web add <clone>` → boot :3090 → `/health` (the install
  path a user would actually take).
- Push public GitHub repo (operator). Human submits
  https://dsh.pub/en/submit/ — no PR into harness core. npm publish optional
  (dsh.pub + GitHub is enough for discoverability — SKILL rule).
- Tag `v1.0.0` on the public repo.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | `npm pack --dry-run` | exactly `lib/`, `cordis.patch.yml`, `README.md`, `LICENSE`, `media/` — no plan/, skills/, ENV.md, .dsh/, STATUS.md |
| V2 | package.json field diff vs `dsh-memento` package.json | identical field set (modulo name / description / domain keywords / deps); base keyword block intact |
| V3 | README | renders: related-plugins table, media screenshots, install command, verified-against pin |
| V4 | clean-room install (fresh clone → add → :3090) | `/health` ok; Missions tab present |
| V5 | `LICENSE` | MIT + sibling copyright header |
| V6 | public-tree grep | no `ENV.md`, no `.env.local`, no `.dsh/` contents, no keys |

## Scope guard

- No new features in M9 — metadata, docs, packaging, release actions only.
- Version 1.0.0 comes from the scaffold (C9); M9 publishes it and patch-bumps
  only if M9 itself changed runtime behavior (it should not).
- No push / no submission without the operator; dsh.pub form is filled by a
  human.
- Commit after green: `m9: sibling form-speak + public release prep (README, LICENSE, media, dsh.pub)`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M9.1 | Names | npm `dsh-local-web-missions` / repo `dsh-web-missions` (memento precedent) |
| D-M9.2 | License | MIT, sibling header line |
| D-M9.3 | Version | 1.0.0 at publish (sibling law) |
| D-M9.4 | Keyword domain block | `mission, web-research, browser39, persist, cache, allowlist, local-agents, coding-agents` |
| D-M9.5 | `plan/` + `skills/` in public repo | tracked (design record); files[] keeps them out of the tarball |

## Seam consumption

- **C9** — born review #3 (2026-10-12); consumed by M0 (scaffold) and frozen
  green here.
- **SKILL.md "Publish later"** + **SIBLINGS.md** are the authorities;
  installed pin wins on conflict.
