---
provider: manual
pr:
round: 2
round_created_at: 2026-05-28T10:17:03Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 445
severity: medium
author: claude-code
provider_ref:
---

# Issue 005: Terminal-state persist failures are silently swallowed

## Review Comment

`#launchRunner` ends with

```ts
await this.#store.persist(record.run.snapshot()).catch(() => {});
this.#emitStatusChanged(record);
```

at both line 445 (normal completion) and line 458 (crash). The `.catch` is
unconditional: if writing `meta.json` fails (disk full, permission flip,
ENOSPC), the failure is dropped on the floor and there is no log line either.

The consequence is durability-corrupting: the in-memory `Run` is `completed`
(or `failed`/`crashed`), but the on-disk `meta.json` still says `running`. On
the next daemon restart, `RunStore.discoverAndMarkOrphans` will see the stale
`running` status and rewrite it as `crashed` with `endReason: "daemon
restart"` (run-store.ts:121–144). The user opens `ps` and sees a successful
run reported as crashed, with no audit trail of the original outcome.

Fix: log persist failures via the existing `DaemonLogger`. Even if the policy
remains "don't crash the daemon over a persist failure," the failure must be
recorded so the discrepancy on restart is investigable:

```ts
try {
  await this.#store.persist(record.run.snapshot());
} catch (err) {
  this.#logger?.log({
    level: "ERROR",
    event: "run.terminalPersistFailed",
    runId,
    msg: err instanceof Error ? err.message : String(err),
  });
}
```

(Threading the logger into `RunManager` is the same pattern `daemon.ts`
already uses for the RPC server.)

## Triage

- Decision: `valid`
- Root Cause: Terminal-state persist failures (lines 445, 464) are silently swallowed by `.catch(() => {})`. If disk I/O fails (ENOSPC, permission flip), the in-memory run state becomes inconsistent with the on-disk `meta.json`. On daemon restart, `discoverAndMarkOrphans` sees stale `running` status and rewrites the outcome as `crashed`, leading to data durability issues with no audit trail.
- Fix Approach: Thread optional `DaemonLogger` into `RunManager` constructor (following the pattern in `daemon.ts` for RPC server logging). Replace both `.catch(() => {})` blocks with try-catch that logs failures to the error event log before moving forward. Use optional chaining (`#logger?.log()`) so the logger is not required. Two locations require fixing:
  - Line 445: normal completion (summary success, failure, or abort)
  - Line 464: crash path (runner.run() threw)
- Notes: Fix is constrained to run-manager.ts and run-manager.test.ts (for test coverage). Update the constructor signature and add test(s) to verify errors are logged.
