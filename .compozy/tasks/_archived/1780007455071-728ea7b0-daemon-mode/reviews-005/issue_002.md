---
provider: manual
pr:
round: 5
round_created_at: 2026-05-28T16:40:33Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 467
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: EventLog file handles leak when a run reaches a terminal state

## Review Comment

`#launchRunner` closes and nulls the per-run `McpServer` once a run reaches a
terminal status (`run-manager.ts:469-472` for the success path and
`run-manager.ts:497-500` for the error path), but the matching `EventLog` is
never closed — only `RunManager.shutdown()` (line 408-411) eventually closes
event logs, and only when the daemon itself shuts down. The same shape held in
reviews-002 issue 001 for `McpServer`; the fix made `McpServer` lifecycle
terminal-aware but left `EventLog` behind.

Every active run keeps an open `FileHandle` to `events.jsonl`. Over a long-lived
daemon (the primary use case per the PRD — F1/F5), each completed/failed/aborted
run continues to hold a file descriptor for the 24-hour terminal-retention
window. With the default `runLimit` of 16 and frequent retries (each retryStep
also opens a fresh log if the cached handle is missing — line 247), the
descriptor count grows monotonically until the soft ulimit is hit or the daemon
restarts. Late attachers can still call `openEventLog` (line 387-398) which
lazy-reopens the log, so closing on terminal is safe; only the cached handle
needs to be released.

### Suggested fix

Mirror the McpServer cleanup for `record.eventLog` in both terminal branches of
`#launchRunner`:

```ts
if (record.eventLog) {
  await record.eventLog.close().catch(() => {});
  record.eventLog = null;
}
```

`openEventLog` already reopens on demand, so any later `run.attach` against a
finished run keeps working.

## Triage

- Decision: `valid`
- Notes: The issue is confirmed. In `#launchRunner`, both the success path (after `runner.run()` resolves, lines 469-472) and the error/crash path (catch block, lines 497-500) close `mcpServer` but never close `eventLog`. The `shutdown()` method at line 400-415 closes event logs only when the daemon shuts down. For a long-lived daemon, every completed/failed/aborted run keeps its `FileHandle` open for the entire 24-hour terminal-retention window, causing monotonic fd growth. Fix: mirror the McpServer cleanup pattern for `record.eventLog` in both terminal branches of `#launchRunner`. `openEventLog` already lazy-reopens, so closing on terminal is safe.
