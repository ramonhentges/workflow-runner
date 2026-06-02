---
status: completed
title: "Web: wire types + HTTP API client"
type: frontend
complexity: medium
dependencies:
    - task_04
---

# Task 05: Web: wire types + HTTP API client

## Overview
Provide the typed HTTP client and wire-format types that the rest of the UI uses to talk to the daemon's REST API. This centralizes request building (base URL, query params, JSON), error normalization, and the redeclared wire types mirroring the daemon's `schema.ts`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The client MUST expose typed functions for `GET /runs` (with `cwd`/`all`), `GET /runs/:id`, `GET /workflows?cwd=`, `GET /health`, `POST /runs`, `POST /runs/:id/stop`, and `POST /runs/:id/retry-step`.
- Wire types (`RunStatus`, `RunSummary`, `RunDetail`, `RunEvent`, `RunnerEvent`, `WorkflowList`, `HealthReport`, `StartRunRequest`) MUST be declared in the web package, mirroring the daemon `schema.ts` shapes (see TechSpec "Core Interfaces").
- All requests MUST target `VITE_API_BASE_URL` from `lib/config.ts`.
- HTTP error responses MUST be normalized into a typed error (status + parsed `{ code, message }` when present) that callers can branch on.
- The client MUST NOT import runtime code from the runner package (decoupled build, per ADR-005).

## Subtasks
- [x] 05.1 Declare wire types in `web/src/lib/api/types.ts` mirroring the daemon schema.
- [x] 05.2 Implement a request helper handling base URL, query string, JSON body, and error normalization.
- [x] 05.3 Implement the per-endpoint typed functions.
- [x] 05.4 Add minimal zod validators for responses that the WS task will reuse (frame/event shapes).
- [x] 05.5 Cover success, query-param, and error-normalization cases with MSW-backed tests.

## Implementation Details
Implement under `web/src/lib/api/` per TechSpec "Core Interfaces" and "API Endpoints" and ADR-005. Types mirror `src/app/api/schema.ts`; the `RunnerEvent` union mirrors `src/domain/runner.ts`. Do not duplicate the TechSpec code — follow the documented shapes. Reuse `lib/config.ts` from task_04 for the base URL. MSW (from task_04) backs the tests.

### Relevant Files
- `web/src/lib/api/types.ts` — wire types (new).
- `web/src/lib/api/client.ts` — typed fetch wrappers + error normalization (new).
- `web/src/lib/config.ts` — base URL (from task_04).
- `src/app/api/schema.ts` — source of truth to mirror (reference only; do not import).

### Dependent Files
- `web/src/lib/ws/*` (task_06) — reuses the wire/event types and zod validators.
- Query/mutation hooks in tasks 08–10 — consume these client functions.

### Related ADRs
- [ADR-005: Frontend data architecture](../adrs/adr-005.md) — Server state via these client functions; redeclared types accepted with drift mitigation.

## Deliverables
- `lib/api/types.ts` with all wire types.
- `lib/api/client.ts` with typed endpoint functions and normalized errors.
- Minimal zod validators reusable by the WS client.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests against MSW-mocked endpoints **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `listRuns({ cwd, all: true })` issues `GET /runs?cwd=...&all=true` and returns parsed `RunSummary[]`.
  - [x] `startRun({ workflowPath, cwd })` POSTs the body and returns `{ runId, slug }`.
  - [x] A 404 `{ code: "UNKNOWN_RUN", message }` response is normalized to a typed error exposing `status` and `code`.
  - [x] A non-JSON 500 response yields a typed error with the status and a generic message.
- Integration tests:
  - [x] With MSW mocking `GET /workflows?cwd=...`, `listWorkflows(cwd)` returns the `{ name, path }[]` list.
  - [x] Requests use the `VITE_API_BASE_URL` host configured in `lib/config.ts`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every REST endpoint the UI needs is reachable through a typed client function.
- Errors are normalized consistently for callers; no runner-package imports.
