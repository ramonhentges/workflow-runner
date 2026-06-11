---
status: completed
title: Web hooks thread scope
type: frontend
complexity: low
dependencies:
  - task_04
---

# Task 5: Web hooks thread scope

## Overview
Thread scope through the React Query hooks that read and mutate workflows so a
single workflow is addressed by `(scope, name)` rather than `name` alone. This
keeps cache keys correct when a global and project workflow share a name, and lets
list/detail/mutation flows pass scope to the client helpers from task_04.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST include `scope` in the React Query keys for workflow detail and any per-workflow mutation so global and project entries with the same name do not collide in cache.
- MUST pass `scope` from hook callers through to the task_04 client helpers.
- MUST keep the list hook keyed by the active `cwd` (the combined list already includes globals server-side) and invalidate it after create/edit/delete.
- SHOULD preserve existing loading/error semantics and query enabling conditions (e.g., gated on an active cwd) unchanged.
</requirements>

## Subtasks
- [x] 5.1 Add `scope` to the detail hook (`useWorkflow`) inputs and query key, forwarding it to `getWorkflow`.
- [x] 5.2 Thread `scope` into create/update/delete mutations and their `getWorkflow`/CRUD calls.
- [x] 5.3 Ensure list invalidation after mutations refreshes the combined list.
- [x] 5.4 Extend hook tests to assert scope-aware keys and forwarded scope.

## Implementation Details
Modify `web/src/features/workflows/useWorkflowList.ts` and
`web/src/features/workflows/useWorkflow.ts` (and any mutation hooks they expose).
Use the scope-aware client helpers from task_04. See TechSpec "System
Architecture" (web layer). Cache keys must incorporate `scope` for per-workflow
queries.

### Relevant Files
- `web/src/features/workflows/useWorkflow.ts` — detail + mutation hooks.
- `web/src/features/workflows/useWorkflowList.ts` — combined list hook.
- `web/src/lib/api/client.ts` — scope-aware helpers from task_04.

### Dependent Files
- `web/src/features/workflows/WorkflowList.tsx` — uses the list hook (task_06).
- `web/src/features/workflows/WorkflowEditor.tsx` — uses detail + mutation hooks (task_07).

### Related ADRs
- [ADR-003: Thread scope through the existing workflow routes](../adrs/adr-003.md) — scope addressing the hooks must respect.

## Deliverables
- Scope-aware workflow detail and mutation hooks; list hook invalidation intact.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: hook behavior validated within the component tasks (task_06/task_07) **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `useWorkflow` query key differs for the same `name` under `scope: "global"` vs `"project"`.
  - [x] The detail hook forwards `scope` to `getWorkflow`.
  - [x] A create mutation with `scope: "global"` calls `createWorkflow` with that scope and invalidates the list query.
  - [x] A delete mutation forwards `scope` and triggers list invalidation.
- Integration tests:
  - [ ] Deferred to task_06/task_07 component tests that mount these hooks.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Per-workflow cache keys include scope; same-named global/project entries never collide.
- Mutations forward scope and refresh the combined list.
