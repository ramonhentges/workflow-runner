---
provider: manual
pr:
round: 4
round_created_at: 2026-06-01T14:18:36Z
status: resolved
file: src/app/api/routes/ws-attach.ts
line: 392
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: Initial WS attach only sends current-step backlog, hiding prior steps' transcript

## Review Comment

After opening a multi-step run, the transcript shows only the messages/events
from the **last** step. Output from every earlier step is missing.

Root cause is server-side. On an initial attach (no `fromSeq`), the backlog is
built from the current step only (`ws-attach.ts:392-409`):

```ts
} else if (currentStepId !== null) {
  // Initial attach: return current-step backlog.
  if (eventLog) {
    const fromRing = eventLog.currentStepBacklog(currentStepId);
    if (fromRing !== null) {
      backlog.push(...fromRing);
    } else {
      backlog.push(
        ...(await eventLog.readBackwardForCurrentStep(currentStepId).catch(() => [])),
      );
    }
    ...
  }
}
```

Only events whose step is `currentStepId` are replayed, so the client never
receives the `banner`/`stream`/`log`/`status` events for previously visited
steps. This pairs with the breadcrumb defect (issue 001): the client-side
reducer is explicitly designed to accumulate **multiple** steps — the `banner`
case appends new steps and the transcript grows across step boundaries
(`reducer.ts:77-145`) — but it can only render what the server sends, and the
server sends a single step's history.

This behaviour was ported faithfully from the TUI path
(`run-attach.ts`), where current-step-only backlog is acceptable because the TUI
is a live terminal. For the web run view, where the user clicks into a run
specifically to review what happened, showing only the final step's output
defeats the core "observe a run" goal of the PRD.

Note this is partly a design decision, not a pure defect: full-history replay
has cost/size implications (the ring buffer and `backlogTruncated` signal exist
precisely to bound replay). The fix should be deliberate:

Suggested options:
1. Add a full-run backlog read for the initial web attach (e.g. a
   `readAllBacklog()` / read-from-seq-0 path) and send it as the `backlog`
   frame, relying on the existing `truncated` flag + the
   `transcript-truncated-notice` (`Transcript.tsx:29-36`) when the history is
   capped.
2. Or have the web client request the full history explicitly (e.g. attach with
   `fromSeq=0`), keeping the TUI's current-step default intact. The resume path
   (`fromSeq !== undefined`, `ws-attach.ts:377-391`) already reads *all* events
   since the provided seq via `readEventsSince`, so `fromSeq=0` may already
   produce the desired full transcript — verify and, if so, this is a small
   client change plus a server check that seq 0 is honoured.

Whichever path is chosen, add a test asserting that attaching to a run that has
visited multiple steps yields transcript entries for more than just the current
step.

## Triage

- Decision: `valid`
- Notes: Root cause confirmed. Lines 392-409 of `ws-attach.ts` use `currentStepBacklog(currentStepId)` / `readBackwardForCurrentStep(currentStepId)` on initial attach, returning only the current step's events. The `readEventsSince` path (used by the resume flow) already reads all events across all steps and handles truncation. Fix: replace the `else if (currentStepId !== null)` block with an `else` block that calls `readEventsSince(0)`. The `currentStepId !== null` guard is also dropped — a completed run with null `currentStepId` can still have prior-step history. Test added: multi-step run initial attach asserts backlog contains events from all steps, not just the current one.
