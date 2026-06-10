---
status: completed
title: Scope-aware workflow CRUD handlers
type: backend
complexity: high
dependencies:
  - task_01
---

# Task 2: Scope-aware workflow CRUD handlers

## Overview
Make the four workflow CRUD handlers scope-aware so global workflows can be read,
created, updated/renamed, and deleted through the existing routes. Each handler
resolves its target directory by scope instead of always using `<cwd>/workflows`,
while preserving name validation, atomic writes, the 409 conflict check, and the
run-active guard.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST read `scope` from the query on `GET/POST/PUT/DELETE /workflows/:name`, defaulting to `"project"` when omitted.
- MUST resolve the target directory via `resolveScopedWorkflowsDir` (task_01); `scope=global` MUST ignore `cwd`, `scope=project` MUST keep current `<cwd>/workflows` behavior and still return `MISSING_CWD` when `cwd` is absent.
- MUST keep name uniqueness per-scope: the 409 `WORKFLOW_EXISTS` check applies only within the target scope's directory, so the same name MAY exist in both scopes.
- MUST keep the run-active guard on delete and rename working for global workflows (it matches by absolute path; verify it covers the global directory).
- MUST preserve the existing path-traversal safety (`resolveWorkflowFile`) and atomic write behavior for both scopes.
- MUST return the resolved `scope` in CRUD responses where the response carries workflow identity.
</requirements>

## Subtasks
- [x] 2.1 Thread `scope` (default project) into the GET-one, POST, PUT, and DELETE handlers.
- [x] 2.2 Replace direct `<cwd>/workflows` resolution with `resolveScopedWorkflowsDir`, creating the global dir lazily on create.
- [x] 2.3 Ensure per-scope 409 behavior and confirm `MISSING_CWD` still fires for project scope only.
- [x] 2.4 Verify the run-active guard blocks global delete/rename when a run of that file is active.
- [x] 2.5 Extend route tests with a temp `XDG_STATE_HOME` global-dir fixture covering all four handlers.

## Implementation Details
Modify `src/app/api/routes/workflow-crud.ts`. Use the `scope` query field added in
task_01 and the `resolveScopedWorkflowsDir` helper for directory selection. Keep
`resolveWorkflowFile`, `writeJsonAtomic`, `fileExists`, and
`findActiveRunForWorkflow` as-is. See TechSpec "API Endpoints" for the per-scope
behavior matrix; do not reproduce handler code here.

### Relevant Files
- `src/app/api/routes/workflow-crud.ts` — the four handlers to make scope-aware.
- `src/app/api/routes/workflow-run-guard.ts` — `findActiveRunForWorkflow`, matches by absolute path.
- `src/app/api/error-map.ts` — maps `WorkflowConfigError` to `400 WORKFLOW_INVALID`.
- `src/app/api/schema.ts` — scope query field and create/update/doc schemas (from task_01).

### Dependent Files
- `src/app/api/routes/workflow-crud.test.ts` — extend with global-scope cases.
- `src/app/api/routes/workflow-run-guard.test.ts` — confirm guard covers global paths.

### Related ADRs
- [ADR-002: Store global workflows in the XDG state directory](../adrs/adr-002.md) — global directory location for create/lazy-mkdir.
- [ADR-003: Thread scope through the existing workflow routes](../adrs/adr-003.md) — scope discriminator, default project, per-scope 409.

## Deliverables
- Scope-aware `GET/POST/PUT/DELETE /workflows/:name` handlers.
- Lazy creation of the global workflows directory on first global create.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests exercising the handlers through the Hono app for both scopes **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `POST /workflows?scope=global` creates the file in the global dir (temp `XDG_STATE_HOME`) and returns `scope: "global"`.
  - [x] `GET /workflows/:name?scope=global` reads a global workflow with no `cwd` supplied.
  - [x] `POST /workflows` with no `scope` writes to `<cwd>/workflows` (default project, unchanged).
  - [x] `POST /workflows?scope=project` without `cwd` returns `400 MISSING_CWD`.
  - [x] Creating global `deploy` succeeds when project `deploy` already exists (no false 409).
  - [x] `POST /workflows?scope=global` for an existing global name returns `409 WORKFLOW_EXISTS`.
  - [x] `DELETE /workflows/:name?scope=global` removes the global file; `404` when absent.
  - [x] `PUT` rename within global scope returns `409 WORKFLOW_EXISTS` when target global name exists.
- Integration tests:
  - [x] `DELETE ?scope=global` returns `409 WORKFLOW_RUN_ACTIVE` when a run referencing that global file is active.
  - [x] `PUT` rename of a global workflow with an active run returns `409 WORKFLOW_RUN_ACTIVE`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- All four handlers honor scope; default remains project and back-compatible.
- Run-active guard protects global delete/rename; per-scope 409 lets same-named workflows coexist.
