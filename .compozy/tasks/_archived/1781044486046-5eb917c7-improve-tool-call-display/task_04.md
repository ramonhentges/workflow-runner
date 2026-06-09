---
status: completed
title: Web Zod schema and types for tool_call event
type: frontend
complexity: low
dependencies:
  - task_01
---

# Task 4: Web Zod schema and types for tool_call event

## Overview
Teach the web client to recognize the new `tool_call` event by adding a matching
member to the `RunnerEventSchema` discriminated union and the corresponding
TypeScript type. Because the web workspace validates every event through
`safeParse` and silently drops unrecognized shapes, this schema change is the
gate that lets tool-call events reach the reducer and UI.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `tool_call` member to `RunnerEventSchema` in
  `web/src/lib/api/client.ts` whose shape mirrors `ToolCallView` from task_01:
  `toolCallId: string`, `status: enum(pending|in_progress|completed|failed)`,
  `kind: string`, `title: string`, `errorText: string optional`.
- MUST add/extend the corresponding TypeScript type in
  `web/src/lib/api/types.ts` so consumers get a typed `tool_call` event.
- MUST keep the schema a discriminated union on `type`; a malformed `tool_call`
  payload MUST fail `safeParse` (and thus be dropped) rather than throw.
- MUST NOT introduce any rendering or reducer behavior here (that is task_05/06).

## Subtasks
- [x] 4.1 Add the `tool_call` object to the `RunnerEventSchema` union.
- [x] 4.2 Add/extend the matching type in `types.ts`.
- [x] 4.3 Add schema parse tests for a valid and a malformed `tool_call` event.

## Implementation Details
Edit `web/src/lib/api/client.ts` (the `z.discriminatedUnion('type', [...])` at
~line 137) and `web/src/lib/api/types.ts`. Mirror the server `ToolCallView`
shape exactly. See TechSpec "Implementation Design → Data Models" and ADR-003
(schema-drift mitigation via a pinned parse fixture).

### Relevant Files
- `web/src/lib/api/client.ts` — `RunnerEventSchema` discriminated union.
- `web/src/lib/api/types.ts` — exported event/types consumed by the reducer.
- `web/src/lib/api/client.test.ts` — existing schema parse tests to extend.

### Dependent Files
- `web/src/lib/ws/reducer.ts` — consumes the parsed event in task_05.
- `web/src/features/run-view/Transcript.tsx` — renders it in task_06.

### Related ADRs
- [ADR-001: Model tool calls as a first-class, identity-bearing run event](adrs/adr-001.md)
  — Web mirrors the same event shape.
- [ADR-003: Derive the tool-call summary in the domain and ship it in the event](adrs/adr-003.md)
  — The schema pins the precomputed display shape.

## Deliverables
- `tool_call` member in `RunnerEventSchema` and matching `types.ts` entry.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for schema parsing of the new event **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `RunnerEventSchema.safeParse` succeeds for a valid `tool_call` event with
    all required fields and resolves the discriminated type.
  - [x] A `tool_call` event with `status` outside the enum fails `safeParse`.
  - [x] A `tool_call` event missing `toolCallId` fails `safeParse` (dropped, no
    throw).
  - [x] `errorText` is optional: a `completed` event without it parses
    successfully.
- Integration tests:
  - [x] An `AttachFrame` of `type: "event"` wrapping a valid `tool_call` entry
    parses end to end through `AttachFrameSchema`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The web type for the `tool_call` event matches the server `ToolCallView`
  field-for-field.
- No reducer or UI behavior changes in this task.
