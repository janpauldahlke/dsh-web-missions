---
name: dsh-out-of-tree-plugin
description: >-
  Build, install, verify, and package out-of-tree DeepSeek Harness (dsh) web
  plugins (Host + Client dual-face, dsh.bundle). Use when creating or debugging
  a plugin package, connecting a bundle to a profile, choosing --patch vs
  installable bundle, opening an acceptance port, or preparing dsh.pub publish.
---

# Out-of-tree DSH web plugin

> **Vendored for this repo** from `~/dev/overnite/skills/dsh-out-of-tree-plugin/`
> (gpu-monitor + slot-health + memento overnight scars). Copied 2026-10-12.
> Prefer **this file** over re-grepping the harness. If a claim conflicts with
> the **installed** tree (`DSH_ROOT`, usually `~/dev/deepseek-harness`), the
> installed tree wins — note the drift in STATUS and continue with a fallback.

Distilled from overnight **gpu-monitor** (`overnite`), **dsh-agent-pet**, and
later plugin runs. Use when scaffolding (M0/M1), installing the bundle, or
debugging load/HMR/acceptance.

**Pin for this project:** installed CLI **`dsh` 0.2.1-alpha.2** (see `ENV.md` /
`dsh --version`). Do not invent seats. Do **not** silently upgrade mid-mission; current pin is tag `dsh-v0.2.1-alpha.2`.

Acceptance boot for *this* repo: **`./scripts/boot-3090.sh`** (sources
`.env.local`, strips session env). See root `AGENTS.md`.

**Siblings:** local exemplars under `~/dev/dsh-*` (memento, long-horizon,
gpu/slot/processes, akqui preset) — atlas in **[`SIBLINGS.md`](./SIBLINGS.md)**
(same folder). Read that before inventing dual-face / pane / route shapes.
Also linked from root `AGENTS.md`.

## Hard rules (do not violate)

1. **Sacred processes** — Never kill/restart the operator’s primary `dsh web`,
   llama / local inference, or ollama unless the human explicitly says so in a
   new message. Read `ENV.md` when present.
