---
status: completed
title: "ACP emission: per-session accumulator to sink.toolCall"
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 3: ACP emission: per-session accumulator to sink.toolCall

## Overview
Replace the two free-text `sink.log("Tool: …")` lines in the ACP session handler
with first-class emission: maintain a per-session accumulator that merges each
ACP `tool_call`/`tool_call_update` into the call's full known state, run it
through `summarizeToolCall`, and emit a complete `ToolCallView` via a new
`sink.toolCall`. This is where live tool-call events originate, end to end.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `toolCall(view: ToolCallView): void` to `AgentSessionSink` in
  `src/infra/acp/agent-session.ts`, keeping it structurally compatible with the
  Runner's `RunnerSessionSink`.
- MUST replace the `tool_call` and `tool_call_update` cases (current
  `agent-session.ts:194-199`) so they no longer call `sink.log`; instead they
  feed a per-session `Map<toolCallId, accumulatedFields>`, merge the incoming
  partial update, call `summarizeToolCall` with the run `cwd`, and emit via
  `sink.toolCall`.
- MUST merge partial `tool_call_update`s (which may omit `kind`/`title`/
  `rawInput`) so every emitted view is complete (last-known field wins).
- MUST scope the accumulator to a single `AgentSession`/step and discard it when
  the session ends; tool-call ids are unique per session.
- MUST NOT emit `tool_call` events for non-tool ACP updates
  (`agent_message_chunk`, `agent_thought_chunk` remain on `sink.stream`).

## Subtasks
- [x] 3.1 Extend `AgentSessionSink` with `toolCall`.
- [x] 3.2 Add a per-session accumulator keyed by `toolCallId`.
- [x] 3.3 Merge each ACP `tool_call`/`tool_call_update` and emit a complete view
  via `summarizeToolCall` + `sink.toolCall`.
- [x] 3.4 Remove the legacy `sink.log("Tool: …")` lines.
- [x] 3.5 Cover accumulation/merge and emission with tests, plus an end-to-end
  persistence check.

## Implementation Details
Edit the `sessionUpdate` handler inside `AgentSession.start`
(`src/infra/acp/agent-session.ts`). The full `SessionNotification` is already
available from `AcpClient`; `args.cwd` is in scope for path relativization.
Reuse `summarizeToolCall` from task_02. See TechSpec "System Architecture" and
ADR-002 (centralized merge, consumers stay last-wins).

### Relevant Files
- `src/infra/acp/agent-session.ts` — `AgentSessionSink` and the `sessionUpdate`
  handler (lines ~178-201) change here.
- `src/domain/tool-call.ts` — `summarizeToolCall` consumed here (task_02).
- `src/domain/runner.ts` — `ToolCallView` and sink contract (task_01).
- `src/infra/acp/acp-client.ts` — passes the full `SessionNotification`; no
  change, but confirms available fields.
- `src/infra/acp/agent-session.test.ts` — existing session tests to extend.

### Dependent Files
- `src/infra/daemon/event-log.ts` — receives and persists the emitted
  `tool_call` events.
- `src/infra/tui/tui.ts` / web reducer — downstream consumers fold the emitted
  events.

### Related ADRs
- [ADR-002: Append-each-update, fold-by-id tool-call lifecycle](adrs/adr-002.md)
  — Centralized per-session accumulator; complete view per event.
- [ADR-003: Derive the tool-call summary in the domain and ship it in the event](adrs/adr-003.md)
  — Emission consumes the domain summary.

## Deliverables
- `AgentSessionSink.toolCall` and accumulator-driven emission in the session
  handler.
- Removal of the legacy `Tool: …` log lines.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests covering the ACP-update-to-persisted-event flow **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A `tool_call` (pending) followed by a `tool_call_update` (in_progress,
    no `title`) emits two views that both retain the original `title`/`kind`.
  - [x] A final `tool_call_update` with `status: "failed"` emits a view with
    `errorText` populated.
  - [x] `agent_message_chunk` and `agent_thought_chunk` do NOT emit `tool_call`
    events.
  - [x] Two distinct `toolCallId`s accumulate independently (no cross-contamination).
- Integration tests:
  - [x] Feeding a pending→in_progress→completed ACP sequence through the session
    sink results in three persisted `tool_call` events sharing one `toolCallId`,
    and re-attach backlog folds them to a single `completed` state. (Manual E2E
    per README confirms the live TUI/web rendering.)
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No `Tool: <id>: <status>` free-text lines remain in the session handler.
- A real run emits structured `tool_call` events that persist to `events.jsonl`.
