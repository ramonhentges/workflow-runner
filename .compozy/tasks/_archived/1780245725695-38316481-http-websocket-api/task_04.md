---
status: completed
title: GET /health endpoint
type: backend
complexity: low
dependencies:
  - task_01
  - task_03
---

# Task 4: GET /health endpoint

## Overview
Add an unauthenticated liveness/health endpoint so a dashboard can decide whether the daemon is
reachable and render a connection state before issuing any control verbs. The payload is a minimal
snapshot — it MUST NOT leak run contents to an unauthenticated caller.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `GET /health` on the task-03 Hono app and return a `HealthReport`
  (`status: "ok"`, `pid`, `uptimeMs`, `activeRuns`, `version`).
- `activeRuns` MUST be derived from `RunManager.list()` (running count) — no new RunManager method.
- The response MUST contain no run-identifying contents (no ids, slugs, workflow paths).
- The route MUST be registered into the OpenAPI document via its Zod schema.
</requirements>

## Subtasks
- [x] 4.1 Register `GET /health` with the `HealthReport` response schema.
- [x] 4.2 Populate `pid`, `uptimeMs`, `version`, and `activeRuns` (running count from `RunManager.list()`).
- [x] 4.3 Ensure the payload excludes any run-identifying data and appears in `/openapi.json`.

## Implementation Details
Thin handler on the task-03 app. Compute the running count by filtering `RunManager.list()` for
`status === "running"` (mirrors `countActiveRunners` in `src/infra/daemon/daemon.ts`). Read the
package version the same way the CLI does for `--version`. See TechSpec "API Endpoints" (health row)
and "Data Models" (`HealthReport`).

### Relevant Files
- `src/app/api/schema.ts` — `HealthReport` schema.
- `src/infra/daemon/run-manager.ts` — `list()` for the active-run count.
- `src/infra/daemon/daemon.ts` — `countActiveRunners` precedent.
- `src/app/main.ts` — existing `--version` resolution to reuse.

### Dependent Files
- `src/app/api/` app from task 03 — route registration.
- Task 15 — verifies `/health` appears in the served OpenAPI doc.

### Related ADRs
- [ADR-002: V1 surface expansion — retry-step, health, and explicit spawn path](../adrs/adr-002.md) — health pulled into V1.

## Deliverables
- `GET /health` route returning `HealthReport`.
- OpenAPI registration for the route.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the live endpoint **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `GET /health` returns 200 with `status: "ok"` and a numeric `activeRuns` equal to the running-run count.
  - [x] The response body contains no run ids/slugs/workflow paths.
  - [x] `activeRuns` reflects a running run when one is present and 0 when none are.
- Integration tests:
  - [x] Against a live app instance with one running fixture run, `/health` reports `activeRuns: 1`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A consumer can poll `/health` to confirm daemon liveness without authentication.
- `/health` is documented in `/openapi.json`.
