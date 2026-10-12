# M_1 — store

Phase: **M1** · Status: not started (see `M_1_store.status.md`)
Depends on: M0 (scaffold green, route pattern, build loop, acceptance boot).

---

## Green

Mission store on disk + four model-facing tools registered and working:
`mission_start`, `mission_list`, `mission_status`, `mission_stop`. Recents
persist in `index.json`. **Visited list is exposed in `mission_status`** (empty
until M2 writes the first ledger row). Host routes exist for the pane (API-first;
pane UI is M6): `GET /api/web-missions/missions`, `GET /api/web-missions/missions/:id`.

## Deep design

### Store module (host, fs-only — no network in this module)

Layout per **C1** (DESIGN). All paths under `<cwd>/.dsh/web-missions/` (cwd =
acceptance server cwd = this repo, per D6). IDs: `m-<8 hex>` (crypto random).
Concurrency: v0 single-process; write manifest/index via temp-file + rename
(atomic replace), never partial writes.

```ts
manifest.json = {
  mission_id, note, template_id?: string,
  budget: { max: number },                // max only until M5 (unit: fetch calls)
  status: 'active' | 'stopped' | 'done',
  stop_reason?: string,
  created_at, updated_at,                 // ISO
  fetched: [                              // visited ledger (D11) — written by M2+
    { normalized_url, url, artifact_id, quality, fetched_at, consent_improved? }
  ]
}
index.json   = [                          // recents, newest first, cap 50
  { mission_id, note, status, started_at, updated_at }
]
```

`mission.md` created by `mission_start` with a minimal header:
`# Mission: <note>` + `_status: active_` + an empty "Sources" section.
The model owns the content; the host only creates + footer-on-stop.

### Tool behaviors

- `mission_start({ note, template_id?, budget? })`
  → creates dir + manifest + mission.md + index row (unshift, trim to 50).
  `budget` omitted → `defaultFetchBudget` (config default, 10 — M5 makes it
  live; stored now so the manifest shape is final).
  Multiple active missions allowed; tools default to the most recently started
  active mission when `mission_id` is omitted.
- `mission_stop({ mission_id?, reason? })`
  → `status: 'stopped'`, `stop_reason`, `updated_at`; appends a footer line to
  mission.md (`— stopped: <reason | 'no reason given'> —`). Re-stopping is a
  no-op with `already_stopped: true` in the result.
- `mission_list()` → `{ active: MissionSummary[], recents: MissionSummary[] }`
  (summary = index row + page count + visited count).
- `mission_status({ mission_id? })`
  → `{ ...manifest, visited: fetched[] }`. No active mission + no id →
  `error: no_mission`. This is where the model sees the visited list without
  inventing memory (D11 rule 3) — M2 fills it, the surface exists now.

### Host routes (pane data, API-first)

- `GET /api/web-missions/missions` → `mission_list()` shape.
- `GET /api/web-missions/missions/:id` → `mission_status({mission_id:id})` shape.
  (M6 pane polls these; nothing else consumes them yet.)

### Tool registration

Register all four via the host's tool API (same pattern the harness exposes to
plugins; pin against the installed dsh, do not invent seats). Tool schemas are
JSON Schema; results are JSON-serializable. Errors return `{ ok: false, error:
<code>: <msg> }`, never throw into the tool layer.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | `mission_start` (note "test") | `m-…` id; dir + manifest.json + mission.md + index row on disk |
| V2 | second `mission_start` | two index rows, newest first |
| V3 | `mission_status` (default active) | manifest + `visited: []` |
| V4 | `mission_stop` (reason "smoke") | `status: 'stopped'`, footer line in mission.md, re-stop → `already_stopped: true` |
| V5 | `GET /api/web-missions/missions` | 200, JSON with both missions |
| V6 | kill + restart acceptance server | store survives, `mission_list` identical |
| V7 | 51st start | index capped at 50 rows |

## Scope guard

- **No fetching, no browser39, no cache, no find, no budget decrement** — M2–M5.
- `fetched[]` is defined in the shape but never written this phase.
- No pane UI (M6), no config knobs beyond `defaultFetchBudget` default (M5 surface).
- No long-horizon one-liner sync (D8: optional later, not required).
- Commit after green: `m1: mission store + start/list/status/stop + recents + visited-in-status`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M1.1 | Default budget | 10 fetch calls (config `defaultFetchBudget`; M5 makes it live) |
| D-M1.2 | Recents cap | 50 |
| D-M1.3 | Stop semantics | host records the stop event + footer; outcome text is the model's job in mission.md |
| D-M1.4 | Default-mission rule | most recently started active mission |
| D-M1.5 | API-first | host routes now, pane polls them in M6 |

## Seam consumption

- **C1** (DESIGN) — born here; layout frozen at M1 green.
- **D8** — long-horizon sync intentionally deferred (stays optional).
