---
status: completed
title: Domain tool_call event, ToolCallView types & sink.toolCall
type: backend
complexity: medium
dependencies: []
---

# Task 1: Domain tool_call event, ToolCallView types & sink.toolCall

## Overview
Introduce the first-class tool-call model in the domain: the `ToolCallView` and
`ToolCallStatus` types, a new `tool_call` variant on `RunnerEvent`, and a
`toolCall(view)` method on `RunnerSessionSink` that the `Runner` wires to emit
the event. This is the shared foundation every other task depends on, and it
must persist through the existing append-only event log without changes to its
storage mechanics.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `ToolCallStatus` (`pending | in_progress | completed | failed`) and a
  `ToolCallView` interface (`toolCallId`, `status`, `kind`, `title`, optional
  `errorText`) to `src/domain/runner.ts`, matching the TechSpec "Core
  Interfaces" section exactly.
- MUST add a `{ type: "tool_call"; call: ToolCallView }` variant to the
  `RunnerEvent` union.
- MUST add `toolCall(view: ToolCallView): void` to `RunnerSessionSink`, and wire
  the `Runner.run()` `sink` object to emit `{ type: "tool_call", call: view }`.
- MUST NOT change the event log's append/ring/rotation behavior; `tool_call`
  events MUST persist (they are not `stream`/`thought`, so the existing filter
  leaves them untouched) and MUST be returned by `currentStepBacklog` after a
  `banner`.
- MUST keep `RunnerSessionSink` and the ACP `AgentSessionSink` structurally
  compatible so the Runner's sink is still accepted by the session factory.
</requirements>

## Subtasks
- [x] 1.1 Add `ToolCallStatus` and `ToolCallView` to the domain runner module.
- [x] 1.2 Extend the `RunnerEvent` union with the `tool_call` variant.
- [x] 1.3 Add `toolCall` to `RunnerSessionSink` and emit the event from the
  Runner's sink object.
- [x] 1.4 Confirm the event log persists `tool_call` events and replays them via
  backlog; add a regression test.
- [x] 1.5 Verify type-check passes and existing runner/event-log tests still pass.

## Implementation Details
Add the new types and union member in `src/domain/runner.ts` alongside the
existing `RunnerEvent`/`RunnerSessionSink` definitions, and emit from the `sink`
object constructed inside `Runner.run()`. No change is expected in
`src/infra/daemon/event-log.ts`; the `tool_call` type flows through `append()`
(only `stream`/`thought` is filtered) and `#appendToRing`. See TechSpec
"Core Interfaces", "Data Models", and "System Architecture" sections.

### Relevant Files
- `src/domain/runner.ts` — defines `RunnerEvent`, `RunnerSessionSink`, and the
  `sink` object in `run()`; all three change here.
- `src/infra/daemon/event-log.ts` — append/ring/backlog path that must carry the
  new event unchanged (verification only).
- `src/domain/runner.test.ts` — existing domain runner tests to extend.

### Dependent Files
- `src/infra/acp/agent-session.ts` — consumes `RunnerSessionSink`/
  `AgentSessionSink`; will call `sink.toolCall` in task_03.
- `src/infra/tui/tui.ts` — switches on `RunnerEvent`; handles `tool_call` in
  task_07.
- `web/src/lib/api/client.ts` — mirrors the event shape in Zod in task_04.

### Related ADRs
- [ADR-001: Model tool calls as a first-class, identity-bearing run event](adrs/adr-001.md)
  — Defines the event-as-first-class decision this task encodes.
- [ADR-002: Append-each-update, fold-by-id tool-call lifecycle](adrs/adr-002.md)
  — Requires the append-only log to remain unchanged.

## Deliverables
- `ToolCallStatus`, `ToolCallView`, and the `tool_call` `RunnerEvent` variant in
  the domain.
- `RunnerSessionSink.toolCall` and the Runner emit wiring.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration test asserting event-log persistence + backlog replay of
  `tool_call` events **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Calling `sink.toolCall(view)` inside a run emits exactly one
    `{ type: "tool_call", call: view }` to a registered observer.
  - [x] A `tool_call` event with `status: "failed"` preserves `errorText` on the
    emitted event.
  - [x] `RunnerSessionSink` with the new `toolCall` member is still accepted
    where `AgentSessionSink` is expected (structural compatibility).
- Integration tests:
  - [x] Appending pending → in_progress → completed `tool_call` events to an
    `EventLog` persists all three and `currentStepBacklog` returns them after a
    preceding `banner` event.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `bun run typecheck` passes with the new types referenced by no consumer yet.
- The append-only event log behavior (ring, rotation, seq) is unchanged.
