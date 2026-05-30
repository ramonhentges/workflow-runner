---
provider: manual
pr:
round: 4
round_created_at: 2026-05-28T10:58:38Z
status: resolved
file: src/infra/daemon/handlers/run-attach.ts
line: 74
severity: medium
author: claude-code
provider_ref:
---

# Issue 004: Empty current-step backlog triggers full-history gap-read

## Review Comment

In `run-attach.ts`, the gap-read condition (line 74) fires when
`currentStepId !== null` regardless of whether the initial backlog
populated successfully:

```ts
let maxBacklogSeq = params.fromSeq ?? 0;
...
} else if (currentStepId !== null) {
  ...
  if (backlog.length > 0) {            // only updated when non-empty
    maxBacklogSeq = backlog[backlog.length - 1]!.seq;
  }
}
...
if (params.fromSeq !== undefined || currentStepId !== null) {
  ...
  const gapEvents = await eventLog.readEventsSince(maxBacklogSeq).catch(() => []);
  ...
}
```

When `currentStepBacklog` returns `null` and `readBackwardForCurrentStep`
also returns `[]` (no banner found on disk for the current step — possible
after partial log corruption, manual cleanup, or a banner never written
because the step crashed before emission), `maxBacklogSeq` stays at its
initial `0`. The gap-read then calls `readEventsSince(0)`, which returns
every persisted event (up to the `EVENT_LOG_BACKLOG_LIMIT` cap of 10000).

The user sees an initial attach for what should be a near-empty session
replay tens of MB of historical events. With the `readEventsSince` fast
path bug (issue 001) compounding this, the replay can also be *wrong*.

Suggested fix: track whether the initial backlog read was attempted-and-empty
separately from the gap-read trigger, and skip the gap-read in that case
(or scope it to the highest seq known to the runtime, e.g.,
`Run.snapshot().visitedStepIds` boundary or `record.eventLog.lastSeq`):

```ts
const initialAttempted = params.fromSeq !== undefined || currentStepId !== null;
const haveAnchor = backlog.length > 0 || params.fromSeq !== undefined;
if (initialAttempted && haveAnchor) {
  ...gap read with valid maxBacklogSeq...
}
```

Alternatively, expose `EventLog.lastSeq()` and clamp `maxBacklogSeq` to
it before invoking `readEventsSince`.

## Triage

**Status**: `valid`

**Analysis**: The issue is a real bug in the gap-read logic. When `currentStepId` exists but both `currentStepBacklog` returns null and `readBackwardForCurrentStep` returns [], `maxBacklogSeq` remains at 0. This causes `readEventsSince(0)` to fetch all persisted events (up to 10000 limit), instead of recognizing that there's no valid anchor point for the gap-read.

**Root Cause**: The condition for triggering gap-read (`if (params.fromSeq !== undefined || currentStepId !== null)`) doesn't distinguish between "we found backlog" and "we tried but found nothing". It only checks whether we *attempted* to read, not whether the attempt *succeeded*.

**Fix Implemented**: Changed the gap-read condition from checking if `currentStepId !== null` to checking if we have a valid anchor (`params.fromSeq !== undefined || backlog.length > 0`). This ensures we only perform the gap-read when:
1. The client is explicitly reconnecting (`fromSeq` provided), OR
2. We actually found some backlog events for the current step

When both conditions are false (no reconnect, no backlog found), the gap-read is skipped, preventing the full-history read.

**Verification**: 
- Added test case: "skips gap-read when currentStepId exists but backlog is empty"
- All 429 existing tests pass
- Type checking passes
- Build succeeds
- Fix prevents `maxBacklogSeq=0` from being used in the gap-read
