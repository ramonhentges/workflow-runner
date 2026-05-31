---
status: completed
title: POST /runs/:id/stop
type: backend
complexity: low
dependencies:
    - task_01
    - task_03
---

# Task 8: POST /runs/:id/stop

## Overview
Add the stop endpoint so a consumer can cancel a run (graceful then forceful) from the dashboard
without dropping to a terminal. It maps directly onto `RunManager.stop`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `POST /runs/:id/stop` resolving `:id` via `RunManager.get` and calling `RunManager.stop`.
- MUST return 200 `{ finalStatus }` reflecting the run's status after the stop attempt.
- An unknown run MUST return 404; an ambiguous prefix 409 (via the task-03 error map).
- Stopping an already-terminal run MUST be a no-op that returns its current status (not an error).
- The route MUST be registered into the OpenAPI document.
</requirements>

## Subtasks
- [x] 8.1 Register `POST /runs/:id/stop` with the `{ finalStatus }` response schema.
- [x] 8.2 Resolve `:id` and invoke `RunManager.stop`.
- [x] 8.3 Return the post-stop status; map unknown/ambiguous to 404/409.

## Implementation Details
Thin handler mirroring `src/infra/daemon/handlers/run-stop.ts`. `RunManager.stop` already handles
the graceful→forceful timeout and is a no-op for non-running runs; read the final status from the
run snapshot afterward. See TechSpec "API Endpoints" (`POST /runs/:id/stop` row).

### Relevant Files
- `src/infra/daemon/handlers/run-stop.ts` — existing stop handler to mirror.
- `src/infra/daemon/run-manager.ts` — `stop()` semantics (timeout, no-op on terminal).
- `src/infra/daemon/handlers/_resolve-run.ts` — run resolution helper.

### Dependent Files
- `src/app/api/` app from task 03 — route registration + error map.

### Related ADRs
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — stop is part of the thin slice.

## Deliverables
- `POST /runs/:id/stop` route returning `{ finalStatus }`.
- OpenAPI registration.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for stopping a run **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Stopping a running run returns 200 with a terminal `finalStatus` (aborted/failed/completed).
  - [x] Stopping an already-terminal run returns 200 with its existing status (no error).
  - [x] An unknown id returns 404; an ambiguous prefix returns 409.
- Integration tests:
  - [x] Against a live app, `POST /runs/:id/stop` transitions a running fixture run to a terminal state observable via `GET /runs/:id`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A dashboard can cancel a run and observe its terminal status.
- `/runs/:id/stop` is documented in `/openapi.json`.
