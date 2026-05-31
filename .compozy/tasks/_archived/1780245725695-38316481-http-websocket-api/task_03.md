---
status: completed
title: HTTP app harness — Bun/Hono mount, OpenAPI, error-map, speciation guard
type: backend
complexity: medium
dependencies:
    - task_01
---

# Task 3: HTTP app harness — Bun/Hono mount, OpenAPI, error-map, speciation guard

## Overview
Create the `src/app/api/` Hono application harness that all endpoint tasks attach routes to:
the app instance, the OpenAPI document at `/openapi.json`, and the shared error-mapping table that
translates `RunManagerError` codes into HTTP statuses. Also add the speciation-guard test that
enforces the "thin handlers over RunManager" rule before any real routes exist.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create a Hono app (using `@hono/zod-openapi`) under `src/app/api/` that other tasks register
  routes on, accepting a `RunManager` instance as its dependency (no business logic in the harness).
- MUST serve the generated OpenAPI document at `GET /openapi.json`.
- MUST provide a single shared error-mapping table from `RunManagerError`/`RpcErrorCode` numeric
  codes to HTTP statuses (e.g. UNKNOWN_RUN→404, AMBIGUOUS_PREFIX→409, RUN_NOT_RETRY_ELIGIBLE→409,
  RUN_LIMIT_REACHED→429, WORKFLOW_INVALID→400) reusable by every handler.
- MUST NOT bind a port or open a socket here (mounting lives in task 13); the harness is unit-testable
  via Hono's `app.request()`/fetch handler.
- MUST add the speciation-guard test: a test-only stdin/stdout adapter drives `RunManager` through the
  same thin-handler pattern with no `RunManager` changes (ADR-001 F8, ADR-003).
</requirements>

## Subtasks
- [x] 3.1 Scaffold `src/app/api/` with a Hono `OpenAPIHono` app factory taking a `RunManager`.
- [x] 3.2 Implement the shared `RunManagerError` → HTTP status mapping helper.
- [x] 3.3 Serve `/openapi.json` from the registered route definitions.
- [x] 3.4 Establish the thin-handler convention (parse → one RunManager call → map error) for routes to follow.
- [x] 3.5 Add the speciation-guard test (test-only stdin/stdout adapter over RunManager).

## Implementation Details
New module tree `src/app/api/` per ADR-001/005. The harness mirrors the role of
`src/infra/daemon/handlers/*` for the new transport: see how those handlers map
`RunManagerError` via `RpcError` in `src/infra/daemon/rpc/server.ts` and reuse the same code
table from `protocol.ts` `RpcErrorCode`. See TechSpec "System Architecture → Component Overview"
and "Implementation Design → Core Interfaces" (error-mapping convention). Do not mount `Bun.serve`
here — keep the app a pure fetch handler for testability.

### Relevant Files
- `src/infra/daemon/protocol.ts` — `RpcErrorCode` numeric codes the error map keys on.
- `src/infra/daemon/run-manager.ts` — `RunManagerError` (`code`, `data`) thrown by operations.
- `src/infra/daemon/rpc/server.ts` — existing error-mapping precedent (`RpcError`).
- `src/app/api/schema.ts` — schemas registered into the OpenAPI doc.

### Dependent Files
- `src/app/api/` route tasks 04–10 — register routes on this app and reuse the error map.
- Task 11 (security middleware) — attaches to this app.
- Task 13 (listener) — serves this app via `Bun.serve`.

### Related ADRs
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — Hono + auto-OpenAPI; speciation guard F8.
- [ADR-003: RunManager is the shared application service](../adrs/adr-003.md) — thin handlers, no new interface.
- [ADR-005: In-process Hono listener](../adrs/adr-005.md) — harness vs mount separation.

## Deliverables
- `src/app/api/` Hono app factory + `/openapi.json`.
- Shared `RunManagerError` → HTTP status mapping helper.
- Speciation-guard test (stdin/stdout adapter over RunManager).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for OpenAPI serving + error mapping **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Error map returns 404 for UNKNOWN_RUN, 409 for AMBIGUOUS_PREFIX and RUN_NOT_RETRY_ELIGIBLE, 429 for RUN_LIMIT_REACHED, 400 for WORKFLOW_INVALID.
  - [x] An unmapped/unknown error code falls back to 500.
  - [x] `GET /openapi.json` returns a non-empty document referencing registered schema components.
- Integration tests:
  - [x] Speciation guard: a stdin/stdout test adapter drives a `RunManager` operation end-to-end with no `RunManager` source change.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Endpoint tasks can register a route and reuse the error map in <10 lines of handler code.
- `/openapi.json` serves a valid spec; speciation guard passes.
