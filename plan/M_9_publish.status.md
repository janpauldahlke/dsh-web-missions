# M_9 publish — phase status

Phase state: **in-progress** · Updated: 2026-10-13 · Last slice: 9.1 (package.json sibling form green)

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 9.1 | package.json sibling form (keywords, repo triple, 1.0.0) + LICENSE MIT | green | Reconciled the M0 scaffold's package.json to the C9 sibling form (exemplar `dsh-memento`). **files[] 7→5**: dropped `assets` + `skills` (the M4-skill + M5-consent runtime extras) back to the sibling-identical `["lib","cordis.patch.yml","README.md","LICENSE","media"]` — C9 "documented divergences" + D-M9.5: `assets/`/`skills/` stay **tracked in git** (design record / runtime-for-repo-install) but **out of the tarball** (npm publish is optional; the clean-room V4 installs from the clone where they're present — exactly memento's `assets/`+`skills/`-tracked-but-out-of-files[] pattern). **devDeps 7→5**: dropped `react-dom` + `@types/react-dom` (client `src/client/*.tsx` imports only `react` hooks + `CSSProperties`/`ReactNode`; build.mjs externalizes react-dom via PLATFORM_EXTERNALS) → devDeps now `[@types/node,@types/react,esbuild,react,typescript]` = memento-identical set. **No `prepare`/`test`** (C9 review #4: memento ships only `build` — the slice text's "prepare fallback" is superseded). Regenerated `package-lock.json` (`npm install --package-lock-only`, react-dom count 1→0, 43 pkgs audited clean). `npm run build` + `tsc --noEmit` clean (trim safe). |
| 9.2 | README sibling form + media/ screenshots + tsconfig | todo | — |
| 9.3 | repo hygiene (gitignore, lib/ tracked) + npm pack dry-run + clean-room install proof | todo | — |
| 9.4 | push + dsh.pub submission (operator) + tag v1.0.0 | todo | — |

## Log (append-only)

- 2026-10-12 phase file frozen (review #3, operator: "add a M_9 … publish or else fitting, orientate yourself at the siblings"). Form law = **C9** (DESIGN); exemplars per SIBLINGS.md. Not on the ship bar (post-M8). npm name availability confirmed (registry 404, 2026-10-12).
- 2026-10-13 9.1 green — package.json reconciled to the C9 sibling form against the `dsh-memento` exemplar. (a) **files[] 7→5** → the sibling-identical `["lib","cordis.patch.yml","README.md","LICENSE","media"]`; the M4-skill (`skills/`) + M5-consent (`assets/`) runtime extras are kept **tracked in git but out of the tarball** (C9 "documented divergences" / D-M9.5, mirroring memento's `assets/`+`skills/`); npm publish is optional and the clean-room V4 installs from the clone where they're present. (b) **devDeps 7→5** — dropped `react-dom` + `@types/react-dom` (client imports only `react`; build externalizes react-dom) → devDeps now the memento-identical set. (c) **No `prepare`/`test`** (C9 review #4 supersedes the slice text's "prepare fallback" — memento ships only `build`). (d) `package-lock.json` regenerated (`--package-lock-only`, react-dom 1→0). Verify: V5 LICENSE header = `Copyright (c) 2026 Jan (HagbardCeline) / janpauldahlke` (memento-identical); V2 field-set diff vs memento → top-level keys identical except the expected `dependencies` (browser39) delta, devDeps set **identical**, files **identical**; V1 `npm pack --dry-run` → 8-file tarball (LICENSE, README.md, cordis.patch.yml, lib/{index,client}{.js,.js.map}, package.json) — no plan/skills/assets/ENV.md/.dsh/STATUS.md; build + tsc clean; full regression 13/13 smoke.
