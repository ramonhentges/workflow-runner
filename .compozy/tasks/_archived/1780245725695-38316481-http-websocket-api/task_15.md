---
status: completed
title: WS protocol doc + README E2E update + OpenAPI-served verification
type: docs
complexity: low
dependencies:
  - task_10
  - task_12
  - task_13
---

# Task 15: WS protocol doc + README E2E update + OpenAPI-served verification

## Overview
Document the API contract for the future UI developer: a short WebSocket-framing markdown, a README
section covering the HTTP/WS surface and discovery file, and a verification that the live daemon
serves a complete OpenAPI document. This is the front door for any consumer integrating against the
API.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `docs/ws-protocol.md` (~30 lines) documenting the lean frame envelope, `fromSeq` resume
  semantics, the `truncated`/backlog behavior, close codes, and the `input` frame (per ADR-004).
- MUST add a README section covering the HTTP endpoints, the WS endpoint, the fixed default port, and
  the `daemon.json` discovery file.
- MUST add a verification test asserting the live daemon serves `/openapi.json` containing every V1
  endpoint (health, runs list/detail, start, stop, retry-step, events) and the shared schemas.
- Documentation MUST describe the contract only — no implementation internals.
</requirements>

## Subtasks
- [x] 15.1 Write `docs/ws-protocol.md` (frames, fromSeq, truncation, close codes, input).
- [x] 15.2 Add a README section for the HTTP/WS surface + port + discovery file.
- [x] 15.3 Add the OpenAPI-served verification test (all V1 endpoints + schemas present).

## Implementation Details
The WS framing doc derives directly from the `AttachFrame`/`InputFrame` schemas and the task-12
behavior. The README update extends the existing command/E2E documentation. The OpenAPI verification
exercises the served `/openapi.json` (task 03) against the registered routes from tasks 04–10. See
TechSpec "API Endpoints", ADR-004 (framing), and ADR-005 (discovery file).

### Relevant Files
- `README.md` — existing CLI/E2E documentation to extend.
- `src/app/api/schema.ts` — `AttachFrame`/`InputFrame` shapes the framing doc describes.
- `src/app/api/` routes (tasks 04–10) — endpoints the OpenAPI doc must include.

### Dependent Files
- `docs/ws-protocol.md` — new documentation artifact.

### Related ADRs
- [ADR-004: Lean, attach-scoped WebSocket frame envelope](../adrs/adr-004.md) — the WS framing doc source.
- [ADR-005: In-process Hono listener](../adrs/adr-005.md) — port + discovery file to document.
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — OpenAPI + WS-framing-doc deliverables.

## Deliverables
- `docs/ws-protocol.md` documenting the WS contract.
- README section for the HTTP/WS API surface + port + discovery file.
- OpenAPI-served verification test.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for OpenAPI completeness **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `docs/ws-protocol.md` exists and documents each `AttachFrame` variant and the `input` frame.
  - [x] The README contains the API surface section naming the default port and `daemon.json`.
- Integration tests:
  - [x] Against a live daemon, `/openapi.json` lists every V1 path (health, runs, runs/:id, start, stop, retry-step, events) and references the shared schema components.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A consumer can integrate against the API using only the served OpenAPI doc and `docs/ws-protocol.md`.
- The OpenAPI document is complete for the V1 surface.
