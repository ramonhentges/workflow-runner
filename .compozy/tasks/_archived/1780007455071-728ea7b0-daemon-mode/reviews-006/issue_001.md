---
provider: manual
pr:
round: 6
round_created_at: 2026-05-28T16:56:48Z
status: resolved
file: src/infra/daemon/handlers/run-attach.ts
line: 83
severity: high
author: claude-code
provider_ref:
---

# Issue 001: Gap-read still drops events whose append is in-flight at attach

## Review Comment

`createRunAttachHandler` registers the subscriber at line 55 and then re-reads
disk via `readEventsSince(maxBacklogSeq)` (line 83) "to close the race
window". The observer in `run-manager.ts:533` snapshots subscribers
**before** awaiting `eventLog.append`:

```ts
const currentSubscribers = [...record.subscribers];
// ...
const entry = await eventLog.append(event, currentStepId).catch(() => null);
if (entry) { for (const sub of currentSubscribers) { ... } }
```

So an event whose `append` is queued on `EventLog.#writeChain` (or whose
write has started but not yet `sync()`-ed) at the moment the new subscriber
is added will:

1. Not appear in `currentSubscribers` (snapshot pre-dates `attachSubscriber`).
2. Not be visible to `readEventsSince` if the gap-read disk I/O races ahead
   of the pending write (the read does not await `#writeChain`).
3. Be delivered, when the write completes, only to the snapshot — which
   excludes the new subscriber.

The new subscriber therefore permanently misses that event. With the
default sync-per-append (~1ms per event on SSD) and a busy step, multiple
events can be in flight when an attach lands; each is at risk.

Fix: drain pending writes before gap-read. The simplest approach is to
expose `EventLog.flush()` / `EventLog.drain()` returning `this.#writeChain`
(the public API of `close()` already awaits it), and have the attach
handler `await eventLog.flush()` between `attachSubscriber` and
`readEventsSince(maxBacklogSeq)`. After the drain, every event whose
append started before subscriber registration is on disk and gap-read is
guaranteed to see it.

## Triage

- Decision: `valid`
- Notes: The race condition is confirmed. `makeEventLogObserver` in `run-manager.ts:533` snapshots
  `currentSubscribers` **before** `await eventLog.append(...)`, so any event whose append is queued
  on `EventLog.#writeChain` at the moment a new subscriber is registered will (a) not appear in the
  subscriber snapshot, (b) possibly not yet be flushed to disk when the gap-read fires, and (c) be
  delivered to the old snapshot only — permanently missing the new subscriber.

  Fix: expose `EventLog.flush()` that awaits `#writeChain`, then call `await eventLog.flush()` in
  the attach handler between `attachSubscriber` and the gap-read `readEventsSince`. This guarantees
  all in-flight appends are on disk before the gap-read executes.
