---
status: completed
title: GET /ide/{ide}/catalog route
type: backend
complexity: medium
dependencies:
  - task_01
  - task_04
---

# Task 5: GET /ide/{ide}/catalog route

## Overview
Expose the IDE catalog probe over HTTP so the web editor can fetch agents and
models for a chosen IDE. The route wraps `probeIdeCatalog`, returns the graceful
`reachable` envelope as HTTP 200, and reserves 400 for an unknown IDE id.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `GET /ide/{ide}/catalog?cwd=` in a new `src/app/api/routes/ide-catalog.ts`, registered in `src/app/api/app.ts`, using the catalog schemas from task_01.
- MUST require a non-empty `cwd` query param and return 400 when missing.
- MUST return HTTP 200 with `{ reachable, agents, models, reason? }` for both reachable and unreachable IDEs (unreachable is a normal 200, not 5xx).
- MUST return HTTP 400 for an unknown `{ide}` (catch `UnknownIdeError` from the probe).
- MUST update `src/app/api/openapi-completeness.test.ts` to document the route.
- SHOULD allow injecting a probe/spawn function for tests so no real IDE is spawned.
</requirements>

## Subtasks
- [x] 5.1 Define the route with the catalog param/query/response schemas.
- [x] 5.2 Call `probeIdeCatalog`; pass through the graceful envelope as 200.
- [x] 5.3 Map `UnknownIdeError` to 400 and missing `cwd` to 400.
- [x] 5.4 Register in `app.ts` and update the OpenAPI completeness test.
- [x] 5.5 Test reachable/unreachable 200s, unknown-ide 400, and missing-cwd 400.

## Implementation Details
Follow the `createRoute` + `app.openapi` pattern; reuse `mapError` only for the
unknown-ide/`cwd` errors. The handler should accept a probe function (defaulting
to `probeIdeCatalog`) so tests inject a stub instead of spawning. See TechSpec
"API Endpoints" and "Component Overview → IDE catalog route".

### Relevant Files
- `src/infra/acp/ide-catalog.ts` — `probeIdeCatalog` (task_04) to wrap.
- `src/app/api/routes/workflows.ts` — `cwd` query param + error pattern.
- `src/app/api/schema.ts` — `IdeCatalogParamSchema` / `IdeCatalogSchema` (task_01).
- `src/app/api/app.ts` — registration site.
- `src/app/api/openapi-completeness.test.ts` — completeness gate.

### Dependent Files
- `web/src/lib/api/client.ts` (task_06) — `getIdeCatalog`.
- `web/src/features/workflows/AgentModelPicker` (task_09) — consumes the response.

### Related ADRs
- [ADR-005: Live IDE catalog discovery via a lightweight ACP probe, graceful by design](../adrs/adr-005.md) — graceful 200 envelope, unknown-ide 400.

## Deliverables
- `ide-catalog.ts` route registered in `app.ts`.
- Updated OpenAPI completeness test.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests via `app.request()` with a stubbed probe **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Stubbed probe returning `reachable:true` → 200 with agents/models.
  - [x] Stubbed probe returning `reachable:false` → 200 with empty lists and `reason`.
  - [x] Unknown `{ide}` (probe throws `UnknownIdeError`) → 400.
  - [x] Missing `cwd` → 400.
- Integration tests:
  - [x] `app.request('/ide/opencode/catalog?cwd=/tmp/x')` with an injected stub probe returns the expected envelope.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Route appears in `/openapi.json` and passes the completeness test
- Unreachable IDE never produces a 5xx
