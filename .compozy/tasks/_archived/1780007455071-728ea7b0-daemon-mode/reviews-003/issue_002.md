---
provider: manual
pr:
round: 3
round_created_at: 2026-05-28T10:39:05Z
status: resolved
file: src/infra/daemon/handlers/run-attach.ts
line: 16
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: run.attach with fromSeq race-drops in-flight events

## Review Comment

The reviews-002 issue 003 fix in `run-attach.ts:16-25` honors `fromSeq` by
reading historical events from disk **before** registering the live
subscriber:

```ts
if (params.fromSeq !== undefined) {
  ...
  backlog.push(...(await eventLog.readEventsSince(params.fromSeq)...));
} ...
detach = rm.attachSubscriber(runId, { onEvent: ..., onStatusChanged: ... });
```

Any event whose disk write completes **between** `readEventsSince` returning
and `attachSubscriber` registering is lost:

1. `readEventsSince` reads files A; entry E (seq=N+1) is not yet on disk.
2. Observer's `eventLog.append(E)` resolves; E is now on disk.
   `makeEventLogObserver` in `run-manager.ts:520-541` already snapshotted
   `currentSubscribers` **before** the await (line 523), so the new
   subscriber that the attach handler is about to add is **not** in the
   snapshot.
3. Attach handler calls `rm.attachSubscriber(...)` → new subscriber added.
4. Observer iterates `currentSubscribers` — new subscriber missed E.

E is not in backlog (read finished before write) and not delivered live
(snapshot taken before subscribe). Net result: resume drops E, breaking the
"`fromSeq` lets a client resume after a transient disconnect" contract that
motivated the fix.

The pre-existing `currentStepBacklog` path has the same race window, but
its impact was bounded to "miss the most recent banner-frame events". For
`fromSeq`, the contract is strictly stronger — clients expect lossless
catch-up.

Suggested fix: register the subscriber **first** with a buffer, then read
backlog from disk, then drain the buffer while deduplicating against backlog
by `entry.seq`. Equivalently, after registering the subscriber, re-read
events with `seq > max(backlog.seq)` to close the gap. Either approach
removes the lost-event window.

## Triage

- Decision: `VALID` — Race condition is real and fix is required
- Technical reasoning:
  - The race exists because `makeEventLogObserver` in run-manager.ts snapshots `currentSubscribers` before awaiting `eventLog.append()` (line 523)
  - Events written between `readEventsSince()` returning and `attachSubscriber()` registering the new subscriber are lost
  - New subscriber is not in the snapshot, so event notifications miss it
  - Backlog read completed before the write, so event is not in the backlog either
  - Fix is correct: register subscriber, read backlog, then re-read with seq > max(backlog.seq) to close the gap
  - The pre-existing `currentStepBacklog` path has the same race but lower impact (just current step events)

## Implementation

- Lines 16-28: Track `maxBacklogSeq` while reading initial backlog
- Lines 54-68: Register subscriber (now in the snapshot for new events)
- Lines 70-90: Close race window by re-reading events > maxBacklogSeq and deduplicating
- Tests added: Two new tests verify fromSeq path and deduplication logic
- Verification: All 424 tests pass, including 2 new fromSeq-specific tests

## Notes

- The fix follows the "re-read events with seq > max(backlog.seq)" approach suggested in the issue
- Deduplication is defensive against edge cases where events somehow appear in both reads
- The comment on lines 70-73 explains the race condition and fix clearly
