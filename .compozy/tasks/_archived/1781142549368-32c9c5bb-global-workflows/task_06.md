---
status: completed
title: Combined list + scope badge
type: frontend
complexity: medium
dependencies:
  - task_05
---

# Task 6: Combined list + scope badge

## Overview
Render project and global workflows in one combined list, with a scope badge on
each row so users can tell at a glance which scope a workflow belongs to. Rows are
keyed by `scope + name` so a global and project workflow sharing a name both
appear and are individually actionable.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST display both project and global workflows from the combined list in a single list view.
- MUST show a scope badge (`Global` / `Project`) on every row using the existing `badge` primitive.
- MUST key list rows by `scope + name` so same-named entries across scopes both render without React key collisions.
- MUST route each row's edit/delete actions with the row's `scope` so the correct workflow is targeted.
- SHOULD keep the badge placement and styling consistent with existing badge usage in the dashboard/run views.
</requirements>

## Subtasks
- [x] 6.1 Consume the combined scoped list from the list hook (task_05).
- [x] 6.2 Add a per-row scope badge using `@/components/ui/badge`.
- [x] 6.3 Use `scope + name` as the React key and carry `scope` into row actions.
- [x] 6.4 Extend `WorkflowList` tests for badges, mixed-scope rendering, and same-name coexistence.

## Implementation Details
Modify `web/src/features/workflows/WorkflowList.tsx`. Reuse the existing
`badge.tsx` primitive (no new dependency). Pull scope from each item and pass it to
the edit/delete handlers. See TechSpec "System Architecture" (web layer) and the
PRD "User Experience" for badge expectations.

### Relevant Files
- `web/src/features/workflows/WorkflowList.tsx` — the list view to update.
- `web/src/components/ui/badge.tsx` — existing badge primitive to reuse.
- `web/src/features/workflows/workflowNames.ts` — name/extension handling used by row actions.

### Dependent Files
- `web/src/features/workflows/WorkflowList.test.tsx` — extend for badges and mixed scopes.
- `web/src/features/workflows/WorkflowEditor.tsx` — opened from row edit actions with scope (task_07).

### Related ADRs
- [ADR-001: Merged scope model](../adrs/adr-001.md) — combined badged list is the core UX.
- [ADR-003: Thread scope through the existing workflow routes](../adrs/adr-003.md) — scope+name addressing.

## Deliverables
- Combined list rendering both scopes with a per-row scope badge.
- Row actions that carry the row's scope.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: component-level rendering of a mixed-scope list **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A list with one project and one global workflow renders two rows, each with the matching scope badge text.
  - [x] Two workflows named `deploy` (one global, one project) both render without a duplicate-key warning.
  - [x] A row's edit action invokes the handler with that row's `scope`.
  - [x] A row's delete action invokes the handler with that row's `scope`.
- Integration tests:
  - [x] Rendering against a combined list from the list hook shows global and project rows together with badges.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- One list shows both scopes with clear badges; same-named entries coexist.
- Edit/delete from a row target the correct scope.
