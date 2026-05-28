---
provider: manual
pr:
round: 6
round_created_at: 2026-05-28T16:56:48Z
status: resolved
file: src/infra/daemon/event-log.ts
line: 216
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: readEventsSince silently truncates at EVENT_LOG_BACKLOG_LIMIT

## Review Comment

`readEventsSince` enforces a hard cap of `EVENT_LOG_BACKLOG_LIMIT` (10000)
to avoid OOM on long disconnects (line 216):

```ts
if (result.length >= EVENT_LOG_BACKLOG_LIMIT) {
  return result;
}
```

The cap returns the first 10000 entries past `fromSeq` and discards the
rest. The function signature and call sites (`run-attach.ts:23`,
`run-attach.ts:83`) treat the result as the full set of events with
`seq > fromSeq` — there is no marker, exception, or `truncated: true`
field telling the caller "you got 10000 of N". The attach handler appends
these to `backlog` and the client uses them to seed the TUI. Any events
past the 10000th in the gap are silently dropped: the live subscription
only delivers events newer than the moment it registered, so the events
between `maxBacklogSeq + cap` and `subscriber registration time` are lost.

At ~100 events/sec (stream-heavy interactive runs), that is roughly a
100-second disconnect before silent loss starts. PRD F3 ("attach can
re-attach to a run") and the `fromSeq` resume contract make this a
correctness concern, not just a defensive cap.

Fix: signal truncation to the caller. Two reasonable options:

```ts
// Option A: return a flag.
return { entries: result, truncated: result.length >= LIMIT };
```

```ts
// Option B: caller passes a max and gets back the last seq read,
// then re-calls if truncated.
async readEventsSince(fromSeq: number, opts?: { limit?: number }): Promise<EventLogEntry[]>
```

`run-attach.ts` can then either page through, or include a
`backlogTruncated` field in the RPC result so the client knows to fetch
the remainder via a follow-up `fromSeq` request.

## Triage

- Decision: `valid`
- Notes:

The issue is real and correctness-impacting. `readEventsSince` returns at most 10000 entries with no
signal to the caller. In `run-attach.ts` the two call sites (initial backlog at line 28, gap-fill at
line 84) both consume the return as a flat array. The live subscriber is registered only AFTER the
backlog read, covering `subscriberRegistrationTime+`. Events between `backlogEnd` and
`subscriberRegistration` are permanently lost if the cap was hit on the initial read.

**Root cause:** hard cap early-return at line 216 of `event-log.ts` returns the partial result
without any indicator, and `run-attach.ts` has no way to detect the truncation.

**Fix approach (Option A):** export a `ReadEventsSinceResult` type `{ entries, truncated }`, change
the return type of `readEventsSince`, and propagate `backlogTruncated` in the RPC response so
clients can detect and handle the situation.

Files touched beyond the scoped `event-log.ts`:
- `src/infra/daemon/handlers/run-attach.ts` — must destructure the new return shape and forward
  `backlogTruncated` in the RPC result; unavoidable.
- `src/infra/daemon/protocol.ts` — must add `backlogTruncated: boolean` to `run.attach` result
  type; unavoidable.
- `src/infra/daemon/protocol.test.ts` — compile-time type smoke-test must include the new field.
- `src/infra/daemon/handlers/handlers.test.ts` — `makeFakeEventLog` mock of `readEventsSince` must
  return the new shape to keep the handler tests passing.
