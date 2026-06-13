---
status: completed
title: Web — render initialPrompt in the run view
type: frontend
complexity: low
dependencies:
  - task_03
---

# Task 6: Web — render initialPrompt in the run view

## Overview
Surface the prompt a run was started with in the web run view, so reviewers and
operators can see what the run was asked to do without digging through logs. The
prompt is read from the `RunDetail` response and rendered as its own labeled
section, shown only when the run actually has one.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add an optional `initialPrompt?: string` to the web `RunDetail` type that
  `RunView` consumes.
- MUST render the prompt as a distinct, labeled section in `RunView` when present,
  presented as run context (not as agent output).
- MUST omit the section entirely when the run has no `initialPrompt`.
- MUST preserve the existing isolation (branch/worktree) display unchanged.
</requirements>

## Subtasks
- [x] 6.1 Add `initialPrompt?` to the web `RunDetail` type.
- [x] 6.2 Render a labeled prompt section in `RunView` when `initialPrompt` is present.
- [x] 6.3 Hide the section when `initialPrompt` is absent.
- [x] 6.4 Add component tests for present/absent rendering.

## Implementation Details
See TechSpec "Impact Analysis" (RunView row) and ADR-003. Follow the existing
pattern in `RunView.tsx` that reads `worktreePath`/`branch` from `vm.snapshot` and
conditionally renders the isolation block; add an analogous block for
`initialPrompt`. The field is supplied by the API in task 03. Do not duplicate
component code from the TechSpec.

### Relevant Files
- `web/src/lib/api/types.ts` — `RunDetail` type; add optional `initialPrompt`.
- `web/src/features/run-view/RunView.tsx` — read and conditionally render the prompt section.

### Dependent Files
- `src/app/api/routes/run-detail.ts` — provides `initialPrompt` in the response (task 03).

### Related ADRs
- [ADR-003: Dedicated initialPrompt field on the run snapshot](../adrs/adr-003.md) — the field shown here.

## Deliverables
- `RunDetail.initialPrompt?` web type.
- A conditional, labeled prompt section in `RunView`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the run view rendering the prompt **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `RunView` renders the prompt section with the prompt text when `initialPrompt` is present on the snapshot.
  - [x] `RunView` does not render the prompt section when `initialPrompt` is absent.
  - [x] The existing isolation (branch) display still renders for an isolated run.
- Integration tests:
  - [x] Loading a run whose `RunDetail` includes `initialPrompt` shows the prompt in the view (mocked detail response).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The launch prompt is visible in the web run view for runs that had one, and absent otherwise.
- Isolation display is unchanged.
