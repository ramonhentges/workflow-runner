---
provider: manual
pr:
round: 3
round_created_at: 2026-05-28T10:39:05Z
status: resolved
file: src/app/commands/_attach-loop.ts
line: 27
severity: high
author: claude-code
provider_ref:
---

# Issue 001: Early-subscription race fix bypassed for prefix-based attach

## Review Comment

The reviews-002 issue 004 fix in `_attach-loop.ts:26-44` adds an early
`client.subscribe` so that live events delivered in the same TCP segment as
the `run.attach` response are captured. The predicate is:

```ts
(n) => n.method === "event.run.event" && (n.params as { runId: RunId }).runId === runId
```

`runId` here is whatever the caller passed to `attachLoop`. For
`workflow-runner attach <prefix>` (PRD F3 happy path), `attach.ts:74` brands
the user's prefix as a `RunId` and forwards it unresolved:

```ts
resolvedRunId = asRunId(runIdInput);  // e.g. "kf2a"
...
return await attachFn(client, resolvedRunId);
```

The daemon's `run-attach.ts:51` notifies using the **resolved** canonical
runId (8-char id, never the prefix), so for any prefix shorter than the
canonical id (which is the normal case) the early-subscription predicate
never matches. Every event delivered between `run.attach` returning and
`tui.attachSource(source)` calling `source.subscribe(...)` is silently
discarded — exactly the regression that reviews-001 issue 011 fixed for the
main subscription, now reintroduced for the early window.

The main subscription created later in `_tui-source.ts:57-65` is correct
because it uses `resolvedRunId` returned from the RPC. The early one cannot,
because the resolved id is unknown until the RPC returns.

Suggested fixes (pick one):

1. Drop the runId filter on the early subscription (it lives only ~one RPC
   roundtrip and will be discarded after replay), then in
   `createTuiEventSource` filter `earlyEvents` by `resolvedRunId` before
   replay.
2. Capture *all* `event.run.event` notifications during the early window and
   key them by `n.params.runId`; after the RPC returns, replay only those
   whose key matches `result.runId`.

Option 1 is the smaller diff. Either way, `earlyEvents` should store the
notification (or `runId` + `entry`) rather than just `event`, so filtering
against the resolved id is possible.

## Triage

- Decision: `VALID`
- Root cause: The early subscription predicate in `_attach-loop.ts` filtered notifications by the user-provided `runId` (which could be a short prefix like "kf2a"), but the daemon notifies using the resolved canonical 8-char ID (e.g., "kf2adxyz"). For any prefix shorter than the canonical ID (the normal case), the filter never matched and events were silently discarded.
- Notes: Implemented Option 1 from the suggestion.

## Resolution

Fixed in three files:

### `_attach-loop.ts`
- Removed the `runId` filter from the early subscription (line 28): the subscription now captures all `event.run.event` notifications
- Changed `earlyEvents` from `RunnerEvent[]` to `Array<{ runId: RunId; entry: any }>` to store the full notification params (lines 26, 32)
- This allows filtering by the resolved ID after the RPC returns

### `_tui-source.ts`
- Updated the `earlyEvents` parameter type to `Array<{ runId: RunId; entry: EventLogEntry }>` (line 27)
- Added filtering logic when replaying early events: only events matching the resolved `runId` are replayed (lines 46-51)
- Extracts the event from the entry before passing to observer: `params.entry.event`

### `_tui-source.test.ts`
- Updated the test "replays early events..." to verify filtering works correctly
- Added a test case with an event from a different run to verify it's filtered out
- This ensures the race condition fix works for both full IDs and prefix-based attach

The fix ensures that events captured during the early subscription phase are properly filtered to match the resolved canonical run ID, closing the race condition window that reviews-001 issue 011 identified for the main subscription.
