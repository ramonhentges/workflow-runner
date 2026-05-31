---
status: completed
title: GET /runs (list active + recent)
type: backend
complexity: low
dependencies:
  - task_01
  - task_03
---

# Task 5: GET /runs (list active + recent)

## Overview
Add the run-listing endpoint that returns active and recent runs so a dashboard can render its run
overview. This is the "is it done yet?" baseline of the API and maps directly onto the existing
`run.ps` capability.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `GET /runs` returning `{ runs: RunSummary[] }`.
- MUST support an optional `?all=<bool>` query mapping to `RunManager.list({ includeOldTerminal })`.
- Each `RunSummary` MUST include `attachedCount` derived from the live subscriber set, mirroring the
  existing `run.ps` handler.
- Ordering MUST match `RunManager.list` (active by start time, then terminal by end time).
- The route MUST be registered into the OpenAPI document.
</requirements>

## Subtasks
- [x] 5.1 Register `GET /runs` with the `{ runs: RunSummary[] }` response schema and `?all` query.
- [x] 5.2 Map `RunManager.list({ includeOldTerminal: all })` snapshots to `RunSummary`.
- [x] 5.3 Populate `attachedCount` from each run's subscriber set as `run.ps` does.

## Implementation Details
Thin handler reusing the exact mapping logic from `src/infra/daemon/handlers/run-ps.ts`
(snapshot → `RunListEntry`, `attachedCount` via `rm.get(id).subscribers.size`). See TechSpec "API
Endpoints" (`GET /runs` row). `RunSummary` is the schema-layer mirror of `RunListEntry`.

### Relevant Files
- `src/infra/daemon/handlers/run-ps.ts` — mapping + `attachedCount` precedent to mirror.
- `src/infra/daemon/run-manager.ts` — `list()` and `get()`.
- `src/app/api/schema.ts` — `RunSummary` schema.

### Dependent Files
- `src/app/api/` app from task 03 — route registration.
- Task 15 — OpenAPI verification.

### Related ADRs
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — list is part of the thin slice.

## Deliverables
- `GET /runs` route with `?all` support returning `RunSummary[]`.
- OpenAPI registration.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for listing **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `GET /runs` returns only active + recent runs by default; `?all=true` includes old terminal runs.
  - [x] Active runs sort before terminal runs, matching `RunManager.list` ordering.
  - [x] `attachedCount` reflects the number of live subscribers for a run.
- Integration tests:
  - [x] Against a live app with one running and one terminal fixture run, `/runs` returns both with correct statuses.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A dashboard can list runs with the same data the CLI `ps` shows.
- `/runs` is documented in `/openapi.json`.
