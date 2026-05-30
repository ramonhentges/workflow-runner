---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/app/commands/_tui-source.ts
line: 27
severity: high
author: claude-code
provider_ref:
---

# Issue 011: Attaching by prefix swallows every event and hides sent messages

## Review Comment

When a user runs `workflow-runner attach <prefix>` (an unambiguous id or slug
prefix — the PRD F3 happy path), the TUI shows no banner, no streamed agent
output, and no echo of messages the user types. The run actually keeps
progressing in the daemon and `run.send` does deliver the message to the
agent; the symptom is that the client filters every notification out before
it reaches the TUI.

Cause: `attach.ts:74` forwards the raw user input as the `RunId` used for
both the RPC call and the subscription predicate:

```typescript
resolvedRunId = asRunId(runIdInput); // e.g. "kf2a"
...
return await attachFn(client, resolvedRunId);
```

`attachLoop` then calls `client.call("run.attach", { runId: "kf2a" })`. The
daemon resolves the prefix via `resolveRun` and emits every
`event.run.event` / `event.run.statusChanged` notification with the *full*
id (`"fk2a9xeh"`) in `params.runId` (see `run-attach.ts:26,33,75-83` and
`run-manager.ts:387-394`).

Meanwhile the client subscription, built in `_tui-source.ts:27` and
`_status-watcher.ts:24`, filters notifications by strict equality against the
prefix the user typed:

```typescript
(n.params as { runId: RunId }).runId === runId  // "fk2a9xeh" === "kf2a" → false
```

So every backlog entry, every live event, and every status change is dropped
on the client. The user perceives "chat data does not appear" and "messages
are not delivered" (the latter is misleading — the daemon *did* deliver the
message, but the user never sees the resulting agent response).

The bug does not surface for `workflow-runner start <workflow>` because
`run.start` returns the canonical full id, nor for `attach` with no arg
because `attach.ts:72` picks `active[0].id` from `run.ps` (also the full id).

Suggested fix: have the daemon return the resolved id in `run.attach`'s
result and have the client subscribe with *that* id, not the user input.

1. Extend the protocol:
   ```typescript
   // src/infra/daemon/protocol.ts
   "run.attach": {
     params: { runId: RunId; fromSeq?: number };
     result: { runId: RunId; initialSnapshot: RunSnapshot };
   };
   ```
2. In `run-attach.ts`, return `{ runId, initialSnapshot: snapshot }`
   (`runId` is already in scope from `resolveRun`).
3. In `attachLoop` / `_tui-source.ts` / `_status-watcher.ts`, take the
   resolved `runId` from the attach result and use it for the subscription
   predicate.

Add an integration test that calls `run.attach` with a slug or id prefix and
asserts that the first banner event reaches the subscriber.

## Triage

- Decision: `VALID`
- Notes: The root cause analysis in the issue is accurate. The bug is that the client subscribes with the user-provided prefix string (e.g. "kf2a") as the `runId`, but the daemon emits notifications with the full resolved ID (e.g. "kf2a9xeh"). The strict equality filter in `_tui-source.ts:27` and `_status-watcher.ts:24` drops every notification.

  Fix applied:
  1. **`protocol.ts`**: Extended `run.attach` result to include `{ runId: RunId }` — the daemon now returns the resolved full ID.
  2. **`run-attach.ts`**: Changed `return { initialSnapshot: snapshot }` to `return { runId, initialSnapshot: snapshot }`.
  3. **`_attach-loop.ts`**: Destructures `runId` from the `run.attach` result and uses the resolved `runId` (not the input) for `createTuiEventSource` and `watchExitCode`. This ensures the subscription predicate filters by the full ID, matching the daemon's notifications.
  4. **`protocol.test.ts`**: Updated compile-time type assertion to include `runId` in the result.
  5. **`handlers.test.ts`**: Updated attach handler test to assert `result.runId` equals the resolved ID.
  6. **Integration test**: Added `"attach by runId prefix returns resolved full runId and delivers events"` — uses a prefix to call `run.attach`, asserts the returned `runId` is the full ID, and verifies that banner events reach a subscriber filtered by the resolved runId.

  Files changed:
  - `src/infra/daemon/protocol.ts`
  - `src/infra/daemon/handlers/run-attach.ts`
  - `src/app/commands/_attach-loop.ts`
  - `src/infra/daemon/protocol.test.ts`
  - `src/infra/daemon/handlers/handlers.test.ts`
  - `src/infra/daemon/__tests__/integration/attach-detach.test.ts`
