---
status: completed
title: "Web reducer: fold transcript by toolCallId"
type: frontend
complexity: medium
dependencies:
  - task_04
---

# Task 5: Web reducer: fold transcript by toolCallId

## Overview
Extend the web view-model reducer so that `tool_call` events fold into a single
transcript item per `toolCallId`: the first event creates the item in place, and
later events with the same id replace it where it sits rather than appending new
rows. This makes live updates, re-attach backlog, and reopen of a finished run
all converge to one self-updating entry per call.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST extend `TranscriptItem` in `web/src/lib/ws/reducer.ts` with a
  `'tool_call'` kind plus `toolCallId: string`, `status: ToolCallStatus`, and
  optional `errorText` (reusing `text` for the title).
- MUST handle the `tool_call` case in `reduceEntry`: locate an existing
  transcript item with the same `toolCallId` and replace it in position
  (updating status/title/errorText and `seqEnd`); if none exists, append a new
  item at the end.
- MUST preserve the existing `appliedSeqs` de-duplication and seq-ordering
  semantics, and keep folding correct when `tool_call` events are interleaved
  with other events for the same step.
- MUST keep first-seen ordering: a call's row stays where it first appeared even
  after later updates.
- MUST NOT alter reducer behavior for existing event kinds (`log`, `stream`,
  `status`, `banner`, `summary`, `interactive`).

## Subtasks
- [x] 5.1 Extend the `TranscriptItem` type with tool-call fields.
- [x] 5.2 Implement the `tool_call` branch in `reduceEntry` with locate-and-
  replace by `toolCallId`.
- [x] 5.3 Ensure backlog replay (sorted entries) converges to final state.
- [x] 5.4 Cover folding, interleaving, and replay with reducer tests.

## Implementation Details
Edit `web/src/lib/ws/reducer.ts` (`TranscriptItem`, `reduceEntry`). The existing
`stream` case shows the "find last and merge" pattern; tool-call folding differs
in that it searches for a matching `toolCallId` anywhere in the transcript, not
just the last item. See TechSpec "Data Models" and ADR-002 (fold-by-id,
last-wins).

### Relevant Files
- `web/src/lib/ws/reducer.ts` — `TranscriptItem` and `reduceEntry` (the fold
  logic).
- `web/src/lib/api/client.ts` / `types.ts` — typed `tool_call` event (task_04).
- `web/src/lib/ws/reducer.test.ts` — existing reducer tests to extend.

### Dependent Files
- `web/src/features/run-view/Transcript.tsx` — renders the folded items in
  task_06.

### Related ADRs
- [ADR-002: Append-each-update, fold-by-id tool-call lifecycle](adrs/adr-002.md)
  — The reducer is the web side of fold-by-id.

## Deliverables
- Extended `TranscriptItem` and a `tool_call` fold branch in `reduceEntry`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for backlog replay convergence **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Three `tool_call` events with one `toolCallId` (pending → in_progress →
    completed) yield exactly one transcript item with final status `completed`.
  - [x] A `failed` `tool_call` event sets `errorText` on the existing item.
  - [x] Two interleaved `toolCallId`s produce two items, each kept in its
    first-seen position.
  - [x] A `tool_call` update arriving after unrelated `log`/`stream` events
    still updates the original tool-call row, not a new one.
  - [x] `appliedSeqs` still prevents double application of a repeated seq.
- Integration tests:
  - [x] Reducing a `backlog` frame (sorted) of the full pending→completed
    sequence yields the same final view as applying the events live one by one.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A finished run's transcript shows one row per tool call in its final state.
- Existing reducer behavior for non-tool-call events is unchanged.
