---
status: completed
title: 'HTTP API: branch input and worktree/branch output'
type: backend
complexity: medium
dependencies:
  - task_04
---

# Task 5: HTTP API: branch input and worktree/branch output

## Overview
Expose isolation over the HTTP API the web UI consumes: accept an optional `branch` on `POST /runs`, surface `worktreePath`/`branch` on the run summary and detail responses, and map the new error codes to `400`. This makes the feature reachable from the browser (task_07).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `StartRunRequestSchema` MUST accept an optional `branch` (non-empty when present) and `POST /runs` MUST forward it to `RunManager.startRun`.
- `RunSummary` (GET `/runs`) and `RunDetail` (GET `/runs/:id`) schemas MUST gain optional `worktreePath` and `branch`, populated from the snapshot.
- The HTTP `error-map` MUST map `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT` to HTTP `400`.
- Existing requests that omit `branch` MUST behave exactly as before.
- The OpenAPI document MUST remain complete (openapi-completeness test passes).
</requirements>

## Subtasks
- [x] 5.1 Add optional `branch` to `StartRunRequestSchema` and forward it in the start-run route.
- [x] 5.2 Add optional `worktreePath`/`branch` to `RunSummary` and `RunDetail` and populate them in the runs/run-detail routes.
- [x] 5.3 Map the two new error codes to `400` in `error-map`.
- [x] 5.4 Update route and schema tests, keeping OpenAPI completeness green.

## Implementation Details
Modify `src/app/api/schema.ts` (`StartRunRequestSchema`, `RunSummarySchema`, `RunDetailSchema`), `src/app/api/routes/start-run.ts` (read and forward `branch`), `src/app/api/routes/runs.ts` and `src/app/api/routes/run-detail.ts` (emit the fields), and `src/app/api/error-map.ts` (`ERROR_HTTP_STATUS` entries for the new codes). See TechSpec "API Endpoints" and "Impact Analysis".

### Relevant Files
- `src/app/api/schema.ts` — `StartRunRequestSchema`, `RunSummarySchema`, `RunDetailSchema`.
- `src/app/api/routes/start-run.ts` — destructures `{ workflowPath, cwd }` today; add `branch`.
- `src/app/api/routes/runs.ts` / `run-detail.ts` — map snapshot → response.
- `src/app/api/error-map.ts` — `ERROR_HTTP_STATUS` table.
- `src/app/api/openapi-completeness.test.ts` — guards the spec surface.

### Dependent Files
- `web/src/lib/api/types` and `web/src/lib/api/client` — typed against this surface (task_07).
- `web/src/features/start-run/StartRunForm.tsx` — submits `branch` (task_07).

### Related ADRs
- [ADR-004: Represent isolation as worktreePath + branch on the run snapshot](adrs/adr-004.md) — Fields mirrored into the HTTP schemas.
- [ADR-005: Reuse an existing worktree for a branch instead of erroring](adrs/adr-005.md) — Only genuine conflicts map to 400.

## Deliverables
- `POST /runs` accepting optional `branch`; `GET /runs` and `GET /runs/:id` returning `worktreePath`/`branch`.
- New error codes mapped to HTTP 400.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the start/list/detail routes with an isolated run **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `StartRunRequestSchema` accepts a body with `branch` and one without; rejects an empty-string `branch`.
  - [x] `error-map` returns status `400` for `NOT_A_GIT_REPO` and for `WORKTREE_CONFLICT`.
  - [x] `RunSummary`/`RunDetail` serialization includes `worktreePath`/`branch` when present and omits them otherwise.
- Integration tests:
  - [x] `POST /runs` with a `branch` against a real git repo returns 201 and `GET /runs/:id` reports the `worktreePath` and `branch`.
  - [x] `POST /runs` with `branch` against a non-git `cwd` returns 400 with the `NOT_A_GIT_REPO` code.
  - [x] OpenAPI completeness test still passes after schema changes.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- HTTP clients can start isolated runs and read `worktreePath`/`branch`
- Non-`branch` requests are unaffected; OpenAPI spec stays complete
