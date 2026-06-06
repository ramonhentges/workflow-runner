---
status: completed
title: Web API client functions and wire types
type: frontend
complexity: medium
dependencies:
  - task_01
---

# Task 6: Web API client functions and wire types

## Overview
Extend the web API client and wire types with the workflow CRUD and IDE catalog
operations so the new pages have a typed, tested data layer. This mirrors the
server contract from task_01 without importing server code, matching the existing
client conventions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add to `web/src/lib/api/client.ts`: `getWorkflow(cwd, name)`, `createWorkflow(cwd, { name, workflow })`, `updateWorkflow(cwd, name, { name?, workflow })`, `deleteWorkflow(cwd, name)`, and `getIdeCatalog(cwd, ide)`.
- MUST add matching wire types to `web/src/lib/api/types.ts`: `WorkflowDoc`, `IdeCatalog`, `IdeCatalogEntry`, and request body shapes.
- MUST build URLs with the bare workflow name (no `.json`) and pass `cwd` as a query param, reusing the existing `apiFetch` helper and `ApiError` handling.
- MUST send `Content-Type: application/json` bodies for create/update (handled by `apiFetch`).
- MUST NOT import from the server package; redeclare types per the existing web convention.
</requirements>

## Subtasks
- [x] 6.1 Add the five client functions using `apiFetch`.
- [x] 6.2 Add the wire types to `types.ts`.
- [x] 6.3 Ensure bare-name URL construction and `cwd` query handling.
- [x] 6.4 Test each function's request shape and error propagation with mocked fetch/MSW.

## Implementation Details
Follow the existing function style in `client.ts` (`listWorkflows`, `startRun`,
`stopRun`) and the redeclared types in `types.ts`. Names in URLs are bare; the
server appends `.json`. See TechSpec "API Endpoints" for paths and ADR-004 for
the addressing rule.

### Relevant Files
- `web/src/lib/api/client.ts` — `apiFetch`, `ApiError`, existing endpoint functions.
- `web/src/lib/api/types.ts` — redeclared wire types to extend.
- `web/src/lib/api/client.test.ts` — existing client test pattern (mocked fetch).

### Dependent Files
- `web/src/features/workflows/*` (task_07, task_08, task_09) — consume these functions.

### Related ADRs
- [ADR-004: Filename-addressed REST workflow CRUD](../adrs/adr-004.md) — bare-name URL rule.
- [ADR-005: Live IDE catalog discovery](../adrs/adr-005.md) — catalog response shape.

## Deliverables
- Five new client functions and their wire types.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for request/response handling via mocked transport **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] `getWorkflow(cwd,'who-is')` requests `/workflows/who-is?cwd=...` (no `.json`).
  - [x] `createWorkflow` POSTs `/workflows?cwd=...` with a JSON body and returns the parsed result.
  - [x] `updateWorkflow` with a `name` in the body issues the rename request to `/workflows/{old}`.
  - [x] `deleteWorkflow` issues DELETE to `/workflows/{name}?cwd=...`.
  - [x] `getIdeCatalog(cwd,'opencode')` requests `/ide/opencode/catalog?cwd=...`.
  - [x] A 409 response surfaces as an `ApiError` with the server `code`.
- Integration tests:
  - [x] With MSW, a create→get round-trip returns the stored workflow document.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Functions typed end-to-end and importable by feature tasks
- No server-package imports in web code
