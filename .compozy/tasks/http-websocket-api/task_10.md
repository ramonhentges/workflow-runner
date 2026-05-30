---
status: completed
title: GET /runs/:id/events (historical pull, fromSeq/stepId)
type: backend
complexity: medium
dependencies:
    - task_01
    - task_03
---

# Task 10: GET /runs/:id/events (historical pull, fromSeq/stepId)

## Overview
Add a read-only endpoint that pulls a slice of a run's already-recorded events — filterable by
sequence and/or step — so a dashboard can render a step transcript or page through history without
holding a WebSocket open. This is the read half of "replay"; forking/restart and SSE remain V2.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `GET /runs/:id/events` with an `EventsQuery` (`fromSeq?`, `stepId?`) and return an
  `EventsPage` (`{ entries: RunEvent[], truncated: boolean }`).
- `?fromSeq=N` MUST return entries with `seq > N`; `?stepId=X` MUST return only that step's entries;
  both compose; neither returns full (capped) history.
- MUST read events via `RunManager.openEventLog` + `EventLog.readEventsSince`, applying the `stepId`
  filter in the handler, and MUST propagate the existing `truncated` flag.
- MUST work for both running and terminal runs; for terminal runs it MUST close the owned event-log
  handle when done (as the attach handler does).
- An unknown run MUST return 404; an ambiguous prefix 409. This endpoint is HTTP-only (not on JSON-RPC).
</requirements>

## Subtasks
- [x] 10.1 Register `GET /runs/:id/events` with `EventsQuery`/`EventsPage` schemas.
- [x] 10.2 Obtain the event log via `RunManager.openEventLog`, owning/closing the handle for terminal runs.
- [x] 10.3 Call `readEventsSince(fromSeq ?? 0)` and filter by `stepId` when present.
- [x] 10.4 Return `{ entries, truncated }`, propagating the cap/truncation flag.

## Implementation Details
Thin handler reusing the event-log access pattern in `src/infra/daemon/handlers/run-attach.ts`
(open via `rm.openEventLog`, own/close for terminal runs). `readEventsSince` already enforces the
`EVENT_LOG_BACKLOG_LIMIT` cap and returns `truncated`. The `stepId` filter is an in-handler
`entries.filter(e => e.stepId === stepId)`. See TechSpec "API Endpoints" (`GET /runs/:id/events`
row) and ADR-006.

### Relevant Files
- `src/infra/daemon/handlers/run-attach.ts` — `openEventLog` ownership + `readEventsSince` usage to mirror.
- `src/infra/daemon/event-log.ts` — `readEventsSince`, `EVENT_LOG_BACKLOG_LIMIT`, `truncated`.
- `src/infra/daemon/run-manager.ts` — `openEventLog` (owned handle for terminal runs).
- `src/app/api/schema.ts` — `EventsQuery`/`EventsPage`/`RunEvent`.

### Dependent Files
- `src/app/api/` app from task 03 — route registration + error map.
- Task 15 — OpenAPI verification + docs.

### Related ADRs
- [ADR-006: Read-only historical events endpoint in V1](../adrs/adr-006.md) — the endpoint's filter semantics and V2 boundary.
- [ADR-004: Lean, attach-scoped WebSocket frame envelope](../adrs/adr-004.md) — shared `RunEvent` payload.

## Deliverables
- `GET /runs/:id/events` route with `fromSeq`/`stepId` filtering and `truncated` propagation.
- OpenAPI registration.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for historical retrieval **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `?fromSeq=N` returns only entries with `seq > N`.
  - [x] `?stepId=X` returns only entries whose `stepId === X`; combined with `fromSeq` it returns that step's entries after N.
  - [x] No filters returns full history; exceeding `EVENT_LOG_BACKLOG_LIMIT` sets `truncated: true`.
  - [x] A terminal-run read opens and then closes an owned event-log handle (no FD leak).
- Integration tests:
  - [x] Against a live app, fetching events for a completed fixture run returns the recorded entries in sequence order.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A consumer can page history and fetch per-step transcripts over plain HTTP.
- `/runs/:id/events` is documented in `/openapi.json`.
