---
status: completed
title: POST /runs (start with workflowPath + required cwd)
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
  - task_03
---

# Task 7: POST /runs (start with workflowPath + required cwd)

## Overview

Add the run-start endpoint so a consumer can launch a workflow against a chosen project directory
from HTTP. Because an HTTP caller has no ambient shell, both the workflow path and the spawn
directory (`cwd`) are required in the request body.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `POST /runs` accepting a `StartRunRequest` body (`workflowPath`, `cwd` — both required).
- A missing/blank `cwd` or `workflowPath` MUST return 400; omitting `cwd` MUST NOT silently default.
- MUST call `RunManager.startRun(workflowPath, cwd)` (task 02) and return 201 `{ runId, slug }`.
- An invalid workflow MUST return 400 (WORKFLOW_INVALID) and a run-limit breach 429
  (RUN_LIMIT_REACHED) via the task-03 error map.
- The route MUST be registered into the OpenAPI document.
</requirements>

## Subtasks

- [x] 7.1 Register `POST /runs` with `StartRunRequest` body validation and the `{ runId, slug }` response.
- [x] 7.2 Reject missing/blank `cwd` or `workflowPath` with 400 before invoking RunManager.
- [x] 7.3 Call `RunManager.startRun(workflowPath, cwd)` and return 201.
- [x] 7.4 Map WORKFLOW_INVALID→400 and RUN_LIMIT_REACHED→429 through the shared error map.

## Implementation Details

Thin handler over `RunManager.startRun` (extended in task 02 to require `cwd`). Mirror the error
handling in `src/infra/daemon/handlers/run-start.ts` (WorkflowConfigError → WORKFLOW_INVALID,
RunManagerError passthrough). Body validation comes from the `StartRunRequest` Zod schema. See
TechSpec "API Endpoints" (`POST /runs` row) and "Key Decisions" (cwd required over HTTP).

### Relevant Files

- `src/infra/daemon/handlers/run-start.ts` — existing error mapping to mirror.
- `src/infra/daemon/run-manager.ts` — `startRun(workflowPath, cwd)`.
- `src/domain/workflow.ts` — `WorkflowConfigError` for invalid workflows.
- `src/app/api/schema.ts` — `StartRunRequest`.

### Dependent Files

- `src/app/api/` app from task 03 — route registration + error map.
- Task 12 (WS) / Task 10 (events) — operate on runs created here in integration tests.

### Related ADRs

- [ADR-002: V1 surface expansion — retry-step, health, and explicit spawn path](../adrs/adr-002.md) — explicit spawn path.
- [ADR-003: RunManager is the shared application service](../adrs/adr-003.md) — `startRun(workflowPath, cwd)` shared signature.

## Deliverables

- `POST /runs` route with required `workflowPath` + `cwd`.
- OpenAPI registration.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for run creation **(REQUIRED)**

## Tests

- Unit tests:
  - [x] `POST /runs` with valid `{workflowPath, cwd}` returns 201 `{ runId, slug }` and calls `startRun` with that cwd.
  - [x] A body missing `cwd` returns 400 and does not call `startRun`.
  - [x] An invalid workflow path returns 400 (WORKFLOW_INVALID); exceeding the run limit returns 429.
- Integration tests:
  - [x] Against a live app (fixture session factory), `POST /runs` launches a run that subsequently appears in `GET /runs`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- A consumer can start a run with an explicit working directory; omitting cwd is a 400.
- `/runs` POST is documented in `/openapi.json`.
