---
name: web-mission-workflow
description: Web research ritual for dsh-local-web-missions — start a mission, fetch each source once (watch page_quality), find over stored pages before re-fetching, synthesize mission.md with artifact_id citations, stop with a reason.
whenToUse: When a task needs web research via the mission tools (mission_start / mission_fetch / mission_find / mission_stop) instead of ad-hoc fetching.
---

# web-mission-workflow

The ritual for web research missions (dsh-local-web-missions). The host records receipts; the outcome is the model's writing.

1. **Start** the mission — `mission_start({ note })` with a note naming the goal.
2. **Fetch** each source URL once — `mission_fetch({ url })`. Watch `page_quality`: never claim you read a `thin` or `blocked` page (honesty contract).
3. **Find** over what's stored — `mission_find({ query })` before fetching a new same-host path. `url_only: true` answers "which stored page talks about X".
4. **Synthesize** into `mission.md` — findings plus a Sources list citing `artifact_id` + URL per claim. Use the `kurzprofil` template below for entity blocks.
5. **Stop** the mission — `mission_stop({ reason })`. The host only recorded the receipts.

## Template: kurzprofil

Per-entity block for `mission.md` (one per entity; fill only from stored pages):

```
### <Name>
- **HQ:** …
- **Description:** 1–2 sentences as found.
- **Key numbers (as found):** …
- **Sources:** [p-…](url)
```

Rules: cite an `artifact_id` + URL for every claim; copy key numbers verbatim from the cited page; when a field is not in the stored content, say so — never fill the gap from memory.
