# M_6 pane — phase status

Phase state: **in-progress** · Updated: 2026-10-13 · Last slice: 6.1

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 6.1 | host routes: /sessions, /recents/clear, /clear-all, /missions/:id/stop | done | scripts/smoke-m6-routes.mjs: 33 checks green (hermetic + live :3090 cross-check); full regression 14/14 suites PASS |
| 6.2 | client board (active + recents) + detail (visited, budget, badges) | todo | — |
| 6.3 | Clear recents / Clear all (double confirm) + session hint line | todo | — |
| 6.4 | 15s visible-tab polling + ctx.effect cleanup | todo | — |
| 6.5 | run V1–V8 (M_6_pane.md) + operator pass | todo | — |

## Log (append-only)

- 2026-10-12 phase file frozen. Timing = follow-up (D-M6, open item 3). D7 hygiene lives here. Sub-decisions D-M6.1–D-M6.4.
- 2026-10-13 6.1 done. New: 3 exact routes (POST /recents/clear, POST /clear-all {confirm:true} gate, GET /sessions) + POST /missions/:id/stop inside the existing prefix handler (capture-group suffix match; store.ts unchanged surface — stopMission reused). `FetchedRow.consent_attempted` added (M5-era rows `?? false`) so the pane hint + /sessions last_consent don't need page.json. sessions-view.ts (new): host dirs + last_modified + last attempted consent from ledger rows. :3090 restarted on the new build; live cross-check proves real prefix dispatch for POST /:id/stop.
