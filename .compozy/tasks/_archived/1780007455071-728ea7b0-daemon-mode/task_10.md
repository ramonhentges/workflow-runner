---
status: completed
title: JSON-RPC handlers — interaction and daemon
type: infra
complexity: medium
dependencies:
  - task_07
  - task_08
---

# Task 10: JSON-RPC handlers — interaction and daemon

## Overview
Implement the four remaining JSON-RPC handlers — `run.attach`, `run.send`, `daemon.doctor`, `daemon.shutdown`. The `run.attach` handler is the most substantial: it must emit the backlog (from event log) as notifications, then continue streaming live events, and clean up cleanly on disconnect.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/handlers/run-attach.ts`, `run-send.ts`, `daemon-doctor.ts`, `daemon-shutdown.ts`.
- Each handler MUST export a factory function returning a typed `RpcHandler<…>`.
- `run.attach` MUST:
  - Resolve the run id prefix (using the shared `_resolve-run.ts` from task 09).
  - Synchronously reply with the result `{initialSnapshot}` from `RunManager.list()` filtered to that run.
  - Then emit `event.run.event` notifications for the backlog: call `EventLog.currentStepBacklog(currentStepId)` first; if it returns `null`, fall back to `EventLog.readBackwardForCurrentStep(currentStepId)`.
  - Then register a `RunSubscriber` via `RunManager.attachSubscriber` whose `onEvent` issues an `event.run.event` notification per event.
  - MUST also emit `event.run.statusChanged` notifications when the run's status changes.
  - MUST clean up the subscription on connection close (use `ctx.onClose(cb)` from task 07).
- `run.send` MUST resolve the run id, call `RunManager.sendInput(runId, message)`, return `{acceptedSeq}` (where `acceptedSeq` is the event-log seq of the persisted user-message event), error-map to `RUN_NOT_INTERACTIVE` when the current step is autonomous.
- `daemon.doctor` MUST return a `DoctorReport` (TechSpec → Monitoring) by inspecting: socket reachability (yes, since we got the request), lockfile validity, active-run count, active-subprocess count, total disk usage under `runs/`, orphan ephemeral ports. WARN thresholds: `subprocessCount > 8`, `diskUsageBytes > 1 GB`.
- `daemon.shutdown` MUST call `RunManager.shutdown()` and then resolve; the daemon process exit is initiated by `daemon.ts` (task 11) after receiving this response.
</requirements>

## Subtasks
- [x] 10.1 Implement `run-attach.ts` with backlog emission (memory then disk fallback) and live subscription.
- [x] 10.2 Implement `run-send.ts` with input queueing and seq return.
- [x] 10.3 Implement `daemon-doctor.ts` collecting each subsystem's status.
- [x] 10.4 Implement `daemon-shutdown.ts` triggering RunManager shutdown.
- [x] 10.5 Write unit tests for each handler with mock RunManager and a mock RpcContext that captures notifications and onClose callbacks.

## Implementation Details
Create the four handler files. The `run.attach` handler is the most complex; structure it as: (1) resolve, (2) synchronous result return, (3) backlog emit via `ctx.notify`, (4) register subscriber. Test using a mock `RpcContext` that records every `notify()` call and provides a manually-triggerable `onClose`. The `daemon.doctor` handler depends on inspecting the lockfile from disk; encapsulate this in a small `read-lockfile.ts` helper in `src/infra/daemon/` if it grows past a few lines. Disk-usage measurement: shallow recurse `runs/` and sum file sizes — for V1 don't worry about millisecond accuracy.

### Relevant Files
- `src/infra/daemon/protocol.ts` (task 06) — `RpcMethods`, `DoctorReport`, `RpcNotification`.
- `src/infra/daemon/rpc/server.ts` (task 07) — `RpcContext.notify` and `ctx.onClose`.
- `src/infra/daemon/run-manager.ts` (task 08) — `attachSubscriber`, `sendInput`, `shutdown`, `list`.
- `src/infra/daemon/event-log.ts` (task 05) — `currentStepBacklog`, `readBackwardForCurrentStep`.
- `src/infra/daemon/handlers/_resolve-run.ts` (task 09) — shared prefix-resolution helper.

### Dependent Files
- `src/infra/daemon/daemon.ts` (task 11) — registers all four handlers, also owns the lockfile that `daemon.doctor` reads.

### Related ADRs
- [ADR-004: JSON-RPC 2.0 over NDJSON for the Daemon Protocol](adrs/adr-004.md) — notification semantics for attach event streaming.
- [ADR-006: Attach Replay via Per-Run Ring Buffer + Disk Fallback](adrs/adr-006.md) — backlog emission strategy.

## Deliverables
- Four handler files implementing the documented surface.
- Mock `RpcContext` test helper in `src/infra/daemon/rpc/__tests__/mock-context.ts` (reusable by other handler tests).
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `run.attach` on a known run: result contains `{initialSnapshot}` matching `RunManager.get(runId).run.snapshot()`.
  - [x] `run.attach` emits `event.run.event` notifications for every entry returned by `EventLog.currentStepBacklog`.
  - [x] When `currentStepBacklog` returns `null`, `run.attach` calls `readBackwardForCurrentStep` and emits those entries instead.
  - [x] After backlog emission, `run.attach` registers a subscriber that receives subsequent runner events as notifications.
  - [x] On `ctx.onClose`, the subscriber is detached (`detachFn` from `attachSubscriber` is called exactly once).
  - [x] `run.send` on an interactive run resolves with `{acceptedSeq: <number>}` and the message is appended to the event log.
  - [x] `run.send` on an autonomous run rejects with `RUN_NOT_INTERACTIVE`.
  - [x] `daemon.doctor` returns a `DoctorReport` with all subsystems reported (socket, lockfile, runs, subprocesses, disk, ports).
  - [x] `daemon.doctor` reports `subprocesses: {status:"WARN", count: 9}` when active count exceeds 8.
  - [x] `daemon.doctor` reports `disk: {status:"WARN"}` when total bytes under `runs/` exceeds 1 GB (use a stubbed file-size source for the test).
  - [x] `daemon.shutdown` calls `RunManager.shutdown` exactly once and resolves with `{}`.
- Integration tests:
  - [ ] Covered by task 19's "Attach/detach" and "Daemon-restart discovery" scenarios.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `run.attach`'s subscription is reliably torn down on connection close (no test leaks subscribers across runs).
- Mock RpcContext is reusable from other handler test files.
