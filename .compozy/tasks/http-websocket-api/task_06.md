---
status: completed
title: GET /runs/:id (detail, id/slug-prefix resolution)
type: backend
complexity: low
dependencies:
  - task_01
  - task_03
---

# Task 6: GET /runs/:id (detail, id/slug-prefix resolution)

## Overview
Add the run-detail endpoint returning a single run's snapshot so a dashboard can render a detail
page. The `:id` segment accepts a full id or an unambiguous slug-prefix, reusing the daemon's
existing identifier resolution.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `GET /runs/:id` returning a `RunDetail`.
- `:id` MUST resolve via `RunManager.get` (exact id or unambiguous slug-prefix).
- An unknown run MUST return 404; an ambiguous prefix MUST return 409 with the candidate list (via
  the task-03 error map).
- `RunDetail` MUST include `attachedCount` alongside the snapshot fields.
- The route MUST be registered into the OpenAPI document.
</requirements>

## Subtasks
- [x] 6.1 Register `GET /runs/:id` with the `RunDetail` response schema.
- [x] 6.2 Resolve `:id` via `RunManager.get` and map not-found/ambiguous to 404/409.
- [x] 6.3 Serialize the run snapshot + `attachedCount` into `RunDetail`.

## Implementation Details
Thin handler. Reuse `RunManager.get` (which calls `parseIdentifier` for prefix matching and throws
`AMBIGUOUS_PREFIX`); a `not-found` returns 404. See `src/infra/daemon/handlers/_resolve-run.ts`
for the existing resolve pattern and TechSpec "API Endpoints" (`GET /runs/:id` row, `:id` resolution
note).

### Relevant Files
- `src/infra/daemon/handlers/_resolve-run.ts` — existing run-resolution helper to mirror.
- `src/infra/daemon/run-manager.ts` — `get()` + `RunManagerError("AMBIGUOUS_PREFIX")`.
- `src/domain/run-id.ts` — `parseIdentifier` prefix logic.
- `src/app/api/schema.ts` — `RunDetail` schema.

### Dependent Files
- `src/app/api/` app from task 03 — route registration + error map.
- Task 12 (WS) — reuses the same resolution for the attach path.

### Related ADRs
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — detail is part of the thin slice.

## Deliverables
- `GET /runs/:id` route returning `RunDetail` with prefix resolution.
- OpenAPI registration.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for detail retrieval **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `GET /runs/<full-id>` returns 200 with the matching `RunDetail`.
  - [x] `GET /runs/<unique-slug-prefix>` resolves to the correct run.
  - [x] An unknown id returns 404; an ambiguous prefix returns 409 with candidates.
- Integration tests:
  - [x] Against a live app, fetching a started run's detail returns its current step and status.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A dashboard can fetch one run's full snapshot by id or slug-prefix.
- `/runs/:id` is documented in `/openapi.json`.
