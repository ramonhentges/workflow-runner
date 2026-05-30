---
provider: manual
pr:
round: 5
round_created_at: 2026-05-28T16:40:33Z
status: resolved
file: src/app/commands/_attach-loop.ts
line: 33
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Early-event predicate uses startsWith on a value that is always a full RunId

## Review Comment

`attachLoop` filters its pre-attach subscription with `startsWith`:

```ts
const earlyUnsubscribe = client.subscribe(
  (n) =>
    n.method === "event.run.event" &&
    (n.params as { runId: RunId }).runId.startsWith(runId),
  ...
);
```

The accompanying comment claims this lets us match prefix attachments
("the user may have passed a prefix like 'who-is'"), but every call site
already passes the fully-resolved RunId returned by the daemon:

- `start.ts:65` — `attachFn(client, startResult.runId)` (the RPC result)
- `attach.ts:78` — `attachFn(client, resolvedRunId)` (selected from `run.ps`)

Both forms produce a fully-qualified ID, so `notif.runId.startsWith(runId)` is
effectively `notif.runId === runId` in correct usage. However, with
`startsWith` the predicate would also accept a notification whose `runId` has
the parameter as a *strict* prefix — e.g. a hypothetical run id `abc123def`
would match when attaching to `abc`. The downstream dedup in `_tui-source.ts`
filters by exact id so no foreign event reaches the TUI, but those extras still
consume slots in the bounded 5000-event early buffer (line 39-44), so a busy
unrelated run could evict this run's own early events before replay.

### Suggested fix

Use strict equality and update the stale comment:

```ts
const earlyUnsubscribe = client.subscribe(
  (n) =>
    n.method === "event.run.event" &&
    (n.params as { runId: RunId }).runId === runId,
  ...
);
```

If a future caller really does need prefix matching, resolve the prefix to a
full id (e.g. via `run.ps`) before invoking `attachLoop`, which is what
`attach.ts` already does.

## Triage

- Decision: `valid`
- Notes: Confirmed both call sites pass a fully-resolved RunId — `start.ts:65` uses `startResult.runId` (the RPC result) and `attach.ts:78` uses `resolvedRunId` (selected from `run.ps`). The `startsWith` predicate was never needed in practice and introduces a risk: if any run id happens to be a prefix of another (unlikely but possible), unrelated notifications would fill the bounded 5000-event early buffer and could evict real events for the target run. The stale comment on lines 29–31 describing prefix-matching should also be removed. Fix: replace `startsWith(runId)` with `=== runId` and update the comment.
