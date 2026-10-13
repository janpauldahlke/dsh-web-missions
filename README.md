# dsh-local-web-missions

Persist-and-find **web research** for local coding agents in the **DeepSeek
Harness** web UI.

> npm package name is **`dsh-local-web-missions`** (`dsh-web-missions` is the
> GitHub repo). The GitHub repo remains
> [`janpauldahlke/dsh-web-missions`](https://github.com/janpauldahlke/dsh-web-missions).

A **mission** is a small, budgeted web-fetch unit: the agent pulls a handful of
pages through a local `browser39` headless browser, every fetched page becomes
a durable artifact in a per-project store, and the agent **finds it back**
lexically later — across sessions. Budget, an egress allowlist, and a depth
fence bound the work; cookie-banner consent is handled deterministically by the
host, not the model. No cloud search, no embeddings, no vector store, no LLM
calls inside the plugin.

**Related plugins** (same dual-face `dsh.bundle` shape for the web rightbar):

| Plugin | Repo |
| --- | --- |
| Bounded-file agent memory | [`dsh-memento`](https://github.com/janpauldahlke/dsh-memento) |
| Long-horizon task status | [`dsh-local-long-horizon`](https://github.com/janpauldahlke/dsh-local-long-horizon) |
| Process & port lifecycle | [`dsh-agent-processes`](https://github.com/janpauldahlke/dsh-agent-processes) |
| NVIDIA GPU util / VRAM / power | [`dsh-gpu-monitor-nvml`](https://github.com/janpauldahlke/dsh-gpu-monitor-nvml) |
| Local LLM endpoint / slot health | [`dsh-slot-health`](https://github.com/janpauldahlke/dsh-local-endpoint-health) |

This package: [`dsh-local-web-missions`](https://www.npmjs.com/package/dsh-local-web-missions)
· source [`janpauldahlke/dsh-web-missions`](https://github.com/janpauldahlke/dsh-web-missions).

Verified against DeepSeek Harness **`0.2.1-alpha.2`** (`dsh web`).

---

## Requirements

- DeepSeek Harness web profile (`dsh web`).
- Node.js **≥ 20** to build.
- `@aquintanar/browser39` **2.0.0** (the only runtime dep) — a local headless
  browser whose platform binary ships as an optional dependency, so no system
  Chrome is required.

---

## Screenshots

Light theme, matching the DSH default.

| Board (the mission list) | Detail (artifacts + budget) |
| --- | --- |
| ![Web Missions board](media/pane-board.png) | ![Mission detail](media/pane-detail.png) |

---

## What you see

- **Web Missions rightbar** — the board (all missions with state + budget) and
  each mission's detail (artifacts with `[p-…]` citations, receipts, budget
  bar, Stop / Fetch-more actions).
- **State chip per mission** — green when active, grey when stopped, blue when
  completed.
- **Budget bar** — `used/total` fetch calls; refusal gates (allowlist, depth,
  host-breadth) cost zero and never advance the bar.
- **Consent note** — when a cookie banner was auto-accepted, the receipt says
  so.

---

## Install

### From npm (recommended)

```sh
dsh plugin --profile web add dsh-local-web-missions
# restart dsh web (or rely on live patch reload), then hard-refresh the browser
```

### From GitHub

```sh
dsh plugin --profile web add github:janpauldahlke/dsh-web-missions
```

### From a git checkout (developers)

```sh
git clone https://github.com/janpauldahlke/dsh-web-missions.git
cd dsh-web-missions
npm install && npm run build
dsh plugin --profile web add "$(pwd)"
```

Restart (or boot) `dsh web` so the host + client faces load:

```sh
env -u DSH_WEB_URL -u DSH_SHELL -u DSH_SESSION_ID dsh web --no-open
```

Uninstall:

```sh
dsh plugin --profile web remove dsh-local-web-missions
# restart the web instance that had the plugin
```

---

## Agent tools

| Tool | Purpose |
| --- | --- |
| `mission_start` | Start a mission — creates the store dir (`manifest.json` + `mission.md`) + a recents row; becomes the default active mission. Optional seed URLs (depth 0, hosts exempt from the crawl cap). |
| `mission_list` | The board — active missions (newest first) + recents (cap 50) with page/visited counts. |
| `mission_status` | One mission's detail — artifacts, receipts, budget, status. |
| `mission_fetch` | Fetch a URL with the local `browser39` into the store (page + chunks + links + receipt). Already-stored URLs are **immediate cache hits** (`cached: true`, zero browser spawn); `force: true` re-fetches. |
| `mission_find` | Lexical search over **stored** pages (chunks + link text) → scored matches + snippets + `best_match_url`. Read-only — never fetches. |
| `mission_stop` | Stop a mission (freezes budget + status). |

Every fetch is a **receipted artifact** (`p-…`) carrying `chars`,
`page_quality` (full / thin / blocked), `chunk_count`, a deterministic
`next_step_hint`, and consent outcome (`consent_attempted` / `consent_improved`)
plus budget `{ max, spent, remaining, unit: fetch_calls }`. Blocked pages
(4xx/5xx, empty) are stored too, so dead URLs are known, not guessed.

---

## Egress, budget + depth

- **Allowlist** — `<cwd>/.dsh/allowlist.txt` (project-level, one pattern per
  line, `#` comments) is the egress gate: deny-all by default. Seeds are
  exempt; everything fetched must match. A miss is a zero-cost
  `allowlist_denied`.
- **Budget** — each mission has a `used/total` fetch budget; spending it stops
  the mission. Cache hits and refusal gates cost zero.
- **Depth fence** — `maxDepth` (default **2** link-hops from the nearest seed)
  + `maxDiscoveredHosts` (default **3** non-seed hosts) bound how deep and how
  wide a fetch goes, with deterministic lineage via stored links.

Config knobs live in `<cwd>/.dsh/web-missions/config.json`
(`snippetWindow`, `maxDepth`, `maxDiscoveredHosts`, `defaultFetchBudget`,
`allowlist`, …).

---

## Privacy

- **Local only** — fetches run through a local `browser39` headless browser and
  are rendered to markdown locally. No search engine, no cloud API.
- **Scoped sessions** — `browser39` sessions live under
  `~/.dsh/browser39/sessions/<host>/` (persisted, so an accepted consent
  survives a refetch); the mission store lives under `<cwd>/.dsh/web-missions/`.
- **Consent is deterministic** — cookie-banner acceptance (per-host accept
  labels + a generic fallback, from `assets/consent_profiles.toml`) is host
  code behind the receipt — not a model judgment and not a model-facing tool.
- **No LLM calls, no embeddings, no vector store** inside the plugin.

---

## Surfaces

| Surface | Path / name |
| --- | --- |
| Mission store | `<cwd>/.dsh/web-missions/<id>/` (`manifest.json`, `mission.md`, `artifacts/`, `receipts.json`, `links.json`, `config.json`) |
| Egress allowlist | `<cwd>/.dsh/allowlist.txt` |
| `browser39` sessions | `~/.dsh/browser39/sessions/<host>/` |
| Consent profiles | `assets/consent_profiles.toml` (override at `.dsh/web-missions/consent_profiles.toml`) |
| HTTP | `GET /api/web-missions/health` · `/missions` · `/missions/:id` · `/sessions` · `POST …/stop` · `…/recents/clear` · `…/clear-all` |
| UI | Rightbar **Web Missions** (board + detail) |

---

## Design in five lines

1. **A mission is a budgeted fetch unit** — seed URLs + a `used/total` budget;
   the store is the unit of persistence.
2. **Every fetch is a receipted artifact** — `chars`, `page_quality`,
   `consent_*`, budget — so claims stay verifiable and dead URLs are known.
3. **Find is read-only** — `mission_find` ranks the store lexically (no
   embeddings, no vectors) and never triggers a fetch.
4. **Three fences, zero-cost refusals** — budget, egress allowlist, and a
   depth / host-breadth fence bound the work without wasting budget.
5. **Consent is host code** — deterministic cookie-banner handling behind the
   receipt, never a model judgment.

Deliberately absent: cloud search, embeddings, vector stores, and LLM calls
inside the plugin.

---

## Architecture

Dual-face package (same bar as the other web rightbar plugins):

- **Host** (`lib/index.js`, ESM) — mission store, `browser39` fetch, consent
  tactic, lexical find, egress / budget / depth fences, HTTP, tools.
- **Client** (`lib/client.js`, CJS ModuleLoader factory) — the Web Missions
  rightbar (board + detail).
- **Glue** — `cordis.patch.yml` + `dsh.bundle` / `dsh.client` in `package.json`.

The `@aquintanar/browser39` runtime dep carries the platform headless-browser
binary as an optional dependency; `BROWSER39_BIN` overrides the binary path.

---

## License

MIT — see [`LICENSE`](./LICENSE).
