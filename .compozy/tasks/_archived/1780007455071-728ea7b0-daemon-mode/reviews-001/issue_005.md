---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/app/commands/stop.ts
line: 44
severity: medium
author: claude-code
provider_ref:
---

# Issue 005: stop CLI always prints "aborted run X" even for terminal-state runs

## Review Comment

PRD F9 requires that `stop` on a run that is already in a terminal state be
"a no-op success with a clarifying message." `RunManager.stop` already
implements the no-op (returns immediately when `status !== "running"`), and
`run.stop` returns the actual `finalStatus` in its result. But
`src/app/commands/stop.ts:44` prints `aborted run ${runIdInput}` regardless,
so a user who stops a run that finished cleanly minutes ago sees a misleading
"aborted" message.

The `result.finalStatus` returned by the RPC is currently discarded.

Suggested fix: surface `finalStatus` in the output. For example:

```typescript
const { finalStatus } = await client.call("run.stop", { runId: asRunId(runIdInput) });
if (finalStatus === "aborted") {
  stdout.write(`aborted run ${runIdInput}\n`);
} else {
  stdout.write(`run ${runIdInput} already ${finalStatus} (no-op)\n`);
}
```

## Triage

- Decision: `valid`
- Notes: The `client.call("run.stop", ...)` call at line 43 discards the `{ finalStatus }` result. The protocol defines `result: { finalStatus: RunStatus }` and the handler returns the run's actual status, which for already-terminal runs will be "finished", "failed", or "aborted". The fix is to destructure `finalStatus` and branch on it: print "aborted run X" only when `finalStatus === "aborted"`, otherwise print "run X already <status> (no-op)" to match PRD F9. Tests need updating for the existing success case and a new case covering a terminal-state no-op response.
