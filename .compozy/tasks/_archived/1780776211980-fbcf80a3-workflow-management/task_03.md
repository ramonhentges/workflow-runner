---
status: completed
title: Workflow CRUD routes (read-one, create, update/rename, delete)
type: backend
complexity: high
dependencies:
  - task_01
  - task_02
---

# Task 3: Workflow CRUD routes (read-one, create, update/rename, delete)

## Overview
Add the REST endpoints that let the web app read, create, update/rename, and
delete workflow files under `<cwd>/workflows`, addressing each by bare name with
`.json` appended server-side. This is the core server surface of the feature:
filesystem operations guarded by path-safety, atomic writes, server-side domain
validation, and the run-active guard for destructive/identity-changing actions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST implement `GET /workflows/{name}`, `POST /workflows`, `PUT /workflows/{name}`, and `DELETE /workflows/{name}`, all `cwd`-scoped, in a new `src/app/api/routes/workflow-crud.ts` registered in `src/app/api/app.ts`.
- MUST append `.json` to the bare `{name}` and resolve the file within `<cwd>/workflows`; MUST reject names containing path separators or `..` and any resolved path escaping the workflows dir with HTTP 400.
- MUST validate create/update bodies via the domain `Workflow.fromJson`; a `WorkflowConfigError` MUST map to HTTP 400 `WORKFLOW_INVALID` through the existing `mapError`.
- MUST write files atomically (temp file + rename) to avoid partial writes.
- MUST return 404 for read/update/delete of a missing workflow, 409 `WORKFLOW_EXISTS` when create or rename targets an existing name, and 409 `WORKFLOW_RUN_ACTIVE` when delete or rename targets a workflow with a live run (using the task_02 guard).
- MUST update `src/app/api/openapi-completeness.test.ts` so the new routes are documented.
- MUST leave the existing `GET /workflows` list route unchanged.
</requirements>

## Subtasks
- [x] 3.1 Implement basename validation + path containment resolution helper.
- [x] 3.2 Implement read-one (parse and return `{ name, path, workflow }`).
- [x] 3.3 Implement create and update/rename with domain validation and atomic write.
- [x] 3.4 Implement delete, wiring the run-active guard and 409 responses.
- [x] 3.5 Register routes in `app.ts` and update the OpenAPI completeness test.
- [x] 3.6 Cover happy paths, traversal rejection, 404/409 cases, and run-guard blocking with tests.

## Implementation Details
Mirror the existing route pattern (`createRoute` + `app.openapi`) used in
`workflows.ts`, `start-run.ts`, and `stop-run.ts`; reuse `mapError` for error
shaping and the schemas from task_01. Delete and rename call the run-active guard
(task_02) with `RunManager.list(...)`. The route module receives `RunManager`
(as start/stop routes do) for the guard. See TechSpec "API Endpoints",
"Core Interfaces" (write path), and "Impact Analysis".

### Relevant Files
- `src/app/api/routes/workflows.ts` — list route + `cwd`/`workflows` dir resolution pattern.
- `src/app/api/routes/start-run.ts`, `stop-run.ts` — POST/param route + `RunManager` + error patterns.
- `src/app/api/error-map.ts` — `mapError`, `WorkflowConfigError` → 400.
- `src/domain/workflow.ts` — `Workflow.fromJson` / `WorkflowConfigError`.
- `src/app/api/app.ts` — route registration site.
- `src/app/api/openapi-completeness.test.ts` — completeness gate to update.

### Dependent Files
- `web/src/lib/api/client.ts` (task_06) — calls these endpoints.
- `web/src/features/workflows/*` (task_07, task_08) — consume the behavior.

### Related ADRs
- [ADR-004: Filename-addressed REST workflow CRUD with server-side domain validation](../adrs/adr-004.md) — addressing, validation, path safety.
- [ADR-003: Run-aware deletion — block while running](../adrs/adr-003.md) — delete/rename guard behavior.

## Deliverables
- `workflow-crud.ts` with the four routes, registered in `app.ts`.
- Path-safety + atomic-write helpers.
- Updated OpenAPI completeness test.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the create→read→update→delete lifecycle **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] `POST /workflows?cwd=` with a valid body writes `who-is.json` and returns 201.
  - [x] `POST` with a malformed workflow (duplicate step id) returns 400 `WORKFLOW_INVALID`.
  - [x] `GET /workflows/{name}` returns the parsed workflow; unknown name returns 404.
  - [x] `PUT /workflows/{name}` with a new `name` renames the file; rename onto an existing name returns 409 `WORKFLOW_EXISTS`.
  - [x] `DELETE /workflows/{name}` removes the file; missing name returns 404.
  - [x] Name `../escape` or `a/b` returns 400 without touching the filesystem.
  - [x] `DELETE`/rename of a workflow with a stubbed active run returns 409 `WORKFLOW_RUN_ACTIVE`.
  - [x] `POST` over an existing name returns 409 `WORKFLOW_EXISTS`.
- Integration tests:
  - [x] Against a temp `cwd`: create → list shows it → read → update → delete → list no longer shows it.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- New routes appear in `/openapi.json` and pass the completeness test
- No path-traversal write is possible; partial-file writes are not observable
