---
status: completed
title: "Web Transcript: status icon/spinner, title and error"
type: frontend
complexity: medium
dependencies:
  - task_05
---

# Task 6: Web Transcript: status icon/spinner, title and error

## Overview
Render folded `tool_call` transcript items in the web UI as tidy rows: a status
affordance (pending icon, animated spinner while in_progress, ✓ on completed, ✗
on failed), the human title, and an inline error reason on failure. This
delivers the web half of the PRD's "single self-updating entry" experience,
styled with the app's existing component look.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render `tool_call` items in `web/src/features/run-view/Transcript.tsx`
  with a status affordance: a distinct visual for `pending`, an animated CSS
  spinner for `in_progress`, a success mark for `completed`, and a failure mark
  for `failed`.
- MUST display the precomputed `title` verbatim and, when present, the
  `errorText` inline (e.g. `title — errorText`).
- MUST key each tool-call row by `toolCallId` (stable) so in-place updates do not
  remount the row.
- MUST keep tool-call rows visually consistent with existing transcript styling
  (font, spacing, `data-testid="transcript-item"`, `data-kind="tool_call"`).
- MUST animate the spinner via CSS only (no JS timer) and settle to the terminal
  icon when status leaves `in_progress`.

## Subtasks
- [x] 6.1 Add a `tool_call` rendering branch keyed by `toolCallId`.
- [x] 6.2 Implement the status affordance (icon set + CSS spinner) for the four
  states.
- [x] 6.3 Render title and inline error text.
- [x] 6.4 Add a `data-kind="tool_call"` test hook and cover rendering with tests.

## Implementation Details
Edit `web/src/features/run-view/Transcript.tsx`; optionally extract a small
status-icon subcomponent within the same feature folder. Use existing Tailwind
tokens (e.g. `status-running`, `text-status-*`) for color parity with current
items. See TechSpec "User Experience" and PRD "Status affordance". Exact glyph
/icon choice is an open question in the PRD — pick a clear, accessible set.

### Relevant Files
- `web/src/features/run-view/Transcript.tsx` — the transcript renderer.
- `web/src/lib/ws/reducer.ts` — `TranscriptItem` shape with tool-call fields
  (task_05).
- `web/src/lib/utils.ts` (`cn`) — class composition already used here.

### Dependent Files
- None downstream; this is the leaf of the web chain.

### Related ADRs
- [ADR-001: Model tool calls as a first-class, identity-bearing run event](adrs/adr-001.md)
  — Renders the shared model identically to the CLI.

## Deliverables
- A `tool_call` rendering branch with status icon/CSS spinner, title, and inline
  error.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for live status transitions and finished-run rendering
  **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A `tool_call` item with `status: "in_progress"` renders the spinner
    element (and not the completed/failed marks).
  - [x] `status: "completed"` renders the success mark and the title text.
  - [x] `status: "failed"` with `errorText` renders the failure mark and the
    error text inline.
  - [x] `status: "pending"` renders the pending affordance.
  - [x] The rendered row carries `data-kind="tool_call"` and is keyed by
    `toolCallId`.
- Integration tests:
  - [x] Re-rendering the same `toolCallId` from `in_progress` to `completed`
    updates the existing row in place (no duplicate `transcript-item`).
  - [x] A reduced finished-run transcript renders each tool call once in its
    final ✓/✗ state. (Manual E2E per README confirms live animation in browser.)
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Web tool-call rows visually match the CLI content (same titles/states).
- Spinner animation is CSS-driven and settles cleanly on terminal states.
