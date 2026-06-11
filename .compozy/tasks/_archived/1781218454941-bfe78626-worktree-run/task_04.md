---
status: completed
title: RPC run.start branch param, handlers, and worktree error codes
type: backend
complexity: medium
dependencies:
  - task_03
---

# Task 4: RPC run.start branch param, handlers, and worktree error codes

## Overview
Thread the optional `branch` through the daemon's JSON-RPC surface and expose the isolated run's `worktreePath`/`branch` in `run.ps`. Add the two new error codes and verify the whole vertical with daemon-harness integration tests, including concurrency and reuse behavior.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `run.start` params MUST accept an optional `branch: string` and the handler MUST forward it to `RunManager.startRun`.
- `RpcErrorCode` MUST gain `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT` entries; the run-start handler MUST map the corresponding `RunManagerError` to RPC errors.
- `RunListEntry` MUST gain optional `worktreePath` and `branch`, and the `run.ps` handler MUST populate them from the snapshot.
- Existing non-isolated `run.start`/`run.ps` behavior MUST be unchanged when `branch` is omitted.
- Daemon-harness integration tests MUST cover the isolated-run lifecycle, distinct-branch concurrency, and same-branch reuse.
</requirements>

## Subtasks
- [x] 4.1 Add optional `branch` to the `run.start` params type and the start handler forwarding.
- [x] 4.2 Add `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT` to `RpcErrorCode` and map them in the start handler. (Codes pre-existed from task_03; mapping is covered by the generic `RunManagerError` → `RpcError` catch — verified by unit tests.)
- [x] 4.3 Add optional `worktreePath`/`branch` to `RunListEntry` and populate them in the `run.ps` handler.
- [x] 4.4 Extend daemon-harness integration tests for isolation, concurrency, and reuse.

## Implementation Details
Modify `src/infra/daemon/protocol.ts` (`run.start` params, `RunListEntry`, `RpcErrorCode`), `src/infra/daemon/handlers/run-start.ts` (forward `branch`, map new errors alongside the existing `RunManagerError`/`WorkflowConfigError` handling), and `src/infra/daemon/handlers/run-ps.ts` (emit the two fields). Extend the harness under `src/infra/daemon/__tests__/integration/`, modeled on `concurrent-runs.test.ts`, adding git-repo fixtures. See TechSpec "API Endpoints", "Testing Approach", and ADR-005.

### Relevant Files
- `src/infra/daemon/protocol.ts` — `RpcMethods["run.start"]`, `RunListEntry`, `RpcErrorCode`.
- `src/infra/daemon/handlers/run-start.ts` — forward `branch`; map `NOT_A_GIT_REPO`/`WORKTREE_CONFLICT`.
- `src/infra/daemon/handlers/run-ps.ts` — populate `worktreePath`/`branch` (note: it currently omits even `cwd`).
- `src/infra/daemon/__tests__/integration/concurrent-runs.test.ts` — pattern for harness-based concurrency tests.

### Dependent Files
- `src/app/api/error-map.ts` — maps the new codes to HTTP status (task_05).
- `src/infra/client/format.ts` — renders `RunListEntry` fields (task_06).

### Related ADRs
- [ADR-005: Reuse an existing worktree for a branch instead of erroring](adrs/adr-005.md) — Drives the reuse integration test and removes a same-branch conflict case.
- [ADR-004: Represent isolation as worktreePath + branch on the run snapshot](adrs/adr-004.md) — Fields surfaced via `RunListEntry`.

## Deliverables
- `run.start` accepting optional `branch`; `run.ps` emitting `worktreePath`/`branch`.
- `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT` codes mapped in the start handler.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests via the daemon harness with real git repositories **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `run.start` handler forwards a provided `branch` to `RunManager.startRun`.
  - [ ] `RunManagerError("NOT_A_GIT_REPO")` maps to the `NOT_A_GIT_REPO` RPC error.
  - [ ] `RunManagerError("WORKTREE_CONFLICT")` maps to the `WORKTREE_CONFLICT` RPC error.
  - [ ] `run.ps` handler emits `worktreePath`/`branch` for an isolated run and omits them for a non-isolated run.
- Integration tests (daemon harness + temp git repos):
  - [ ] Start an isolated run via the client against a real repo; the worktree directory exists on the branch and the run reaches completed.
  - [ ] Two isolated runs on distinct branches over the same repo both complete with no lost edits.
  - [ ] A second isolated run on a branch that already has a worktree runs in the same existing worktree path (no error).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `branch` flows end-to-end through the RPC layer; isolated runs report `worktreePath`/`branch` in `run.ps`
- New error codes are returned for non-repo and path-conflict cases
