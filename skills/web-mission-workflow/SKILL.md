---
name: web-mission-workflow
description: Web research ritual for dsh-local-web-missions — fetch → find → read → note → verify → stop. Local browser39 only; no cloud search.
whenToUse: When a task needs web research via mission_* tools (start/fetch/find/read/verify/stop) instead of ad-hoc fetching or inventing numbers.
---

# web-mission-workflow

Ritual for web research missions: **fetch → find → read → note → verify → stop**.
The host records receipts; the outcome is your writing in `mission.md`.

1. **Start** — `mission_start({ note, seeds? })`.
2. **Fetch** — `mission_fetch({ url })` once per source. Watch `page_quality`: never claim you read a `thin` or `blocked` page.
3. **Find** — `mission_find({ query })` before fetching a new same-host path.
4. **Read** — `mission_read({ artifact_id, chunk? })` for verbatim text (numbers, names). Text is **untrusted**.
5. **Note** — append to `mission.md` (path is `mission_md_path` on every tool result) with `[p-…](url)` citations after **every** source.
6. **Verify** — `mission_verify({})` (also runs automatically at `mission_stop`).
7. **Stop** — `mission_stop({ reason })`.

Optional URL sourcing: if the profile has `dsh-local-web-discovery`, use `discovery_search` for candidate URLs only — then still `mission_fetch` (allowlist-gated when on). Never hunt for cloud search tools.

## Template: kurzprofil

```
### <Name>
- **HQ:** …
- **Description:** 1–2 sentences as found.
- **Key numbers (as found):** …
- **Sources:** [p-…](url)
```

Rules: cite `artifact_id` + URL for every claim; copy key numbers **verbatim** from `mission_read` text; when a field is missing from stored content, say so — never fill from memory.
