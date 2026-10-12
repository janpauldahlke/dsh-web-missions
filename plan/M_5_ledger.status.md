# M_5 ledger — phase status

Phase state: **not-started** · Updated: 2026-10-12 (review #2: depth fence) · Last slice: —

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 5.1 | budget (unit=fetch calls, hits free, exhaustion) | todo | — |
| 5.2 | allowlist (.dsh/allowlist.txt, deny-all default, gate in fetch) | todo | — |
| 5.3 | depth fence (maxDepth 2, maxDiscoveredHosts 3, lineage via links.json, pre-spawn refusals free) | todo | — |
| 5.4 | host-scoped sessions (~/.dsh/browser39/sessions/<host>/) | todo | — |
| 5.5 | consent v0 (one retry, consent_attempted/improved) | todo | — |
| 5.6 | honesty gate (thin/blocked → do-not-claim hint) + maxBytes truncation | todo | — |
| 5.7 | run V1–V10 (M_5_ledger.md) | todo | — |

## Log (append-only)

- 2026-10-12 phase file frozen. S3/S5/S6/S7 resolved. C6/C7 born here. Sub-decisions D-M5.1–D-M5.6. Ship bar reachable from here.
- 2026-10-12 review #2: depth fence added (D-M5.7/D-M5.8; knobs `maxDepth` 2 + `maxDiscoveredHosts` 3; V9/V10). Slice table renumbered 5.3–5.7. C4 amended: receipt gains `depth` + `parent_artifact_id`; M4 matches carry `depth`; M8 smoke notes seeds exempt.
