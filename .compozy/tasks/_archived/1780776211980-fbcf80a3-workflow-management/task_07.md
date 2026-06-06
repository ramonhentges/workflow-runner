---
status: completed
title: Workflows list page with delete and navigation
type: frontend
complexity: medium
dependencies:
  - task_03
  - task_06
---

# Task 7: Workflows list page with delete and navigation

## Overview
Add the Workflows page that lists the selected project's workflows and lets the
user delete them (respecting the run-active block) and navigate to create/edit.
This is the home of the feature in the web UI and the launch point for the editor.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `web/src/features/workflows/` module with a `WorkflowList` component and a `useWorkflowList` query hook scoped to the active `cwd` (reuse the existing `listWorkflows`).
- MUST add a `/workflows` route in `web/src/router.tsx` and a "Workflows" nav link in `web/src/app/AppShell.tsx`.
- MUST show each workflow's display name (derived from the file name) with actions to edit (navigate to the editor route) and create-new.
- MUST implement delete via a confirmation, calling `deleteWorkflow`, and on a 409 `WORKFLOW_RUN_ACTIVE` show a clear "stop the active run first" message (no history warning per ADR-003).
- MUST invalidate the workflows query on successful delete, following the existing TanStack Query patterns.
- MUST handle the no-active-cwd state like the existing `StartRunForm`.
</requirements>

## Subtasks
- [x] 7.1 Create the `workflows` feature module and `useWorkflowList` hook.
- [x] 7.2 Build `WorkflowList` with edit/create entry points.
- [x] 7.3 Implement delete-with-confirmation and the 409 run-active message.
- [x] 7.4 Add the `/workflows` route and the sidebar nav link.
- [x] 7.5 Test rendering, delete success/invalidation, the run-active block, and the empty/no-cwd states.

## Implementation Details
Mirror `features/dashboard/RunsTable.tsx` + `useRuns.ts` and
`features/start-run` for structure, hooks, and the no-cwd prompt. Reuse
`useCwdStore` for the active project and `web/src/lib/api/client.ts` functions
(task_06). The delete confirmation can use existing shadcn primitives. See
TechSpec "Component Overview → Web" and "Data Flow → Delete".

### Relevant Files
- `web/src/features/start-run/useWorkflows.ts` — existing per-cwd workflows query to reuse/extend.
- `web/src/features/dashboard/RunsTable.tsx`, `useRuns.ts` — list + mutation + invalidation patterns.
- `web/src/stores/cwd-store.ts` — active cwd selector.
- `web/src/router.tsx`, `web/src/app/AppShell.tsx` — route tree and nav.
- `web/src/lib/api/client.ts` — `listWorkflows`, `deleteWorkflow`.

### Dependent Files
- `web/src/features/workflows/WorkflowEditor` (task_08) — linked from the list.

### Related ADRs
- [ADR-003: Run-aware deletion — block while running, plain confirm otherwise](../adrs/adr-003.md) — delete UX and 409 messaging.
- [ADR-006: react-hook-form + zod for the step editor; web workflows feature module](../adrs/adr-006.md) — feature module layout.

## Deliverables
- `WorkflowList` page, `useWorkflowList` hook, `/workflows` route, and nav link.
- Delete flow with run-active handling.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the list + delete flow with MSW **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Renders workflow rows from a mocked list; shows the no-cwd prompt when no project is active.
  - [x] Clicking delete and confirming calls `deleteWorkflow` and invalidates the list query.
  - [x] A 409 `WORKFLOW_RUN_ACTIVE` response shows the "stop the active run first" message and keeps the row.
  - [x] Edit and create actions navigate to the editor routes.
- Integration tests:
  - [x] With MSW: list renders, delete removes the row after refetch.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- "Workflows" reachable from the sidebar; list reflects the active project
- Delete is blocked with a clear message while a run is active
