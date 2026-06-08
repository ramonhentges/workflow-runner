---
status: completed
title: Workflows list migration to shadcn
type: frontend
complexity: low
dependencies:
  - task_01
---

# Task 7: Workflows list migration to shadcn

## Overview
Re-skin the workflows list view with shadcn primitives (`Table`/`Card`/`Button`, and `Dialog`/`Alert` for the delete confirmation if present) while preserving its navigation to create/edit/delete and all test identifiers. This brings the workflows management list into visual consistency with the rest of the app.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST re-skin `web/src/features/workflows/WorkflowList.tsx` using shadcn primitives.
- MUST preserve navigation to new/edit/delete and the existing bare-name addressing (strip `.json` before constructing edit/delete targets).
- MUST preserve all existing test identifiers, roles, loading/empty/error states, and any delete-confirmation behavior.
- MUST add only the shadcn primitives this view consumes (e.g. `table`/`card`, and `dialog`/`alert` if a confirm step exists) via the CLI.
- MUST NOT change the underlying workflow list/delete data hooks or endpoints.
</requirements>

## Subtasks
- [x] 7.1 Inventory current `WorkflowList` structure, testids, and delete-confirm behavior.
- [x] 7.2 Add the shadcn primitives this view needs via the CLI. (none required — `table`/`card`/`button` already present)
- [x] 7.3 Re-skin the list to shadcn `Table`/`Card` with action buttons.
- [x] 7.4 Preserve create/edit/delete navigation and bare-name addressing.
- [x] 7.5 Carry forward all test identifiers/roles and update tests as needed.

## Implementation Details
Modify `web/src/features/workflows/WorkflowList.tsx`. Confirm whether a delete confirmation exists and, if so, migrate it to shadcn `Dialog`/`AlertDialog` while keeping its testids. See TechSpec "Impact Analysis" (remaining features) and "System Architecture" (Forms & run view).

### Relevant Files
- `web/src/features/workflows/WorkflowList.tsx` — the list view migrated here.
- `web/src/features/workflows/useWorkflowList.ts` — list query hook; unchanged.
- `web/src/features/workflows/workflowNames.ts` — bare-name addressing helper; unchanged.
- `web/src/lib/api/client.ts` — `deleteWorkflow`/list endpoints; unchanged.
- `web/src/components/ui/` — primitive output location.

### Dependent Files
- `web/src/features/workflows/WorkflowList.test.tsx` — selectors/roles preserved; re-skin assertions updated.
- `web/src/router.tsx` — `/workflows` route renders this list; navigation unchanged.

### Related ADRs
- [ADR-001: Adopt shadcn across the whole app in V1](../adrs/adr-001.md) — Remaining features migrated one bounded PR each.

## Deliverables
- `WorkflowList` re-skinned to shadcn with preserved navigation and addressing.
- Any consumed shadcn primitives present under `components/ui`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for list → edit/delete navigation **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] The list renders one entry per workflow from a mocked list response.
  - [ ] The empty state renders when no workflows exist.
  - [ ] The error state renders when the list query fails.
  - [ ] Edit/delete targets use the bare name (no `.json`) derived from the list filename.
- Integration tests:
  - [ ] Clicking edit navigates to the edit route for the correct workflow; the delete flow (with confirmation if present) calls `deleteWorkflow` and refreshes the list.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The workflows list is visually consistent shadcn with unchanged navigation, addressing, and delete behavior.
- Every prior `WorkflowList` test selector still resolves.
