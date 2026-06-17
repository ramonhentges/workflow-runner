---
status: completed
title: Update `Bun.serve()` and replace loopback assertion with warning
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 03: Update `Bun.serve()` and replace loopback assertion with warning

## Overview

Use the resolved bind host in the `Bun.serve()` call instead of the hardcoded `127.0.0.1`, and replace the `assertLoopbackBind()` runtime assertion (which aborts startup on non-loopback binds) with a logged warning on non-loopback binds. This is the core runtime change that enables binding to any network interface.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `runDaemon()` in `src/infra/daemon/daemon.ts` MUST resolve the bind host via `resolveBindHost(opts)` at the same point where it resolves `configuredPort`
- `Bun.serve({ hostname })` MUST use the resolved bind host instead of the hardcoded `"127.0.0.1"`
- The post-listen `assertLoopbackBind(boundHostname)` block (lines 476-490) MUST be replaced: instead of aborting on non-loopback, log a WARN-level structured event and continue startup
- The WARN log event MUST have the shape: `{ level: "WARN", event: "api.bindNonLoopback", address: boundHostname, msg: "..." }`
- `assertLoopbackBind` MAY be kept as an unused export for backward compatibility, or removed if no other references exist — refer to the TechSpec decision
- Existing `assertLoopbackBind` tests in `daemon.test.ts` MUST be updated to verify warning behavior instead of throw behavior
</requirements>

## Subtasks

- [x] 03.1 Resolve bind host in `runDaemon()` alongside `configuredPort`
- [x] 03.2 Update `Bun.serve()` to use resolved bind host
- [x] 03.3 Replace the post-listen assertion block with a conditional WARN log when the bound hostname is not loopback
- [ ] 03.4 Thread the resolved hostname through to `createServerApp` if needed (depends on task_04 completion, or coordinate with task_04) — *deferred to task_04*
- [x] 03.5 Update `assertLoopbackBind` tests to verify warning behavior

## Implementation Details

See TechSpec "Implementation Design" section for the `RunDaemonOptions.bindHost` interface (already added in task_01) and the monitoring section for the structured log event shape. The key structural change is at `src/infra/daemon/daemon.ts:463-490` where `Bun.serve()` and the post-listen assertion live.

The warning replaces the try/catch assertion block with a simple if-guard:

```
if (boundHostname !== "127.0.0.1") {
  logger.log({ level: "WARN", event: "api.bindNonLoopback", address: boundHostname, msg: ... });
}
```

### Relevant Files

- `src/infra/daemon/daemon.ts` — Use resolved `bindHost` in `Bun.serve()`, replace `assertLoopbackBind` with WARN log
- `src/infra/daemon/daemon.test.ts` — Update `assertLoopbackBind` tests, add new tests for warning behavior

### Dependent Files

- `src/infra/daemon/daemon.test.ts` — Existing `assertLoopbackBind` tests will fail if not updated
- `src/app/api/app.ts` — May need `bindHost` threading to `createServerApp` (coordinated with task_04)

### Related ADRs

- [ADR-001: Configurable bind address for external access](../adrs/adr-001.md) — Replaces hard abort with warning per ADR decision

## Deliverables

- `Bun.serve()` using resolved bind hostname
- Non-loopback bind produces a WARN log instead of aborting startup
- Updated tests verifying warning behavior
- No regressions in startup sequence

## Tests

- Unit tests:
  - [x] "assertLoopbackBind no longer throws for non-loopback addresses" — the function (if kept) is a no-op or logs
  - [x] "post-listen block calls logger.log with WARN level for non-loopback hostname" — via `warnNonLoopbackBind` tests
  - [x] "post-listen block does not log warning when bound to 127.0.0.1"
  - [x] "Bun.serve() receives the resolved bind host" — verified by code inspection (`bindHost` passed directly to `Bun.serve({ hostname: bindHost })`)
- Integration tests:
  - [ ] "Daemon starts and responds on loopback when no --host is given (default)" — existing behavior unchanged, tested by full suite pass
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Daemon starts successfully with default loopback bind (no behavior change for existing users)
- Daemon starts and logs warning when bind host is non-loopback
- All existing daemon tests pass with updated assertion expectations
