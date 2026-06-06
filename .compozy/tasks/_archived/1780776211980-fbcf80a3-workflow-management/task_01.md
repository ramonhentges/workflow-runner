---
status: completed
title: API schemas and error codes for workflow CRUD and IDE catalog
type: backend
complexity: medium
dependencies: []
---

# Task 1: API schemas and error codes for workflow CRUD and IDE catalog

## Overview
Define the request/response contract that every later backend and frontend task
depends on: zod/OpenAPI schemas for workflow read-one, create, update/rename, and
the IDE catalog, plus the new daemon error codes and their HTTP mappings. Locking
this contract first lets the CRUD routes, the catalog route, and the web client be
built against a stable shape.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add zod schemas in `src/app/api/schema.ts` for: a bare workflow-name path param (rejecting `/`, `\`, and `..`), a create body `{ name, workflow }`, an update body `{ name?, workflow }`, a read-one response `{ name, path, workflow }`, an IDE-catalog path param `{ ide }`, and the IDE-catalog response `{ reachable, agents: {id,name}[], models: {id,name}[], reason? }`.
- MUST add new `RpcErrorCode` entries `WORKFLOW_RUN_ACTIVE` and `WORKFLOW_EXISTS` in `src/infra/daemon/protocol.ts`.
- MUST map both new codes to HTTP 409 in `src/app/api/error-map.ts` (`ERROR_HTTP_STATUS`).
- MUST follow the existing schema/error-map conventions; the `workflow` payload itself is typed as `unknown` (validated structurally by the domain layer in task_03), not re-modeled in zod.
- MUST keep all existing schemas and error mappings unchanged.
</requirements>

## Subtasks
- [x] 1.1 Add the workflow CRUD request/response schemas to `schema.ts`.
- [x] 1.2 Add the IDE catalog param and response schemas to `schema.ts`.
- [x] 1.3 Add `WORKFLOW_RUN_ACTIVE` and `WORKFLOW_EXISTS` to `RpcErrorCode`.
- [x] 1.4 Map the two new codes to 409 in `error-map.ts`.
- [x] 1.5 Cover the name-param guard and error mappings with tests.

## Implementation Details
Extend `src/app/api/schema.ts` alongside the existing `WorkflowsQuerySchema` /
`WorkflowListSchema` definitions. Add the error codes to the `RpcErrorCode` object
in `src/infra/daemon/protocol.ts` (numeric, continuing the existing `-320xx`
sequence) and extend `ERROR_HTTP_STATUS` in `src/app/api/error-map.ts`. See
TechSpec "Data Models" and "API Endpoints" for the exact field lists; do not add
route handlers here.

### Relevant Files
- `src/app/api/schema.ts` — existing workflow/run schemas; add the new ones here.
- `src/infra/daemon/protocol.ts` — `RpcErrorCode` map to extend.
- `src/app/api/error-map.ts` — `ERROR_HTTP_STATUS` and `mapError` to extend.
- `src/app/api/schema.test.ts` — existing schema test patterns to mirror.

### Dependent Files
- `src/app/api/routes/workflow-crud.ts` (task_03) — consumes the CRUD schemas.
- `src/app/api/routes/ide-catalog.ts` (task_05) — consumes the catalog schemas.
- `web/src/lib/api/types.ts` (task_06) — mirrors these wire shapes.

### Related ADRs
- [ADR-004: Filename-addressed REST workflow CRUD with server-side domain validation](../adrs/adr-004.md) — defines the bare-name param and body shapes.
- [ADR-005: Live IDE catalog discovery via a lightweight ACP probe](../adrs/adr-005.md) — defines the `reachable` catalog envelope.

## Deliverables
- New zod schemas for workflow CRUD and IDE catalog in `schema.ts`.
- `WORKFLOW_RUN_ACTIVE` and `WORKFLOW_EXISTS` codes mapped to HTTP 409.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for schema parsing of the new contract **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Name-param schema rejects `../escape`, `a/b`, and `x\y` and accepts `who-is`.
  - [ ] Create-body schema requires `name` and `workflow`; update-body allows omitting `name`.
  - [ ] IDE-catalog response schema parses `{ reachable:false, agents:[], models:[], reason:"x" }`.
  - [ ] `mapError` maps a `RunManagerError("WORKFLOW_RUN_ACTIVE")` to status 409 with code `WORKFLOW_RUN_ACTIVE`.
  - [ ] `mapError` maps `WORKFLOW_EXISTS` to 409.
- Integration tests:
  - [ ] Parsing a representative read-one response `{ name, path, workflow }` round-trips through the schema.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- New schemas exported and importable by route/client tasks
- Existing schema and error-map tests remain green
