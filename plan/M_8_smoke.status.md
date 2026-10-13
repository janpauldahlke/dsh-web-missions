# M_8 smoke — phase status

Phase state: **in-progress** · Updated: 2026-10-13 · Last slice: 8.1

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 8.1 | fixtures/partner-daten.json (10 entities, freeze liveness) | green | 10 entities / 15 URLs / 11 hosts, shape asserted (bank 5 + insurer 4 + fund 1); liveness 2026-10-13: 11/15 200 via plain HTTP (browser-like UA), 4/4 bot-check hosts (comdirect ×2 401 CIF_Check, allianz ×2 403) verified 200 via browser39 = the mission transport; 0 dead. HUK-Coburg swapped → HanseMerkur (huk-coburg.de: TLS SNI "unrecognized name", unreachable plain + browser from this network). Re-verify: `node scripts/check-fixture-liveness.mjs` (exit 0) |
| 8.2 | allowlist.txt = fixture hosts | todo | — |
| 8.3 | run S1 (Kurzprofile) mission on :3090 | todo | — |
| 8.4 | A1–A6 assertions + accept-cache.mjs zero-spawn proof | todo | — |
| 8.5 | S2 news dig + S3 chart snapshot (secondary) | todo | — |
| 8.6 | operator pass on mission.md | todo | — |

## Log (append-only)

- 2026-10-12 phase file frozen. Open item 1 (fixtures) frozen here. DoD = PLAN §12. Sub-decisions D-M8.1–D-M8.5.
- 2026-10-13 8.1 green — `fixtures/partner-daten.json` frozen: candidate list realized with liveness corrections: sparda-berlin.de home kept (redirects to sparda-b.de rebrand) + Kontomodelle as secondary (no privatkunden path); DKB secondary = /privatkunden/girokonto (no top-level konditionen path, 404); ING-DiBa kept (→ ing.de rebrand, /zinsen/ → Zinsspiegel); comdirect + allianz pass the bot check only through a real browser → verified via browser39; allianz secondary = Private-Haftpflicht page (/private.html is 404); HUK-Coburg swapped for HanseMerkur (TLS SNI block from this network, plan allows swaps). `scripts/check-fixture-liveness.mjs` added (plain-HTTP first pass; 401/403 classified BOT = verify via browser39; exit ≠0 only on real failures). Allowlist hosts for 8.2: allianz.de, comdirect.de, dbv.de, dkb.de, erv.de, hansemerkur.de, ing-diba.de, sparda-b.de, sparda-berlin.de, sparkasse.de, union-investment.de (+ www. forms).
