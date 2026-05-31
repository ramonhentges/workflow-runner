---
provider: manual
pr:
round: 1
round_created_at: 2026-05-30T12:34:08Z
status: resolved
file: src/app/api/routes/run-events.ts
line: 79
severity: low
author: claude-code
provider_ref:
---

# Issue 004: `EventsPage.truncated` is computed before the stepId filter is applied

## Review Comment

In `GET /runs/:id/events` the `truncated` flag is taken from the raw
`readEventsSince` result and then the entries are filtered by `stepId`:

```ts
// src/app/api/routes/run-events.ts:79
const { entries, truncated } = await eventLog.readEventsSince(fromSeq ?? 0);
const filtered =
  stepId !== undefined ? entries.filter((e) => e.stepId === stepId) : entries;
return c.json({ entries: filtered, truncated }, 200);
```

`truncated` reflects whether the *unfiltered* read hit the event-log cap, not
whether the filtered (per-step) page was truncated. With a `stepId` filter this
is misleading in both directions:

- It can report `truncated: true` when the requested step's events all fit
  comfortably (the cap was hit by *other* steps' events), prompting a UI to show
  a spurious "history truncated" indicator or issue needless follow-up reads.
- The pagination contract (`fromSeq` + `truncated` to page forward) is harder to
  reason about when filtering, because the next `fromSeq` the client should use is
  the last *unfiltered* seq, which isn't returned in the filtered entries.

This is a contract-clarity issue for the primary consumer (a UI paging a step
transcript), per ADR-006's read-only events endpoint.

Suggested fix: document precisely what `truncated` means relative to the
`stepId` filter (it is a property of the underlying window, not the filtered
slice), and/or return the last-read unfiltered seq so a client can page
deterministically. At minimum add a comment so the semantics are intentional
rather than incidental.

## Triage

- Decision: `valid`
- Notes: The `truncated` flag is taken from the raw `readEventsSince` result before the `stepId`
  filter is applied. When a `stepId` is specified the client receives only a subset of the
  unfiltered entries, yet `truncated` still reflects whether the *unfiltered* window hit the
  backlog cap. This means a consumer can receive `truncated: true` even when every event for the
  requested step fit in the window — the flag says nothing reliable about *step* completeness.
  The current semantics are not wrong for the underlying pagination contract (you still need to
  know whether the whole window was capped), but they are non-obvious and undocumented. A precise
  inline comment is the appropriate fix at this severity, making the semantics intentional rather
  than incidental. A companion comment on the existing test case documents the expected behavior.
