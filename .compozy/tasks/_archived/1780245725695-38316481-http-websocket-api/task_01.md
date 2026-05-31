---
status: completed
title: Shared API Zod schemas, dependencies, and round-trip conformance test
type: backend
complexity: medium
dependencies: []
---

# Task 1: Shared API Zod schemas, dependencies, and round-trip conformance test

## Overview
Establish the single source-of-truth Zod schemas that every HTTP/WS handler and the OpenAPI
document depend on, and lock the wire contract with a round-trip conformance test against the
existing TUI parser. This is the foundation all subsequent transport tasks build against, so the
event payload (`RunEvent`) cannot drift between the JSON-RPC and HTTP/WS encodings.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `hono`, `@hono/zod-openapi`, and `zod` as runtime dependencies in `package.json`.
- MUST create `src/app/api/schema.ts` defining `RunSummary`, `RunDetail`, `RunEvent`,
  `AttachFrame`, `InputFrame`, `StartRunRequest`, `EventsQuery`, `EventsPage`, `HealthReport`,
  and `DiscoveryFile` as described in TechSpec "Core Interfaces" and "Data Models".
- Schemas MUST live in the API adapter layer, NOT in `src/domain/` (transport/wire shapes are
  not domain entities — see ADR-003).
- `RunEvent` MUST structurally represent `EventLogEntry` (`seq`, `ts`, `stepId`, `event`) so the
  same payload is reused by HTTP responses, the WS frames, and the events endpoint.
- MUST provide a round-trip conformance test: a recorded `events.jsonl` parsed through `RunEvent`
  and re-rendered via the existing TUI parser produces matching output (TechSpec Testing → "Schema
  round-trip"; ADR-001 F7).
- Field names and nullability MUST match the existing `protocol.ts`/`run.ts`/`event-log.ts`
  shapes so JSON-RPC and HTTP/WS encodings stay aligned.
</requirements>

## Subtasks
- [ ] 1.1 Add `hono`, `@hono/zod-openapi`, `zod` to `package.json` and confirm Bun resolves them.
- [ ] 1.2 Define request/response schemas (`StartRunRequest`, `EventsQuery`, `EventsPage`,
      `HealthReport`, `RunSummary`, `RunDetail`, `DiscoveryFile`).
- [ ] 1.3 Define streaming schemas (`RunEvent`, the `AttachFrame` discriminated union, `InputFrame`).
- [ ] 1.4 Export inferred TypeScript types alongside each schema for handler consumption.
- [ ] 1.5 Write the round-trip conformance test reusing a recorded/fixture event log and the TUI parser.

## Implementation Details
Create `src/app/api/schema.ts` as the contract module. Mirror the field shapes already declared
in `src/infra/daemon/protocol.ts` (`RunListEntry`, `RpcMethods` results), `src/domain/run.ts`
(`RunSnapshot`), and `src/infra/daemon/event-log.ts` (`EventLogEntry`). See TechSpec "Core
Interfaces" for the exact schema set and "Data Models" for field-by-field mapping. Do not copy the
code block from the TechSpec verbatim into the implementation beyond what is needed.

The conformance test should drive the same parser the TUI uses to render events so any drift
between the recorded log shape and `RunEvent` fails the build.

### Relevant Files
- `src/infra/daemon/protocol.ts` — existing `RunListEntry`, `RpcMethods`, `RpcNotification` shapes to mirror.
- `src/infra/daemon/event-log.ts` — `EventLogEntry` (`seq`, `ts`, `stepId`, `event`) source shape for `RunEvent`.
- `src/domain/run.ts` — `RunSnapshot`/`RunStatus` fields backing `RunSummary`/`RunDetail`.
- `src/domain/runner.ts` — `RunnerEvent` union carried inside `RunEvent.event`.
- `src/app/commands/_tui-source.ts` — TUI parser/consumer reused by the conformance test.

### Dependent Files
- `package.json` — new runtime dependencies.
- All `src/app/api/*` handlers (tasks 03–13) — import these schemas.

### Related ADRs
- [ADR-003: RunManager is the shared application service](../adrs/adr-003.md) — schemas live in `app/api/`, not `domain/`.
- [ADR-004: Lean, attach-scoped WebSocket frame envelope](../adrs/adr-004.md) — `AttachFrame`/`InputFrame` shapes.
- [ADR-006: Read-only historical events endpoint](../adrs/adr-006.md) — `EventsQuery`/`EventsPage` shapes.

## Deliverables
- `src/app/api/schema.ts` with all listed schemas and inferred types.
- Updated `package.json` with `hono`, `@hono/zod-openapi`, `zod`.
- Round-trip conformance test wiring a recorded event log through `RunEvent` and the TUI parser.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for schema/parser round-trip **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `StartRunRequest` rejects a body missing `cwd` and a body missing `workflowPath`.
  - [ ] `EventsQuery` coerces `fromSeq` string to a non-negative integer and rejects negatives.
  - [ ] `AttachFrame` parses each variant (`snapshot`/`backlog`/`event`/`status`/`error`) and rejects an unknown `type`.
  - [ ] `RunEvent` accepts a real `EventLogEntry` and rejects an entry missing `seq`.
- Integration tests:
  - [ ] A recorded `events.jsonl` parsed through `RunEvent` then rendered by the TUI parser matches the TUI's direct render of the same log (no drift).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Every downstream task can import its request/response/frame schema from `src/app/api/schema.ts`.
- The conformance test fails if `RunEvent` and the recorded event-log shape diverge.
