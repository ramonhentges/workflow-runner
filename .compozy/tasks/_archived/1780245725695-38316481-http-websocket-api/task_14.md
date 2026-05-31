---
status: completed
title: Graceful shutdown drain (WS + listener + discovery cleanup)
type: backend
complexity: medium
dependencies:
  - task_13
---

# Task 14: Graceful shutdown drain (WS + listener + discovery cleanup)

## Overview
Extend the daemon's graceful-shutdown sequence so it drains open WebSocket clients and stops the API
listener before tearing down the run manager and removing the socket/lockfile, and removes the
discovery file. Today shutdown stops the UDS listener and closes the run manager with no awareness of
the new HTTP/WS listener.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST extend `makeShutdown`/`ShutdownDeps` in `src/infra/daemon/daemon.ts` to accept the API server
  handle and the discovery-file path.
- The shutdown order MUST be: stop accepting new connections → send a close frame to open WS clients
  and wait a brief grace period → stop the API listener → existing `runManager.shutdown()` → remove
  socket/lockfile/`daemon.json`.
- MUST remain idempotent (repeat invocations are no-ops), preserving current `makeShutdown` behavior.
- MUST handle the case of zero open WS clients without delay.
- The discovery file (`daemon.json`) MUST be removed on shutdown.
</requirements>

## Subtasks
- [x] 14.1 Add the API server handle + discovery-file path to `ShutdownDeps`.
- [x] 14.2 Drain WS clients (close frame + brief grace) and stop the API listener before run-manager teardown.
- [x] 14.3 Remove `daemon.json` alongside the socket/lockfile cleanup.
- [x] 14.4 Preserve idempotency and the zero-client fast path.

## Implementation Details
Modify `makeShutdown` (currently stops the UDS listener then `runManager.shutdown()`) so the API
drain happens first. Reuse the existing idempotency guard and signal wiring in `runDaemon`. The WS
drain coordinates with the task-12 connection registry (close frame + grace period). See TechSpec
"Impact Analysis" (daemon.ts row), "Monitoring" (`api.shutdownDrain`), and ADR-005 shutdown sequence.

### Relevant Files
- `src/infra/daemon/daemon.ts` — `makeShutdown`, `ShutdownDeps`, `runDaemon` signal wiring.
- `src/app/api/` listener handle + WS connection registry (tasks 12/13).
- `src/infra/daemon/handlers/daemon-shutdown.ts` — `daemon.shutdown` RPC trigger path.

### Dependent Files
- `src/infra/daemon/daemon.test.ts` — shutdown-ordering tests to extend.

### Related ADRs
- [ADR-005: In-process Hono listener](../adrs/adr-005.md) — drain-before-teardown shutdown sequence + discovery-file cleanup.

## Deliverables
- Extended `makeShutdown` draining WS + stopping the listener + removing `daemon.json`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the shutdown drain **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Shutdown stops the API listener and removes `daemon.json` before the socket/lockfile are removed.
  - [x] Shutdown is idempotent — a second invocation is a no-op.
  - [x] With zero open WS clients, shutdown completes without waiting out the grace period.
- Integration tests:
  - [x] An open WS client receives a close frame and the listener stops before run-manager teardown completes (observed ordering).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Open WS clients are drained cleanly on SIGTERM/SIGINT/`daemon.shutdown`.
- No stale `daemon.json`/socket/lockfile remain after shutdown.
