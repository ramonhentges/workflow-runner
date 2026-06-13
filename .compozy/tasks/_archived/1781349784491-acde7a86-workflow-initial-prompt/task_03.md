---
status: completed
title: HTTP API — accept initialPrompt on POST /runs, expose on RunDetail
type: backend
complexity: medium
dependencies:
  - task_02
---

# Task 3: HTTP API — accept initialPrompt on POST /runs, expose on RunDetail

## Overview
Expose the initial prompt over the web-facing HTTP API: accept an optional
`initialPrompt` in the `POST /runs` request body and forward it to the run manager,
and surface the persisted `initialPrompt` in the `GET /runs/:id` (`RunDetail`)
response so the web run view can display it. The compact `ps`/summary projection is
intentionally left unchanged (PRD Non-Goal).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `initialPrompt` to `StartRunRequestSchema` and forward it
  from the `start-run` route into `RunManager.startRun`.
- MUST add an optional `initialPrompt` to `RunDetailSchema` and populate it from the
  run snapshot in the `run-detail` route.
- MUST NOT add `initialPrompt` to the compact `ps`/`RunSummary` projection.
- MUST keep the request/response contract backward compatible: omitting
  `initialPrompt` behaves exactly as today, and absent on the snapshot means absent
  in `RunDetail`.
</requirements>

## Subtasks
- [x] 3.1 Add optional `initialPrompt` to `StartRunRequestSchema`.
- [x] 3.2 Read and forward `initialPrompt` from the `POST /runs` route to `startRun`.
- [x] 3.3 Add optional `initialPrompt` to `RunDetailSchema`.
- [x] 3.4 Map `initialPrompt` from the snapshot into the `run-detail` response.
- [x] 3.5 Add route tests for accept/forward and expose paths.

## Implementation Details
See TechSpec "API Endpoints" and "Data Models". Follow the existing optional-field
style used for `branch` in the same schemas and routes. The route layer validates
with zod (`@hono/zod-openapi`) and delegates to `RunManager.startRun` (extended in
task 02). Do not reproduce the schema here — reference the TechSpec.

### Relevant Files
- `src/app/api/schema.ts` — `StartRunRequestSchema`, `RunDetailSchema`; add optional fields.
- `src/app/api/routes/start-run.ts` — destructure `initialPrompt` from the validated body and pass to `startRun`.
- `src/app/api/routes/run-detail.ts` — include `initialPrompt` from the snapshot in the `RunDetail` projection.

### Dependent Files
- `web/src/lib/api/types.ts` — web client types mirror these schemas (tasks 05/06).
- `web/src/features/run-view/RunView.tsx` — consumes `RunDetail.initialPrompt` (task 06).

### Related ADRs
- [ADR-003: Dedicated initialPrompt field on the run snapshot](../adrs/adr-003.md) — what is persisted and exposed.

## Deliverables
- `StartRunRequestSchema` and `RunDetailSchema` carrying optional `initialPrompt`.
- `start-run` route forwarding the prompt; `run-detail` route exposing it.
- `ps`/summary projection unchanged.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the HTTP accept/forward and expose flows **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `POST /runs` with `{ initialPrompt: "do X" }` calls `startRun` with that prompt (mocked manager).
  - [x] `POST /runs` without `initialPrompt` calls `startRun` without a prompt argument.
  - [x] `POST /runs` with a non-string `initialPrompt` is rejected with 400 by schema validation.
- Integration tests:
  - [x] `GET /runs/:id` for a run started with a prompt returns `initialPrompt` in the body; for a run started without one, the field is absent.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The web API can both submit and read back an initial prompt.
- The compact `ps`/summary response is unchanged.
