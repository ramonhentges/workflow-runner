---
status: completed
title: "Backend: GET /workflows?cwd= listing endpoint"
type: backend
complexity: medium
dependencies: []
---

# Task 03: Backend: GET /workflows?cwd= listing endpoint

## Overview
Add a daemon endpoint that lists the `*.json` workflow files directly under `<cwd>/workflows`, so the web UI's start-run flow can offer a picker instead of requiring a typed path. The endpoint only enumerates files; it does not parse or validate workflow contents.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `GET /workflows?cwd=<dir>` MUST return `{ workflows: [{ name, path }] }` for `*.json` files directly under `<cwd>/workflows`, where `path` is the absolute path usable as `POST /runs` `workflowPath`.
- A missing or empty `cwd` query MUST return HTTP 400.
- An absent `<cwd>/workflows` directory MUST return HTTP 200 with an empty list (not an error).
- The endpoint MUST list only direct `*.json` children (no recursion) and MUST NOT read paths outside `<cwd>/workflows`.
- The endpoint MUST be registered through the same app/security/OpenAPI machinery as existing routes and appear in `openapi.json`.

## Subtasks
- [x] 03.1 Add a `WorkflowListSchema` (and query schema) to `schema.ts`.
- [x] 03.2 Implement `routes/workflows.ts` resolving `<cwd>/workflows` and listing direct `*.json` files.
- [x] 03.3 Register the route in `app.ts`.
- [x] 03.4 Ensure the endpoint is reflected in the OpenAPI document and passes the completeness test.
- [x] 03.5 Cover happy path, empty folder, bad cwd, and traversal-safety with tests.

## Implementation Details
Follow the existing route pattern in `src/app/api/routes/runs.ts` (which already reads a `cwd` query) and register via `app.openapi(...)` in `app.ts`, per TechSpec "API Endpoints" and ADR-006. Add the response schema to `src/app/api/schema.ts`. Resolve the workflows directory strictly beneath the provided `cwd`; return absolute paths suitable for `POST /runs`.

### Relevant Files
- `src/app/api/routes/runs.ts` — reference pattern for a `cwd`-parameterized GET route.
- `src/app/api/app.ts` — central route registration.
- `src/app/api/schema.ts` — add `WorkflowListSchema` + query schema.
- `src/app/api/openapi-completeness.test.ts` — asserts every route is documented.

### Dependent Files
- `src/app/api/schema.test.ts` — schema/OpenAPI conformance coverage to extend.

### Related ADRs
- [ADR-006: Add GET /workflows?cwd= to list workflow files](../adrs/adr-006.md) — The decision this task implements.

## Deliverables
- `routes/workflows.ts` implementing the listing endpoint.
- `WorkflowListSchema` + query schema added to `schema.ts`.
- Route registered and present in `openapi.json`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests via `app.request()` **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Listing a `cwd` whose `workflows/` holds `a.json`, `b.json`, and `notes.txt` returns exactly `a.json` and `b.json` with absolute paths.
  - [x] `GET /workflows` with no `cwd` returns 400.
  - [x] `GET /workflows?cwd=<dir-without-workflows-folder>` returns 200 with `{ workflows: [] }`.
  - [x] A nested file `workflows/sub/c.json` is NOT returned (no recursion).
- Integration tests:
  - [x] `app.request("/workflows?cwd=...")` returns the documented shape and status codes against a temp fixture directory.
  - [x] The OpenAPI completeness test passes with the new route documented.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The endpoint lists workflow files for a cwd and returns absolute paths usable to start a run.
- No path-traversal beyond `<cwd>/workflows`; `openapi.json` documents the route.
