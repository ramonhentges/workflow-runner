---
status: completed
title: POST /runs/:id/retry-step
type: backend
complexity: low
dependencies:
  - task_01
  - task_03
---

# Task 9: POST /runs/:id/retry-step

## Overview
Add the retry-step endpoint so a UI can recover a failed run in place by re-running its failing
step, rather than forcing the user back to a terminal or restarting from scratch. It maps onto
`RunManager.retryStep`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `POST /runs/:id/retry-step` resolving `:id` via `RunManager.get` and calling
  `RunManager.retryStep`.
- MUST return 200 `{ resumedStepId }` identifying the step that was retried.
- A run that is not retry-eligible MUST return 409 (RUN_NOT_RETRY_ELIGIBLE); an unknown run 404;
  an ambiguous prefix 409 — all via the task-03 error map.
- The route MUST be registered into the OpenAPI document.
</requirements>

## Subtasks
- [x] 9.1 Register `POST /runs/:id/retry-step` with the `{ resumedStepId }` response schema.
- [x] 9.2 Resolve `:id` and invoke `RunManager.retryStep`.
- [x] 9.3 Map RUN_NOT_RETRY_ELIGIBLE→409 and unknown→404 through the shared error map.

## Implementation Details
Thin handler mirroring `src/infra/daemon/handlers/run-retry-step.ts`. `RunManager.retryStep`
validates eligibility (`eligibleForRetry`), re-launches the failed step, and emits a status change;
the resumed step is the run's `currentStepId`. See TechSpec "API Endpoints"
(`POST /runs/:id/retry-step` row).

### Relevant Files
- `src/infra/daemon/handlers/run-retry-step.ts` — existing retry handler to mirror.
- `src/infra/daemon/run-manager.ts` — `retryStep()` + `RUN_NOT_RETRY_ELIGIBLE`.
- `src/domain/run.ts` — `eligibleForRetry()` semantics.

### Dependent Files
- `src/app/api/` app from task 03 — route registration + error map.
- Task 12 (WS) — an attached client observes the retry banner + status change in integration tests.

### Related ADRs
- [ADR-002: V1 surface expansion — retry-step, health, and explicit spawn path](../adrs/adr-002.md) — retry-step pulled into V1.

## Deliverables
- `POST /runs/:id/retry-step` route returning `{ resumedStepId }`.
- OpenAPI registration.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for retrying a failed step **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Retrying a retry-eligible (failed) run returns 200 `{ resumedStepId }` equal to the failed step.
  - [x] Retrying a running or completed run returns 409 (RUN_NOT_RETRY_ELIGIBLE).
  - [x] An unknown id returns 404; an ambiguous prefix returns 409.
- Integration tests:
  - [x] Against a live app, retrying a failed fixture run transitions it back to `running` (observable via `GET /runs/:id`).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A UI can recover a failed run in place via the API.
- `/runs/:id/retry-step` is documented in `/openapi.json`.
