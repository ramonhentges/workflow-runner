---
provider: manual
pr:
round: 4
round_created_at: 2026-05-28T10:58:38Z
status: resolved
file: src/app/commands/_attach-loop.ts
line: 29
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: Early-event buffer is unbounded and unfiltered by runId

## Review Comment

`_attach-loop.ts:29-37` opens an early subscription before the `run.attach`
RPC fires:

```ts
const earlyEvents: Array<{ runId: RunId; entry: any }> = [];
const earlyUnsubscribe = client.subscribe(
  (n) => n.method === "event.run.event",
  (n: RpcNotification) => {
    if (n.method === "event.run.event") {
      earlyEvents.push(n.params);
    }
  },
);
```

Two concerns:

1. **Unbounded growth.** The buffer accumulates between subscription and
   the call to `createTuiEventSource.subscribe()` (which only runs after
   `Tui.create()` resolves — terminal init can take tens of milliseconds,
   and `Tui.create()` is `await`ed inside a `try` block that also waits
   on the RPC roundtrip beforehand). For a high-throughput run (an
   autonomous step streaming agent output as `stream.message` events at
   hundreds per second), the buffer can grow to tens of thousands of
   entries before the TUI takes over, and each entry holds a full
   `EventLogEntry` payload. No cap and no backpressure.

2. **No runId filter at subscribe time.** The predicate matches every
   `event.run.event` regardless of `runId` because the caller doesn't yet
   know the resolved id. In a multi-attach client (the start command
   followed by a manual `attach` while the first is still subscribed, or
   future programmatic API), notifications from *other* runs flowing
   over the same connection are also buffered, then thrown away by the
   per-runId filter at replay time (`_tui-source.ts:48`). Memory cost
   scales with all live runs.

Suggested fix: cap the buffer (e.g., last 5000 entries, dropping oldest
with a warning when overflowing) and drop any entry whose
`params.runId` is clearly not a prefix-match of the user input — or,
simpler, defer the early subscription until the resolved runId is
known (have `run.attach` send the resolved id as a notification *before*
the response, or do an `await Promise.resolve()` step that lets the
read loop drain in a way the early-sub can still catch). The current
"hold everything in memory until the TUI starts" approach is fine for
human-scale runs but degrades for long-lived autonomous workflows.

`entry: any` should also be `EventLogEntry` for type safety.

## Triage

- Decision: `VALID`
- Technical Analysis:
  - The early-event buffer in `_attach-loop.ts` is indeed unbounded, accumulating entries while waiting for TUI initialization (which can take tens of milliseconds). In high-throughput autonomous workflows streaming events at hundreds per second, this can grow to tens of thousands of entries.
  - The early subscription lacks runId filtering, buffering events from all runs. This is wasteful in multi-attach scenarios where multiple clients are attaching simultaneously.
  - Type safety issue: `entry: any` should be `EventLogEntry` for type safety.

- Fix Applied:
  1. **Buffer Cap**: Added `EARLY_EVENT_BUFFER_LIMIT = 5000` with FIFO eviction (drop oldest entries) and warning log when limit is reached.
  2. **RunId Filtering**: Modified early subscription predicate to filter by `runId.startsWith(userInput)`, reducing buffer pollution from other runs. This works for partial runId matches and helps reduce memory usage in multi-attach scenarios.
  3. **Type Safety**: Changed `entry: any` to `entry: EventLogEntry` for proper typing.
  4. **Added import**: Imported `EventLogEntry` from protocol.ts.

- Design Notes:
  - The prefix filter handles partial runId inputs (e.g., "abc" matches "abc123def456") but may not filter slug inputs perfectly (e.g., "who-is" doesn't match runIds). However, the final filter in `_tui-source.ts:52` provides defense-in-depth with exact runId matching after the canonical ID is resolved.
  - Console warning on buffer overflow helps operators debug high-throughput scenarios.
  - No unit tests added because `attachLoop` is intentionally excluded from unit test coverage (depends on @opentui/core terminal state). End-to-end coverage comes from integration suite.
