---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/infra/daemon/handlers/run-attach.ts
line: 61
severity: high
author: claude-code
provider_ref:
---

# Issue 003: Attach replay can duplicate events due to ring/notify race

## Review Comment

`run-attach.ts` registers the subscriber synchronously (live=false) and then
schedules a microtask that (a) reads `currentStepBacklog` from the ring, then
(b) flushes backlog, then (c) flushes any events buffered while live=false.
The intent is to avoid losing events, but it can deliver the same
`EventLogEntry` twice.

`EventLog.#appendPersisted` writes to disk, then synchronously calls
`#appendToRing(entry)`, then resolves the promise. `RunManager`'s observer
notifies subscribers only after the `eventLog.append(...)` await resolves
(see `makeEventLogObserver` in `run-manager.ts:460-481`). Because the ring is
mutated *before* subscribers are notified, the following ordering is reachable:

1. attach handler registers subscriber.
2. Event X's `append` resolves: ring already contains X.
3. attach microtask runs `currentStepBacklog(...)` → backlog includes X.
4. Observer notifies the new subscriber → X is pushed into `bufferedEvents`.
5. Drain emits backlog (X), then bufferedEvents (X). Client receives X twice.

The duplicates are not theoretical — any event that lands while the attach
result is in flight can hit this window.

Suggested fix: track `lastBacklogSeq = max(seq in backlog)` and skip
`bufferedEvents` entries whose seq is ≤ `lastBacklogSeq`. Apply the same
filter to `event.run.event` notifications received after `live = true` is
set, so a recently-replayed entry is not re-delivered if it was added to the
ring just before the snapshot.

```typescript
const seenSeqs = new Set(backlog.map((e) => e.seq));
for (const entry of bufferedEvents) {
  if (seenSeqs.has(entry.seq)) continue;
  void ctx.notify("event.run.event", { runId, entry });
}
```

## Triage

- Decision: `valid`
- Notes: The race is confirmed. `currentStepBacklog` reads the ring after `#appendToRing` has already mutated it, and `makeEventLogObserver` may have already notified the subscriber (while `live=false`) before M1 runs. When both happen, the same entry lands in `backlog` and `bufferedEvents`, causing a duplicate delivery. Fix: collect `seq` numbers from the backlog into a `Set` and skip `bufferedEvents` entries whose seq is already present.
