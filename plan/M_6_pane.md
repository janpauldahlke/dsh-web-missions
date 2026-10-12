# M_6 — pane

Phase: **M6** · Status: not started (see `M_6_pane.status.md`)
Depends on: M1 (mission routes), M5 (budget + sessions visible).
Timing: **follow-up** (not same week as M0–M5 — open item 3, called here).

---

## Green

Rightbar **Missions** pane is a real operator surface: board of active +
recent missions, visited list per mission, budget bar, quality/consent
indicators, **Clear recents** / **Clear all** (D7 hygiene), and the
cookie/session hint line. All data from the existing host routes (API-first,
M1) — no new data model.

## Deep design

### Host routes added (M1 routes stay; these are new)

- `GET /api/web-missions/missions/:id/visited` → the ledger rows (or reuse the
  `mission_status` payload — prefer reuse; add only if payload is too fat).
- `POST /api/web-missions/recents/clear` → clears `index.json` (keeps mission
  dirs; `Clear recents` = forget the list, not the data).
- `POST /api/web-missions/clear-all` → deletes mission dirs + index **+ host
  session dirs** (`~/.dsh/browser39/sessions/`, C7). Body
  `{ confirm: true }` required — no accidental wipes. Returns counts.
- `GET /api/web-missions/sessions` → hosts with session dirs + last consent
  outcome (from ledger `consent_improved`) — v0.1 visibility, cheap because
  M5 made sessions host-scoped. (If this fights the timeline, drop it; the
  pane hint line is the minimum.)

### Pane UI (client, inline styles only)

- **Board:** active missions first (note, started, visited count, budget
  `remaining/max`), then recents (note, status, updated). Click a mission →
  detail section.
- **Detail:** visited list (URL, quality badge `full/thin/blocked`,
  consent-improved mark, `fetched_at` + age in days, `artifact_id`
  truncated), budget line, stop button (calls `mission_stop` via a new
  `POST /api/web-missions/missions/:id/stop` route).
- **Quality badges:** `full` subtle, `thin` amber, `blocked` red — the
  operator sees at a glance what the model actually has.
- **Cookie/session hint line:** when the latest mission has ≥1 `thin` page
  with `consent_attempted && !consent_improved`:
  `session thin on <host> — export cookies or preload into
  ~/.dsh/browser39/sessions/<host>/` (the M5 escape hatch, surfaced).
- **Clear actions:** "Clear recents" (confirm), "Clear all" (double confirm —
  type `clear` or click-through twice; it touches `~/.dsh`).
- Polling: `GET /missions` every 15 s while the tab is visible; stop when
  hidden (tab-visible via the pane lifecycle; no global timers).
- Registration stays at `apply` top level (skill rule); `ctx.effect` cleanup
  disposes the poller on unload.

### Scope of "human" (M6 sketch marks it *human*)

The sketch labels M6 "human" — meaning: this is the phase where operator UX
feedback lands. Implementation is still by the agent; **acceptance is
operator-eyes-on-:3090**, not curl. The vault done item records the operator
confirmation.

## Verify

| # | Check | Expected |
| --- | --- | --- |
| V1 | with 2 missions on disk (one with visited pages incl. a `thin` + consent-improved) | board shows both; detail shows visited list with correct badges, ages, artifact ids |
| V2 | budget bar | matches manifest (remaining/max) |
| V3 | stop button | manifest `status: 'stopped'`, footer in mission.md, board updates next poll |
| V4 | Clear recents | `index.json` empty, mission dirs intact, board shows empty state |
| V5 | Clear all (confirm) | mission dirs gone, session dirs gone, `~/.dsh/browser39/sessions/` empty |
| V6 | hint line | appears only when the thin+attempted-not-improved condition holds; disappears after |
| V7 | unload/reload the plugin | no orphan pollers, no duplicate tabs (verify via client HMR + hard refresh) |
| V8 | operator pass | Jan eyeballs :3090; notes folded in as dated amendments |

## Scope guard

- **No find results UI** (find is a model-in-chat surface), **no settings UI**
  (knobs stay hand-set until the pane has two users), **no export/import**,
  **no multi-pane/drag** — rightbar tab only.
- No new storage; everything rendered comes from M1–M5 data.
- Commit after green: `m6: Missions pane — board, visited, budget, clear actions, session hint`.

## Sub-decisions

| # | Decision | Value |
| --- | --- | --- |
| D-M6.1 | Polling | 15 s, visible-tab only |
| D-M6.2 | Clear all scope | missions + index + host session dirs; double confirm |
| D-M6.3 | Stop via pane | new POST stop route (thin wrapper over `mission_stop`) |
| D-M6.4 | Sessions route | included if cheap at implementation, else dropped (pane hint is the minimum) |

## Seam consumption

- **D7** — hygiene = this phase.
- **C7** — session visibility + wipe semantics live here.
- **D-M5.5/v0.1** — the session hint is the v0.1 stretch's *minimum* form.
