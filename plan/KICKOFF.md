# KICKOFF — first run to M0 green

Status: **frozen 2026-10-12**. Read top-to-bottom before the first slice.
Precondition: none beyond this repo + the DSH checkout.

---

## 1. Pre-checks (run once, record results in ENV.md)

```sh
ss -ltnp | grep -E ':(3080|3090|8080|11434)'   # sacred ports up; :3090 must be free (or already ours)
ls /home/hagbard/dev/deepseek-harness     # DSH checkout present
ls skills/dsh-out-of-tree-plugin/SKILL.md   # vendored packaging skill (always present)
```

- Harness pin: **DeepSeek Harness 0.2.1-alpha.2** — confirm against the installed
  `dsh`, re-pin in ENV.md if it moved. Checkout is on tag **`dsh-v0.2.1-alpha.2`**. Running `:3080` may still be old in-memory until *you* restart it later.
- Packaging questions → **`skills/dsh-out-of-tree-plugin/SKILL.md` first**,
  sibling patterns → **`skills/dsh-out-of-tree-plugin/SIBLINGS.md`**, then
  installed tree `~/dev/deepseek-harness` only if still stuck.
- **browser39 law (S1 flipped, 2026-10-12, operator decision):** the npm
  package **`@aquintanar/browser39@2.0.0`** is the plugin's dependency — the
  platform binary rides along via its optional-deps. Cargo `browser39` 1.7.1
  remains on the box (Eris) but is **not** the lab law anymore.
  `BROWSER39_BIN` stays the override/escape hatch.

## 2. ENV.md (gitignored, created first)

```
DSH pin:        0.2.1-alpha.2 (re-pin when the overnight/implementation starts)
browser39:      @aquintanar/browser39 2.0.0 (npm dependency of the plugin — S1 flipped)
BROWSER39_BIN:  (unset = plugin resolves its own node_modules binary; cargo 1.7.1 override available)
acceptance:     :3090, cwd = /home/hagbard/dev/dsh-web-missions
allowlist:      on for dogfood; patterns file at .dsh/allowlist.txt (M5)
chunkChars:     2000 (hand-set, M2 tuning later)
sacred:         :3080 dsh web / :8080 llama / :11434 ollama — never bounce
```

## 3. Scaffold layout (repo root = npm package root = future public GitHub root)

```
dsh-web-missions/
  package.json            # C9 sibling form: name dsh-local-web-missions (npm availability confirmed 2026-10-12), version 1.0.0
  cordis.patch.yml
  build.mjs               # esbuild: src/host → lib/index.js, src/client → lib/client.js (CJS wrapper)
  src/host/index.ts       # Host face: apply(ctx) → webServer routes (M0: /health)
  src/client/index.ts     # Client face: ModuleLoader wrapper; M0: rightbar tab, empty
  lib/                    # built artifacts — TRACKED (C9 sibling law: prepare falls back to prebuilt lib/)
  plan/                   # this planning pack (tracked = design record; files[] keeps it out of the tarball)
  scripts/boot-3090.sh    # clean-env acceptance boot, cwd = repo
  skills/                 # repo-vendored: dsh-out-of-tree-plugin/SKILL.md + SIBLINGS.md (read in M0/M1; form law C9)
  ENV.md                  # gitignored
  node_modules/           # gitignored — holds @aquintanar/browser39 (the plugin dep)
  package-lock.json       # committed — pins the browser39 2.0.0 tree
  PLAN.md                 # plan pack index
  README.md               # sibling form (M9): hook → related-plugins table → verified pin → requirements → screenshots
  LICENSE                 # MIT, sibling header line (created at M0, C9)
  media/                  # pane screenshots (M9; in files[])
  tsconfig.json           # sibling law
```

The plugin's `package.json` declares (amended 2026-10-12, S1 flip):

```json
"dependencies":    { "@aquintanar/browser39": "2.0.0" },
"devDependencies": { "@types/node": "^22.0.0", "@types/react": "<installed web shell's React — confirm at M0>", "esbuild": "^0.25.0", "typescript": "^5.0.0" }
```

`@types/react` is pinned to the installed web shell's React (sibling
evidence: 0.1.7-era siblings use `@types/react ^18.3.0`, `dsh-slot-health`
declares peer `react ^19.2.7`) — confirm against `0.2.1-alpha.2` at M0.

`npm install` in the repo is a **kickoff step** (creates `node_modules/` with
the browser39 platform binary). For end users, `dsh plugin add` pulls the
dependency through npm — no separate browser39 install, no cargo, no PATH
state. `package-lock.json` is committed (the 2.0.0 tree is the pin).

`package.json` — **C9 sibling form** (identical field set to the published
siblings; only name / description / domain keywords / deps differ):

