---
status: completed
title: Run-active guard helper
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 2: Run-active guard helper

## Overview
Provide a small, well-tested helper that answers "is there a live run for this
workflow file?" so the delete and rename routes (task_03) can refuse
identity-changing operations while a run is in progress. Extracting it keeps that
run-aware behavior in one tested place rather than duplicated across two routes.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST expose a helper that, given a resolved workflow file path (or `cwd` + bare name) and the `RunManager`, reports whether any run with status `running` has a matching `workflowPath`.
- MUST consult `RunManager.list({ includeOldTerminal: true })` read-only and MUST NOT mutate run state.
- MUST treat only `running` status as blocking; terminal statuses (`completed`/`failed`/`crashed`/`aborted`) MUST NOT block.
- MUST compare against the same absolute path form the CRUD routes resolve, so matching is exact.
- SHOULD be a pure function over the run list to remain trivially unit-testable with a stub.
</requirements>

## Subtasks
- [x] 2.1 Implement the guard helper (input: workflow file path + run snapshots; output: boolean or matching run id).
- [x] 2.2 Ensure path comparison matches the CRUD routes' resolution form.
- [x] 2.3 Decide the helper's home (colocated with CRUD route module or a small `run-manager` read helper) per TechSpec.
- [x] 2.4 Unit-test blocking and non-blocking cases with stubbed run snapshots.

## Implementation Details
Implement as a pure helper taking the run snapshot list (so tests need no real
daemon). The route layer (task_03) passes `RunManager.list(...)` output and the
resolved file path. `RunSnapshot` already carries `workflowPath` and `status`.
See TechSpec "Component Overview → Run guard" and "Run guard" testing notes. The
new error code `WORKFLOW_RUN_ACTIVE` (task_01) is thrown by the caller, not
necessarily by the helper.

### Relevant Files
- `src/infra/daemon/run-manager.ts` — `list()` and `RunSnapshot` (`workflowPath`, `status`).
- `src/infra/daemon/protocol.ts` — `WORKFLOW_RUN_ACTIVE` code (from task_01).
- `src/infra/daemon/run-manager.test.ts` — patterns for stubbing run records.

### Dependent Files
- `src/app/api/routes/workflow-crud.ts` (task_03) — calls the guard for delete and rename.

### Related ADRs
- [ADR-003: Run-aware deletion — block while running, plain confirm otherwise](../adrs/adr-003.md) — the behavior this guard enforces.

## Deliverables
- A pure, exported run-active guard helper.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests proving the guard reflects real `RunManager.list()` output **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Returns blocking when a `running` run's `workflowPath` equals the target path.
  - [x] Returns non-blocking when the only matching run is `completed`.
  - [x] Returns non-blocking when no run references the target path.
  - [x] Distinguishes two workflows in the same `cwd` (matches by full path, not directory).
- Integration tests:
  - [x] Against a `RunManager` with one active run, the guard reports the active workflow as blocked and others as free.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Helper importable by the CRUD route task
- No mutation of run state
