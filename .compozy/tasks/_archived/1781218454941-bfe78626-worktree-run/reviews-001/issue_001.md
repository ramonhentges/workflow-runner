---
provider: manual
pr:
round: 1
round_created_at: 2026-06-11T13:33:39Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 239
severity: high
author: claude-code
provider_ref:
---

# Issue 001: addWorktree failure leaks MCP server, event log, and run dir

## Review Comment

In `startRun`, the slot-reservation `try` block opens three resources in order
before the only late-failing call (`addWorktree`):

```ts
await this.#store.persist(run.snapshot());      // writes runDir snapshot to disk
record.eventLog = await EventLog.open(runDir);  // opens a file handle
record.mcpServer = await this.#createMcpServer();// starts an HTTP MCP server (port)
if (pendingWorktree) {
  await this.#gitWorktrees.addWorktree(pendingWorktree); // may throw
}
} catch (err) {
  this.#registry.delete(runId);                 // ← only cleanup performed
  if (err instanceof GitWorktreeError && err.code === "PATH_EXISTS") {
    throw new RunManagerError("WORKTREE_CONFLICT", err.message);
  }
  throw err;
}
```

When `addWorktree` throws — which is an expected, first-class error path
(`WORKTREE_CONFLICT` is a documented PRD failure: a non-worktree directory
occupies the computed sibling path) — the catch only removes the registry entry.
It never closes `record.mcpServer` or `record.eventLog`, and never removes the
already-persisted `runDir` snapshot. Consequences on every worktree conflict:

- **Leaked MCP HTTP server holding a port.** This directly feeds the daemon's
  `orphanPorts` doctor check and accumulates across conflicts in one process
  lifetime.
- **Leaked open event-log file descriptor.**
- **Orphaned snapshot on disk.** `discoverOnStartup` will resurrect it as an
  orphan run on the next daemon start.

The TechSpec's "Known Risks" claims this is "handled by the existing
registry-cleanup catch," but that catch is incomplete — it predates the added
worktree provisioning and only rolls back the in-memory slot.

The existing test `addWorktree PATH_EXISTS: maps to WORKTREE_CONFLICT and cleans
up the slot` (run-manager.test.ts:1374) does not catch this: it asserts only
`manager.list()` length, not that the server/log were closed. These tests do not
mock `createMcpServer`, so a real server is started and leaked when the test runs.

Suggested fix: in the catch block, close the resources before rethrowing, e.g.

```ts
} catch (err) {
  this.#registry.delete(runId);
  await record.mcpServer?.close().catch(() => {});
  await record.eventLog?.close().catch(() => {});
  // optionally: remove the persisted runDir so it is not later discovered as an orphan
  if (err instanceof GitWorktreeError && err.code === "PATH_EXISTS") {
    throw new RunManagerError("WORKTREE_CONFLICT", err.message);
  }
  throw err;
}
```

Extend the cleanup test to assert the MCP server's `close()` was invoked (e.g.
inject a `createMcpServer` returning a spy) and that no `runDir` snapshot remains.

## Triage

- Decision: `VALID`
- Root cause: In `startRun`, the slot-reservation `try` block opens an event-log
  file handle (`EventLog.open`) and an MCP HTTP server (`createMcpServer`) before
  the late-failing `addWorktree` call. The `catch` only ran
  `this.#registry.delete(runId)`, rolling back the in-memory slot but leaving the
  MCP server's HTTP port and the event-log FD open, and leaving the already
  persisted `runDir` snapshot on disk. On every `WORKTREE_CONFLICT` (a documented
  PRD failure path), this leaks a port (feeding the daemon's `orphanPorts` doctor
  check), leaks an FD, and seeds a phantom orphan run that `discoverOnStartup`
  resurrects on the next daemon start. The TechSpec's claim that the existing
  registry-cleanup catch handled this was incorrect — the catch predated worktree
  provisioning.
- Fix: In the `catch` block, before rethrowing, close `record.mcpServer` and
  `record.eventLog` (best-effort, nulling the fields) and `rm` the persisted
  `runDir` (recursive/force, best-effort). The FD is closed before the dir is
  removed since the log file lives inside `runDir`. The `RunStore` has no public
  `remove` method, so the dir is removed directly via `node:fs/promises` `rm` —
  the minimal change that keeps the fix within the single in-scope file
  (`run-manager.ts`); no `run-store.ts` change was needed.
- Tests: Extended the existing `addWorktree PATH_EXISTS` test to inject a
  `createMcpServer` spy and assert the server's `close()` was invoked, and to
  assert the `runs` directory is empty (no orphaned snapshot) after the conflict.
- Notes: Verified via `bun test src/infra/daemon/run-manager.test.ts` and
  `bun run typecheck`.
