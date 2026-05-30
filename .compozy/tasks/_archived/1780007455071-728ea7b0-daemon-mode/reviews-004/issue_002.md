---
provider: manual
pr:
round: 4
round_created_at: 2026-05-28T10:58:38Z
status: resolved
file: src/infra/daemon/handlers/run-attach.ts
line: 79
severity: high
author: claude-code
provider_ref:
---

# Issue 002: Gap-read can duplicate events that also fire on live subscription

## Review Comment

`run-attach.ts:74-90` re-reads the event log via `readEventsSince(maxBacklogSeq)`
*after* registering the subscriber (line 55) "to close the race window".
The dedupe block (line 82-87) only deduplicates **within** the returned
backlog ("be defensive") — it does not coordinate with the live
notification stream the freshly registered subscriber feeds.

The duplication race:

1. attachSubscriber returns at T1; subscriber S2 is now in
   `record.subscribers`.
2. At T2 (during the gap-read), an event arrives. `makeEventLogObserver`
   in `run-manager.ts:520-524` snapshots `record.subscribers` *including*
   S2, then awaits `eventLog.append(...)`.
3. The disk write completes at T3 (still during gap-read). The gap-read
   `readEventsSince(maxBacklogSeq)` reads from disk and picks up the new
   entry → it ends up in `backlog`.
4. The observer (post-await) fires `sub.onEvent(entry)` for S2, which
   calls `ctx.notify("event.run.event", { runId, entry })` and writes a
   notification onto the connection.
5. On the client, the notification is captured in `earlyEvents`
   (`_attach-loop.ts:29-37`) because the early subscription is still
   live until `createTuiEventSource.subscribe()` runs.
6. `createTuiEventSource.subscribe()` in `_tui-source.ts:37-52` replays
   `backlog` first, then replays `earlyEvents` matching `runId` with no
   cross-dedup. The same entry is delivered to the TUI **twice**.

The user sees a duplicate banner / stream chunk / log line for any event
that races the attach window — exactly the symptom reviews-001 issue 003
was meant to eliminate.

Suggested fix: dedupe `earlyEvents` against `backlog` seqs in
`createTuiEventSource.subscribe`:

```ts
const backlogSeqs = new Set(backlog?.map((e) => e.seq) ?? []);
if (earlyEvents) {
  for (const params of earlyEvents) {
    if (params.runId === runId && !backlogSeqs.has(params.entry.seq)) {
      observer(params.entry.event);
    }
  }
}
```

The same dedupe needs to apply to live notifications received *after*
subscribe (the wire-ordered cap should also skip any seq already in
`backlog`) — but the cross-cut between backlog and earlyEvents is the
hot path.

## Triage

- Decision: `VALID`
- Notes: Race condition confirmed. Events arriving during the gap-read window (between subscriber registration and gap-read completion) can be included in both the backlog (from disk) and earlyEvents (from notification stream), causing duplicates in the TUI.

## Resolution

Implemented deduplication in `_tui-source.ts:subscribe()`:

1. Build a `Set<number>` of sequence numbers from the backlog as it's replayed
2. When replaying earlyEvents, skip any events with sequences already in the set
3. When subscribing to live notifications, skip any sequences already in the backlog set

This ensures events that arrived during the gap-read window are only delivered once, closing the race condition.

**Code changes:**
- `src/app/commands/_tui-source.ts`: Added `backlogSeqs` tracking and deduplication logic

**Verification:**
- TypeScript type check: PASS
- Tests for _tui-source.ts: 4/4 PASS
- Full test suite: 428/429 PASS (1 skip)
- No regressions introduced
