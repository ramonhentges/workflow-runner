---
provider: manual
pr:
round: 6
round_created_at: 2026-05-28T16:56:48Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 387
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: openEventLog leaks file handles for terminal runs reopened on attach

## Review Comment

The fix for reviews-005 issue 002 closes `record.eventLog` in `#launchRunner`
on terminal completion (lines 474–477) and on error (lines 507–510), and
nulls `record.eventLog`. That part is correct. However `openEventLog`
(`run-manager.ts:387`) lazy-reopens for post-terminal attaches and caches
the new handle:

```ts
async openEventLog(runId: RunId): Promise<EventLog | null> {
  const record = this.#registry.get(runId);
  if (!record) return null;
  if (record.eventLog) return record.eventLog;
  try {
    const eventLog = await EventLog.open(join(this.#store.runsRoot, runId));
    record.eventLog = eventLog;
    return eventLog;
  } catch { return null; }
}
```

After a terminal run is reattached, `record.eventLog` holds an open
`FileHandle` for `events.jsonl` that nothing ever closes — `#launchRunner`
will not run again, `retryStep` is gated on `eligibleForRetry()`, and the
only close path is the global `shutdown()`. Every reattach to a different
terminal run accumulates one persistent FD. A long-lived daemon used for
diagnostics will eventually exhaust per-process FD limits.

Fix options:
- Do not cache when the run is in a terminal state — return a fresh handle
  and let the attach handler `close()` it when done. (Requires plumbing
  the close through the handler.)
- Reference-count opens: each `openEventLog` returns a handle the caller
  must release; the underlying FD closes when refcount drops to zero.
- Track per-attach handles and close them in the `ctx.onClose` callback in
  `run-attach.ts:97`.

The simplest defensive fix is the third: skip caching for terminal runs
and have `run-attach.ts` close the opened EventLog when the client
connection drops.

## Triage

- Decision: `valid`
- Root cause: `openEventLog` caches the re-opened handle in `record.eventLog` for terminal
  runs. Since `#launchRunner` will not run again and `retryStep` is gated on
  `eligibleForRetry()`, there is no close path for the cached handle until
  `shutdown()`. Each distinct terminal run that gets reattached accumulates one
  permanent open FD.
- Fix: (1) In `openEventLog`, skip caching when the run status is not `"running"` — return
  a fresh, caller-owned handle instead. (2) In `run-attach.ts`, open the event log once at
  the top of the handler (instead of inline at every usage point), and close the owned handle
  in the `ctx.onClose` callback. Tests added for both behaviors.
