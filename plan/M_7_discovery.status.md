# M_7 discovery — phase status

Phase state: **in-progress (companion green, hermetic)** · Updated: 2026-10-13 · Last slice: 7.1–7.4 (companion core)

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 7.1 | DiscoveryPort + companion package/row | green | package `dsh-local-web-discovery` @ `~/dev/dsh-web-discovery` (C9 form, dual-faced no-op client, Loader row `dsh-local-web-discovery`); port in `src/host/discovery-port.ts`; commit `4acaf0a` |
| 7.2 | SearXNG engine (HTTP JSON, optional) | green | `src/host/engines/searxng.ts`: GET `{endpoint}/search?q=..&format=json`, default `http://127.0.0.1:8888/searxng` (not :8080=llama); injected fetch; 7 smoke checks incl. real API shape stub, 500/non-JSON/no-results → `searxng_unreachable`, reachable-empty → `[]` |
| 7.3 | browser39-search engine (CLI, optional) | green | `src/host/engines/browser39.ts`: `browser39 search <q> --output json --no-persist`; live 2.0.0 reply shape (fetch-shaped SERP page) — DDG `/l/?uddg=` unwrap, SERP-chrome skip, anchor-text titles, case-insensitive dedupe, limit; 14 smoke checks incl. ENOENT→`browser39_missing`, non-zero exit→`browser39_failed` |
| 7.4 | no_engine degrade path + allowlist re-gate on fetch | green (companion half) | `src/host/discovery-tool.ts`: auto searxng→browser39 fallback, pinned semantics, combined reasons, `search_failed` vs `no_engine` (8 checks). Allowlist re-gate on fetch is a CORE property — verified at 7.5/V2 (discovered URLs fetched through the gate) |
| 7.5 | run V1–V5 (M_7_discovery.md) | todo | — |

## Log (append-only)

- 2026-10-12 phase file frozen. S8 resolved (deferred past M5, optional). S6 boundary restated. Sub-decisions D-M7.1–D-M7.5.
- 2026-10-13 probes: SearXNG NOT on box (:8888 free, no binary; docker available → hermetic stub for V2, real instance = operator opt-in); `browser39 search` confirmed in 2.0.0, output is fetch-shaped page with DDG `uddg` redirect wrappers (adapter unwraps — D4 satisfied, no DIY parse).
- 2026-10-13 7.1–7.4 companion core GREEN hermetic: commit `4acaf0a` (`~/dev/dsh-web-discovery`), 40/40 smoke (`scripts/smoke-m7.mjs`, stub SearXNG + fake CLI, no network), `tsc --noEmit` clean, host bundle loads standalone (exports `name`/`inject: ['tools']`/`apply`). recordDiscovery → `<mission>/discovery.json` (bridge for 7.2-core: mission_status surface). V1–V5 remain (7.5): V1 no_engine + full core regression, V2 stub SearXNG → URLs → core fetch w/ allowlist, V3 live browser39-search probe, V4 engine-down mid-mission, V5 encapsulation diff (core: only optional discovery surface).
