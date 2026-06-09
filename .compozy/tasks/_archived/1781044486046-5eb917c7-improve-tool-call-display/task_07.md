---
status: completed
title: "TUI: in-place map render and braille spinner"
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 7: TUI: in-place map render and braille spinner

## Overview
Render `tool_call` events in the terminal UI as one self-updating line per call:
keep a `Map<toolCallId, TextRenderable>`, mutate the existing element on each
update, and animate in-progress calls with a shared timer-driven braille spinner
gated by a short appearance delay so fast calls settle straight to ✓/✗. This is
the CLI half of the PRD's single-entry experience.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `tool_call` case to `Tui.onEvent` in `src/infra/tui/tui.ts` that
  folds by `toolCallId` via a `Map<string, TextRenderable>`: update the existing
  renderable's content in place, or create one (flushing any active stream)
  on first sight.
- MUST render `icon(status) + title` plus ` — errorText` on failure, colored by
  status using the existing `C` theme (e.g. green completed, red failed).
- MUST animate `in_progress` entries with a single shared interval advancing a
  braille frame, started only after a ~200ms delay so fast calls never flash a
  spinner and settle directly to their terminal icon.
- MUST clear the tool-call map on each `banner` event and stop/clean up the
  spinner timer on detach and shutdown (no leaked interval).
- MUST NOT change rendering of existing event kinds, and MUST keep in-place
  updates from reordering entries already in the scroll log.

## Subtasks
- [x] 7.1 Add the `tool_call` `onEvent` case with a `toolCallId → TextRenderable`
  map.
- [x] 7.2 Implement status-icon + title (+ error) content and theme colors.
- [x] 7.3 Implement the shared braille spinner interval with a ~200ms appearance
  delay.
- [x] 7.4 Reset the map on `banner` and tear down the timer on detach/shutdown.
- [x] 7.5 Cover the fold/format logic with tests (extract a pure helper if
  needed to keep it unit-testable).

## Implementation Details
Edit `src/infra/tui/tui.ts`: add the map and timer fields, a `renderToolCall`
method mirroring the existing `appendLog`/`appendStream` element handling, and
hook timer cleanup into the existing `detach()`/`shutdown()` paths and the
`#detachListeners` mechanism. To keep `@opentui/core` out of unit tests, extract
icon/title/color formatting into a pure function and test that directly. See
TechSpec "System Architecture", "Key Decisions" (spinner), and ADR-002.

### Relevant Files
- `src/infra/tui/tui.ts` — `onEvent`, `appendLog`/`appendStream`, `detach`,
  `shutdown`, theme usage.
- `src/infra/tui/theme.ts` — `C` color tokens for status coloring.
- `src/domain/runner.ts` — `ToolCallView`/`ToolCallStatus` (task_01).
- `src/app/commands/_tui-source.ts` — forwards `RunnerEvent`s to the TUI
  unchanged (no edit, confirms the event reaches `onEvent`).

### Dependent Files
- None downstream; this is the leaf of the CLI chain.

### Related ADRs
- [ADR-002: Append-each-update, fold-by-id tool-call lifecycle](adrs/adr-002.md)
  — The TUI is the CLI side of fold-by-id.

## Deliverables
- `tool_call` rendering in the TUI with in-place updates and an animated braille
  spinner, plus timer/map lifecycle cleanup.
- A pure formatting helper for icon/title/color.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for fold/lifecycle behavior **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The formatting helper returns the success icon + title for `completed`
    and the failure icon + `title — errorText` for `failed`.
  - [x] The helper maps each status to the expected `C` theme color.
  - [x] A pending status renders the pending affordance (no spinner frame yet).
  - [x] Fold logic: a second event with an existing `toolCallId` targets the same
    map entry rather than creating a new one.
- Integration tests:
  - [x] Emitting pending → in_progress → completed for one `toolCallId` results
    in a single tracked renderable ending in the completed icon.
  - [x] A `banner` event clears the tool-call map; detach/shutdown stops the
    spinner interval. (Manual E2E per README confirms live spinner animation in
    a real terminal.)
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- One terminal line per tool call updates in place through its lifecycle.
- No leaked spinner interval after detach or shutdown.