```json
{
  "name": "dsh-local-web-missions",
  "version": "1.0.0",
  "description": "Persist-and-find web research for DeepSeek Harness local agents (browser39 fetch, mission store, lexical find, budget + allowlist + depth fence). No cloud search in v0.",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE", "media"],
  "repository": { "type": "git", "url": "git+https://github.com/janpauldahlke/dsh-web-missions.git" },
  "homepage": "https://github.com/janpauldahlke/dsh-web-missions#readme",
  "bugs": { "url": "https://github.com/janpauldahlke/dsh-web-missions/issues" },
  "scripts": {
    "build": "node build.mjs && tsc --noEmit",
    "prepare": "node build.mjs || node -e \"console.warn('[dsh-local-web-missions] prepare: build skipped (build toolchain unavailable); relying on prebuilt lib/')\""
  },
  "keywords": [
    "dsh-plugin", "deepseek-harness", "deepseek-harness-plugin", "dsh",
    "cordis", "cordis-plugin",
    "mission", "web-research", "browser39", "persist", "cache", "allowlist",
    "local-agents", "coding-agents",
    "sidebar", "web-ui"
  ],
  "dependencies": { "@aquintanar/browser39": "2.0.0" },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "@types/react": "^19.2.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.0.0"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right"]
    }
  }
}
```

`cordis.patch.yml` (top-level YAML **array**; `name` ≡ package name;
sibling comment header):

```yaml
# dsh-local-web-missions layer: one Loader row for the dual-face package.
# Host half = package root export (lib/index.js); browser half = ./client
# export (lib/client.js) discovered from the package's dsh.client declaration.
- insert:
    - id: web-missions
      name: dsh-local-web-missions
```

Gotchas that have bitten before (skill corrections — do not rediscover):

- `main: lib/index.js` is **required** or the host half silently fails to load.
- Client is discovered from `dsh.client` — not a second YAML row.
- Client must be **CJS** wrapped for `window.__ModuleLoader__.load({ id, factory })`;
  runtime `require` only platform-baseline modules; inline everything else.
- Register UI at `apply` top level (not only inside a React effect) or boot stalls silently.
- Web-server route shape: `{ kind: 'exact', path, handler }` with two `ctx.effect()`
  calls (sampler + unregister).
- Resolution is from the **profile** `node_modules` (`~/.dsh/profiles/web/`), not the harness checkout.

## 4. Install + acceptance boot

1. Build: `node build.mjs` (both faces exist in `lib/`).
2. Install the bundle: `dsh plugin --profile web add /home/hagbard/dev/dsh-web-missions`
   (requires `dsh.bundle`; builds/uses `lib/`). If resolution fails, symlink:
   `ln -sfn /home/hagbard/dev/dsh-web-missions "$HOME/.dsh/profiles/web/node_modules/dsh-local-web-missions"`.
3. Verify composition: `dsh --profile web --dump-config` → grep `web-missions` / package name.
4. Boot acceptance (**cwd = this repo** — workspace is keyed from cwd).
   **Do not** bare-`dsh web` without keys. First time: `cp .env.local.example
   .env.local`, fill, `chmod 600`. Then use the script:

```sh
./scripts/boot-3090.sh
```

   (sources the gitignored `.env.local`, unsets `LLAMA_API_KEY*` so the stub
   never arms `:8080`, and strips the `DSH_*` session vars — the acceptance
   host must not be bound to a GUI agent session.)
   Run it as a tracked background process. Prefer: human boots once, agent
   reuses via `curl /health`. If restarting, kill only the verified `:3090`
   pid (`ss -ltnp | grep ':3090'`), then re-run the script — never
   `pkill dsh` / `pkill node`.
   `dsh web` already implies the web profile — do **not** pass `--profile web`.
   Never print `.env.local` or its values into chat/logs/commits.
5. Reuse thereafter: client edits → rebuild → HMR picks up byte change (hard-refresh
   if stale). Host-half changes → restart **that specific pid** only.
   Before trusting `:3090`, confirm it reflects the latest build (a stale bundle
   answering `{"ok":true}` looks exactly like success).

## 5. M0 green definition (mirror of M_0_scaffold.md)

- `curl -s http://127.0.0.1:3090/api/web-missions/health` → `200` JSON with `ok: true`,
  plugin name, version. (Bare `curl :3090/` → 401 is the UI token gate, not failure.)
- Hard-refresh `:3090` → rightbar shows a **Missions** tab; content = empty state
  ("no missions yet"). No console errors from our bundle.
- `dsh --profile web --dump-config` shows the `web-missions` row.
- Sacred ports untouched: `ss -ltnp` → `:3080`/`:8080` pids unchanged.

## 6. First-commit checkpoint

Commit after M0 green: `m0: dual-face scaffold, /health + empty Missions tab on :3090`.
Then vault: mark done (with the curl output as evidence), set Next to M1.