2. **Acceptance = second port** — Self-test with `dsh web --port <free> --no-open` (often `3090`).
   Do not bounce the human’s primary session (often `:3080`) to “see if it works.”
   No `--profile web` — `dsh web` already implies it (see Corrections #1).
3. **Default path = installable bundle**, not `--patch`.
4. **Rebuild before boot** — `lib/index.js` and `lib/client.js` must exist.
   Missing client is a silent-or-loud activation failure; always `pnpm build` /
   `node build.mjs` after client edits.
5. **Package `name` ≡ patch row `name`** — and that name must resolve from the
   **profile** `node_modules` (`~/.dsh/profiles/web/`), not only from the
   harness checkout.
6. **Do not modify** `@deepseek-ai/dsh-client-*` / in-tree client packages to
   make an out-of-tree plugin work. Consume them; relocate only as last resort.

## Bundle vs `--patch` (read once, stop thrashing)

| Path | When | What |
| --- | --- | --- |
| **`dsh.bundle` + `dsh plugin add`** | **Default for real work / publish** | Package declares `dsh.bundle.patch`; CLI adds dep + appends to `dsh.profile.bundles`. Survives restarts. |
| **`--patch file.yml`** | First smoke / pet-style throwaway only | Host-only insert overlay for one boot. Does **not** replace needing `dsh.client` + resolvable package name. |
| Client-only `dsh.client` without `dsh.bundle` | **Broken for “installable”** | Installs as a plain dep and **does not activate** until a bundle/patch inserts a row. |

**Pet lesson** ([dsh-agent-pet](https://github.com/janpauldahlke/deepseek-experiement-series-with-smol-models/tree/main/dsh-agent-pet)):
`--patch` + link into profile `node_modules` proved the client graph, but it is
the **tutorial / smoke** path. **GPU-monitor lesson:** ship `dsh.bundle` from
day one so `dsh plugin --profile web add <path>` is the real loop.

Layer order reminder: bundle patches → profile `cordis.patch.yml` → home
`cordis.patch.yml` → `--patch` overlays.

## Minimal dual-face package

Directory = npm package root (also the future public GitHub root).

```json
{
  "name": "my-unique-plugin-name",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right"]
    }
  }
}
```

`cordis.patch.yml` (top-level YAML **array**):

```yaml
- insert:
    - id: my-plugin
      name: my-unique-plugin-name
```

- **Host** = package root export (`apply` / class + `inject`).
- **Client** = `./client` export, discovered from `dsh.client` — **not** listed
  as a second YAML row. Missing `dsh.client` → client never enters
  `__DSH_BOOT__` (often silent).

Pick a **unique** `name` before publish (`dsh-gpu-monitor` is crowded; prefer
`dsh-gpu-monitor-nvml` or `@you/...`). `id:` only needs uniqueness inside the
profile composition.

## Install / connect the bundle (stop re-discovering)

Preferred (when tools exist in-session):

- `plugin_manager` → `install_bundle` with absolute package directory.
- Or shell: `dsh plugin --profile web add /abs/path/to/package`
  (requires `dsh.bundle`; builds `lib/` first).

If resolution fails (“cannot find package”):

```sh
# profile must see the bare name
ln -sfn /abs/path/to/package "$HOME/.dsh/profiles/web/node_modules/my-unique-plugin-name"
```

Do **not**: relative `./lib/index.js` as the row name, or link only into the
harness repo’s `node_modules` (scan baseUrl is the **profile**).

After install: restart **acceptance** `dsh web` on the second port (or rely on
documented HMR). Hard-refresh the browser for client changes.

Verify composition: `dsh --profile web --dump-config` | search your `id` /
package name. API routes: `curl -s http://127.0.0.1:<port>/api/...`.

## Corrections learned the hard way (slot-health P0, 2026-09-24)

These **contradict or extend** earlier text in this skill — trust these:

1. **`dsh web` already implies the web profile.** Do **not** pass `--profile web` to it. For this repo use **`./scripts/boot-3090.sh`** (preferred) or the clean-env one-liner: `env -u DSH_WEB_URL -u DSH_SHELL -u DSH_SESSION_ID -u DSH_PROFILE -u DSH_PROFILE_DIR dsh web --port 3090 --no-open`. (`--profile` is still correct for `dsh plugin …` and `dsh --dump-config`.)
2. **`package.json` needs `"main": "lib/index.js"`.** The harness defaults to `index.js` and the host half fails to load without `main`, even when `exports` is correct.
3. **Client entries are only served via the `??` combo URL.** Requesting `lib/client.js` as a single file returns **404 by design** — that is *not* a bug and not proof your client is broken. Grab the combo URL from the boot HTML and `curl` that. Note `&amp;` in HTML hrefs must be unescaped before curling.
4. **Web-server route registration shape:** `{ kind: 'exact', path, handler }`, with two separate `ctx.effect()` calls (sampler + unregister).

## Corrections (memento overnight, 2026-10-03) — bites hard

5. **Never name the dsh client stub `LLAMA_API_KEY`.** llama-server maps that env → `--api-key`. Use `LLAMACPP_API_KEY` (or any name llama does not own). Community / Reddit pattern. Strip `LLAMA_API_KEY*` in any wrapper that starts llama (`llama-dsh`).
6. **`:3090` is human-owned for overnight agents.** An agent *inside* `:3080` inherits `DSH_WEB_URL` / `DSH_SHELL` / `DSH_SESSION_ID` / `DSH_PROFILE`. Spawning bare `dsh web` from that env → wrong profile / `unknown option '--port …'` / hours of launcher OCD. Human boots once with **`./scripts/boot-3090.sh`**; accept scripts **only curl health and reuse**. If a restart is explicitly allowed: kill only the verified `:3090` pid, then re-run that script — never `pkill dsh`. Never dig `deepseek-harness` source to “fix” boot; use this skill first.
7. **`spawn('dsh', ['web', '--port 3090', …])` is wrong** — that is one argv. Use `'--port', '3090'` as separate args. Prefer not spawning at all (rule 6).
8. **Boot cwd = project under test.** `dsh web` keys the workspace from process cwd. Booting `:3090` from another repo makes `/api/…/state` report the wrong `project.key`. `boot-3090.sh` must `cd` to the plugin repo before exec.
9. **Bare `curl :3090/` → 401** is the UI token gate, not a model-key failure. Hit `/api/<plugin>/health`. Headless accept turns show **no UI** — tokens go to llama, not the browser.

## Acceptance port `:3090` — check before booting (this has bitten us)

An acceptance server may **already be running** from an earlier attempt. Before booting:

```sh
ss -ltnp | grep ':3090'          # who holds it?
curl -s -m 3 http://127.0.0.1:3090/api/<your-plugin>/health
```

- **Already yours** (`node …/bin.js web --port 3090 --no-open`, **cwd = plugin repo**) → **reuse it, do not boot a second.**
  Rebuilding `lib/` is picked up by client HMR (byte change); a host-half change may need a restart
  of *that* pid only. Verify the route reflects your latest build before trusting what you see —
  a stale bundle answering `{"ok":true}` looks exactly like success.
- **Free** → human boots **`./scripts/boot-3090.sh`** from this repo (see correction 1 + 6). Overnight agents prefer not to boot.
- **`EADDRINUSE`** → something holds it. Identify by pid as above. **Never** `pkill dsh` / `pkill node`
  to free a port — that pattern also matches the **sacred `:3080` primary** (a different pid, same
  cmdline shape). Kill only the specific acceptance pid you verified, by number.

Identify the sacred one before killing anything: `ss -ltnp | grep ':3080'` → that pid is **never** touched.

- Primary operator UI stays up (often `:3080`).
- Inference stays up (often llama `:8080`) — see `ENV.md`. Do not restart ollama unless the project says so.
- If acceptance seems to require killing primary/llama: **stop**, write blocker
  in `STATUS.md`, continue other slices.

## Client contract (browser)

- Emit **CJS** `lib/client.js` wrapped for
  `window.__ModuleLoader__.load({ id: "<package name>", factory })`.
- Runtime `require` only **platform baseline** modules (react, cordis,
  `dsh-client-store`, slots/primitives/dockkit, …). Inline everything else
  (esbuild/tsdown). Type-only imports are fine.
- Shape: `export const inject = ['slots', …]; export function apply(ctx) {…}`.
- Register UI with `ctx.effect` cleanup. Prefer **inline styles** out-of-tree
  (no CSS pipeline unless you know the injection pattern).
- Register at `apply` top level — not only inside a React effect — or boot can
  stall silently (gpu-monitor rightbar lesson).

### Common seats (inspect live before inventing)

| Need | Prefer |
| --- | --- |
| Collapsible side pane | Rightbar tab: `sidebarRightTabs.register` + keyed `sidebar.right.pane.tab` |
| Floating chrome | `shell.overlay` (pointer-events careful) |
| Fallback | `conversation.view` / header corner |

Use `cordis_inspect_*` / slot list for the **pinned** dsh version. Fallback if
the preferred seat fights you — don’t rewrite the harness.

## Host↔UI data

Default simple pattern (gpu-monitor): Host registers
`ctx.webServer` route → Client `fetch` polls. Keep Host `apply` from throwing
(degrade to error JSON). Unload must dispose route + timers.

## Build loop

1. Edit sources under `src/`.
2. `node build.mjs` / `pnpm build` → refresh `lib/`.
3. Exercise on acceptance port; `curl` Host routes; glance UI.
4. Local `git commit` after a verified slice. **Never `git push`** unless the
   human asks. Never force-push.

## Client HMR (acceptance instance)
- Edit client source → rebuild (`node build.mjs`) → `lib/client.js` bytes change →
  running `dsh web` HMR reloads that plugin (stat/rev of bundle bytes).
- `pnpm run dev:web` is only needed if you want a *source watcher* to rebuild for you.
  If you rebuild yourself, you do not need it.
- Do not dig Loader/HMR source to “prove” reload. Verify: rebuild, glance :3090
  (hard-refresh if stale), continue product work.

## Publish later (human gate)

Agent may **prepare** the tree; human **publishes**:

1. Public GitHub repo with package at **repository root**.
2. Unique name, LICENSE, README with install command.
3. No secrets, no `ENV.md` / overnight STATUS dumps.
4. Human submits URL at https://dsh.pub/en/submit/ — **no PR into
   deepseek-harness core**.
5. npm optional; dsh.pub + GitHub is enough for discoverability.

## Anti-thrash checklist (when stuck >15 min)

- [ ] Does `package.json` have **both** `dsh.bundle` and `dsh.client`?
- [ ] Does `cordis.patch.yml` `name` match `package.json` `name`?
- [ ] Does `lib/client.js` exist and match the ModuleLoader wrapper?
- [ ] Is the package resolvable from `~/.dsh/profiles/<profile>/node_modules`?
- [ ] Are you testing on a **second port**, not killing primary/llama?
- [ ] Did you rebuild after the last client edit?
- [ ] Are you re-reading harness Loader source instead of this skill? Stop; fix
      the checklist item above.
- [ ] Still stuck after the checklist? Then open **`~/dev/deepseek-harness`**
      (installed `DSH_ROOT`) for the **pinned** version only — stay on the ENV pin (currently `dsh-v0.2.1-alpha.2`).

## When to open the harness tree

1. Read **this skill**, then **`SIBLINGS.md`** for local exemplars.
2. Read root `AGENTS.md` + `plan/PROTOCOL.md` + current `plan/M_*.md`.
3. Only then inspect `~/dev/deepseek-harness` for the **installed** pin
   (`dsh --version` / `ENV.md`). Do not upgrade mid-slice.
