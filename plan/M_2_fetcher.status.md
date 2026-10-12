# M_2 fetcher — phase status

Phase state: **in flight** · Updated: 2026-10-12 · Last slice: 2.1

## Slices

| # | Slice | State | Verify evidence |
| --- | --- | --- | --- |
| 2.1 | npm install (browser39 2.0.0 dep); probe 2.0.0 CLI + session-dir surface; pin subcommand/flags + spawn strategy in log | done | dep was already installed at M0 (`@aquintanar/browser39@2.0.0`, platform binary `@aquintanar/browser39-linux-x64/bin/browser39`, shim `bin.js` execs it via `execFileSync`). Live probes against 2.0.0 (2026-10-12, probe workspace `/tmp/b39probe`, local server `site/server.py` on :18099): **transport pinned** `browser39 batch <IN> [--output <OUT>] [--config <CFG>] [--no-persist]`, input lines `{"id","action","v":1,"seq":n,…}`; **output file is APPENDED** (stale lines survive — Fetcher must unlink before spawn); exit 0 even on per-line errors; stderr gets `[batch <ts>] seq n: …` log lines. **Result line = fixture** `fixtures/b39-fetch-result.jsonl` (200 line w/ full schema + `INVALID_URL` error line incl. `retryable:false`). `url` field = **final post-redirect URL** (local 302 probe: `/redirect`→`/target?arrived=1` reported as final). **HTTP 4xx/5xx → `ok:true` + `status:404`** (error-page markdown), NOT an error line; connection fail → `ok:false code:HTTP_ERROR`; bad URL → `ok:false code:INVALID_URL`. **`show_selectors_first` defaults TRUE in 2.0.0** — big pages return a 129-char "re-fetch with a selector" stub unless set false (plan's option set confirmed correct). `max_tokens` truncation: `truncated:true` + `next_offset` (tokens; absent when not truncated). `links[].href` = **relative** (resolve against final URL). **Session = in-memory for batch, always** (no `session.enc` written even with `persistence=disk` + `quit`; docs: "One-shot fetch and batch commands always use in-memory sessions") → `session_path` config key is a no-op for batch; **consent persistence across missions must be host-side** (re-inject consent cookies via per-spawn config `[[cookies]]` — C7 mechanism decision, feeds M5). **Page JS does not run on fetch** (static HTML→markdown); `element.click()` neither navigates anchors nor runs inline `onclick`; but `document.cookie` writes from `dom_query` scripts DO reach the session jar (verified via `cookies` action) → M5 consent lever = explicit cookie set. Spawn strategy: `node <pkg>/bin.js batch …` (plan item 2; bin.js execFileSync-propagates exit codes) with 30 s host timeout |
| 2.2 | normalization (C2) + unit checks | todo | — |
| 2.3 | Browser39Fetcher (spawn, JSONL, timeout, quality) | todo | — |
| 2.4 | artifact storage (page.json, chunks, links) + ledger row | todo | — |
| 2.5 | mission_fetch tool + receipt (C4 base) | todo | — |
| 2.6 | run V1–V6 (M_2_fetcher.md) | todo | — |

## Log (append-only)

- 2026-10-12 phase file frozen. C2/C3 born here. Sub-decisions D-M2.1–D-M2.5.
- 2026-10-12 slice 2.1 done: 2.0.0 contract probe (log above; fixture committed). Key deltas vs 1.7.x-era plan text: (1) `show_selectors_first` defaults true → must set false; (2) batch output file appends → unlink before spawn; (3) 4xx/5xx are ok:true lines with `status` → blocked detection keys on status, not error lines; (4) batch sessions are always in-memory → C7 consent persistence moves host-side (config `[[cookies]]` re-injection per spawn); (5) clicks are inert for JS/CMP → M5 consent = explicit `document.cookie`/`set_cookie` writes (sandbox writes reach the jar); (6) `next_offset` absent when not truncated; `links[].href` relative. Probe workspace kept at `/tmp/b39probe` (server script reusable for 2.6 V1–V6).
