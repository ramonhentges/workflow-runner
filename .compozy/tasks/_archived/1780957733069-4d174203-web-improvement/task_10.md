---
status: completed
title: Loading skeletons + action-oriented empty states
type: frontend
complexity: medium
dependencies:
  - task_03
  - task_04
  - task_07
---

# Task 10: Loading skeletons + action-oriented empty states

## Overview
Replace blank loading panels with shadcn `Skeleton` placeholders that match the final layout, and turn bare empty panels into action-oriented empty states ("Start a run", "Create your first workflow") across the migrated dashboard and workflows views. This is the final polish so the UI feels finished and guides the user when there is nothing to show.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add shadcn `Skeleton`-based loading placeholders to the dashboard (status cards + runs list) and the workflows list, shaped to match each view's final layout.
- MUST convert the dashboard empty state into an action-oriented state that links to starting a run.
- MUST convert the workflows-list empty state into an action-oriented state that links to creating a workflow.
- MUST preserve existing loading/empty test identifiers where they remain meaningful, or update tests to the new skeleton/empty-state structure (carrying intent forward).
- MUST add the shadcn `skeleton` primitive via the CLI if not already present.
- MUST NOT alter data-fetching logic — only the loading/empty presentation changes.
</requirements>

## Subtasks
- [x] 10.1 Add the shadcn `skeleton` primitive via the CLI (if absent).
- [x] 10.2 Add skeleton placeholders to the status cards and runs list matching their final layout.
- [x] 10.3 Add a skeleton placeholder to the workflows list.
- [x] 10.4 Build an action-oriented dashboard empty state ("Start a run").
- [x] 10.5 Build an action-oriented workflows-list empty state ("Create your first workflow").
- [x] 10.6 Update affected tests to the new loading/empty structure.

## Implementation Details
Modify `web/src/features/dashboard/RunsTable.tsx` and `StatusSummaryCards.tsx` (Tasks 3/4) and `web/src/features/workflows/WorkflowList.tsx` (Task 7) to render skeletons during the first load and action-oriented empty states when there is no data. See TechSpec "System Architecture" (Dashboard) and PRD "User Experience" (skeletons + empty states); ADR-001 sequences this as the final polish.

### Relevant Files
- `web/src/features/dashboard/RunsTable.tsx` — replace `loading-state` text with skeleton rows; `no-runs-state` becomes action-oriented.
- `web/src/features/dashboard/StatusSummaryCards.tsx` — skeleton cards on first load.
- `web/src/features/workflows/WorkflowList.tsx` — skeleton list + action-oriented empty state.
- `web/src/components/ui/` — `skeleton` primitive output location.

### Dependent Files
- `web/src/features/dashboard/RunsTable.test.tsx` — loading/empty assertions updated to skeleton/empty-state structure.
- `web/src/features/workflows/WorkflowList.test.tsx` — empty-state assertions updated.

### Related ADRs
- [ADR-001: Adopt shadcn across the whole app in V1](../adrs/adr-001.md) — Skeletons and empty states are the final polish step in the sequence.

## Deliverables
- Skeleton loading placeholders on the dashboard (cards + list) and workflows list, matching final layouts.
- Action-oriented empty states on the dashboard and workflows list.
- `skeleton` shadcn primitive present under `components/ui`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for loading→loaded and empty-state actions **(REQUIRED)**

## Tests
- Unit tests:
  - [x] On first load, the runs list renders skeleton rows (not a blank/plain-text panel).
  - [x] On first load, the status cards render skeleton placeholders.
  - [x] On first load, the workflows list renders skeleton placeholders.
  - [x] With zero runs, the dashboard empty state renders an action that links to `/start`.
  - [x] With zero workflows, the list empty state renders an action that links to creating a workflow.
- Integration tests:
  - [x] A view transitions from skeleton (loading) to populated content once MSW resolves the query.
  - [x] Clicking the dashboard empty-state action navigates to the start-run route.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- First-load views show layout-matched skeletons; empty views guide the user with a clear next action.
- No data-fetching behavior changed.
