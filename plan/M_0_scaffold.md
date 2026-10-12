# M_0 — scaffold

Phase: **M0** · Status: not started (see `M_0_scaffold.status.md`)
Depends on: nothing — KICKOFF §1 pre-checks + §4 install/boot.
Packaging authority: **`skills/dsh-out-of-tree-plugin/SKILL.md`** (read before inventing).

---

## Green

A working **dual-face plugin** installed on the web profile, booted on the
acceptance server (`:3090`, cwd = this repo):

1. `curl -s http://127.0.0.1:3090/api/web-missions/health` → `200`, JSON
   `{ ok: true, name, version, time }`.
2. Hard-refresh `:3090` → rightbar shows a **Missions** tab; content = empty
   state **plus** the one-shot host ping rendered (proves host↔UI loop).
3. `dsh --profile web --dump-config` shows the `web-missions` row.
4. Sacred ports (`:3080`/`:8080`/`:11434`) pids unchanged.

## Deep design

### Layout

Repo root = npm package root (KICKOFF §3). Files created this phase:
`package.json` (**C9 sibling form**), `cordis.patch.yml` (C9 header form),
`build.mjs`, `src/host/index.ts`, `src/client/index.ts`, `tsconfig.json`,
`LICENSE` (MIT, C9), `scripts/boot-3090.sh`, `ENV.md`, `.gitignore`
(`ENV.md`, `node_modules/`, `STATUS.md` — **`lib/` is tracked**, C9 sibling law).

### Host face

- `apply(ctx)`: register route `{ kind: 'exact', path: '/api/web-missions/health', handler }`
  with two `ctx.effect()` calls (sampler + unregister). Unload disposes both.
- Handler: returns `{ ok: true, name: 'dsh-local-web-missions', version, time: <ISO> }`.
  Any internal error → `500` JSON `{ ok: false, error: <message> }`.
  `apply` itself must never throw (degrade to error JSON).
- Route base is fixed now: **`/api/web-missions/…`** — M1+ adds routes under it.

### Client face

- CJS bundle wrapped for `window.__ModuleLoader__.load({ id: 'dsh-local-web-missions', factory })`.
- At `apply` top level (not inside a React effect): register rightbar tab via
  `sidebarRightTabs.register` + keyed `sidebar.right.pane.tab` — id
  `web-missions`, label **"Missions"**, inline styles only.
- Pane content (M0): heading "Missions", one line from a **one-shot**
  `fetch('/api/web-missions/health')` on pane mount →
  `host: ok · dsh-local-web-missions v1.0.0`, and empty state
  `no missions yet`. Fetch failure → `host: unreachable`. No polling in M0.

### Build

`build.mjs` (esbuild): host `src/host/index.ts` → `lib/index.js` (ESM);
client `src/client/index.ts` → `lib/client.js` (CJS, all non-baseline deps
inlined; runtime `require` only platform baseline). Build must be repeatable
and idempotent; `node build.mjs` is the only build command.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | `curl -s -m 5 http://127.0.0.1:3090/api/web-missions/health` | 200, `ok: true`, name+version |
| V2 | `dsh --profile web --dump-config \| grep -c web-missions` | ≥ 1 |
| V3 | Boot HTML → combo URL (`&amp;` unescaped) → `curl` it | 200, contains `dsh-local-web-missions` module id |
| V4 | Operator hard-refresh `:3090` | Missions tab visible, ping line + empty state, no console errors from our bundle |
| V5 | `ss -ltnp \| grep -E ':(3080\|8080\|11434)'` before/after | pids unchanged |

V4 is operator-confirmed (headless acceptance shows no UI); the vault done
item carries the curl outputs for V1–V3 as mechanical evidence.

## Scope guard

- **No** `mission_*` tools, no store, no fetcher, no config surface — M1+ territory.
- No polling, no Clear actions, no cookie UI, no SearXNG, nothing from M6/M7.
- Do not patch the harness tree; consume it out-of-tree. Read the skill first;
  open `~/dev/deepseek-harness` only for the **pinned** version if the skill is wrong.
- No publish, no push. Local commit only: `m0: dual-face scaffold, /health + empty Missions tab on :3090`.

## Sub-decisions (called by the implementer, per operator delegation)

| # | Decision | Value |
| --- | --- | --- |
| D-M0.1 | Package name | `dsh-local-web-missions` (fits `dsh-local-*` family; npm availability confirmed 2026-10-12; publish = M9, C9) |
| D-M0.2 | Route base | `/api/web-missions/` |
| D-M0.3 | Rightbar tab id / label | `web-missions` / "Missions" |
| D-M0.4 | M0 UI ping | one-shot health fetch on pane mount (proves host↔UI loop, zero polling cost) |

## Seam consumption

- **S1** — resolved at npm `@aquintanar/browser39@2.0.0` as a plugin
  dependency (flipped 2026-10-12). M0 adds the dependency + `npm install`;
  no fetch happens yet, so the CLI contract is pinned in M2.
- **C9** — package identity + public form follow the sibling form-speak
  (born review #3, 2026-10-12): C9 package.json field set, version 1.0.0,
  `lib/` tracked, MIT `LICENSE`, sibling comment header on `cordis.patch.yml`.
  The full public form (README / media / dsh.pub) is frozen green at M9.
