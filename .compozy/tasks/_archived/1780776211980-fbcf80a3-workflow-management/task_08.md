---
status: completed
title: Workflow editor (create/edit) with react-hook-form and zod
type: frontend
complexity: high
dependencies:
  - task_03
  - task_06
---

# Task 8: Workflow editor (create/edit) with react-hook-form and zod

## Overview
Build the form-based workflow editor used for both creating (blank or duplicate)
and editing workflows: an ordered list of steps with their fields and nested
handoff edges, validated before save. This is the primary authoring surface of
the feature.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `react-hook-form` and `@hookform/resolvers` to `web/package.json`.
- MUST build a `WorkflowEditor` (plus `StepFields` and `EdgesField` subcomponents) using `useFieldArray` for the steps and per-step edges arrays, with add/remove/reorder.
- MUST validate against a shared `WorkflowDraftSchema` (zod) mirroring the domain rules (unique step ids, every edge `next_step` references an existing step, required fields, valid `mode`/`ide`) and block save with field-level errors.
- MUST support create (blank and duplicate-from-existing) and edit, wiring `createWorkflow`/`updateWorkflow` and a `useWorkflow` read hook for edit mode.
- MUST add routes `/workflows/new` and `/workflows/$name/edit` in `web/src/router.tsx`.
- MUST surface a server 400 `WORKFLOW_INVALID` as a visible error (server is the source of truth) and navigate back to the list on success.
- MUST use a plain text input for `agent`/`model` in this task; the catalog-backed picker is added in task_09.
</requirements>

## Subtasks
- [x] 8.1 Add the form dependencies and the `WorkflowDraftSchema`.
- [x] 8.2 Build `WorkflowEditor` with the steps `useFieldArray` (add/remove/reorder).
- [x] 8.3 Build `StepFields` and a nested `EdgesField` (`next_step` + `intent`).
- [x] 8.4 Wire create (blank + duplicate) and edit, with the `useWorkflow` read hook.
- [x] 8.5 Add the `/workflows/new` and `/workflows/$name/edit` routes.
- [x] 8.6 Test validation blocking, add/remove/reorder, duplicate prefill, save success, and server-400 surfacing.

## Implementation Details
Place components in `web/src/features/workflows/`. Reuse existing shadcn
`Input`/`Label`/`Button` and add a `select` for `ide`/`mode`. The zod schema is
intentionally minimal and mirrors `src/domain/workflow.ts` validation; treat the
server 400 as authoritative. Duplicate mode seeds the form from a `getWorkflow`
read of the source. See TechSpec "Data Models", "Core Interfaces", and ADR-006.

### Relevant Files
- `web/src/features/start-run/StartRunForm.tsx` — form/mutation/navigation patterns.
- `web/src/router.tsx` — route tree (param route pattern `/runs/$runId`).
- `web/src/lib/api/client.ts` — `getWorkflow`, `createWorkflow`, `updateWorkflow`.
- `web/src/components/ui/{input,label,button}.tsx` — UI primitives.
- `src/domain/workflow.ts` — validation rules to mirror in zod.

### Dependent Files
- `web/src/features/workflows/AgentModelPicker` (task_09) — replaces the plain agent/model inputs.
- `web/src/features/workflows/WorkflowList` (task_07) — links into the editor.

### Related ADRs
- [ADR-006: react-hook-form + zod for the step editor; web workflows feature module](../adrs/adr-006.md) — form library and module choice.
- [ADR-001: Form-based workflow authoring now, visual canvas deferred](../adrs/adr-001.md) — form-based authoring model.
- [ADR-004: Filename-addressed REST workflow CRUD with server-side domain validation](../adrs/adr-004.md) — create/update/rename and server validation.

## Deliverables
- `WorkflowEditor`, `StepFields`, `EdgesField`, `WorkflowDraftSchema`, `useWorkflow`. ✅
- `/workflows/new` and `/workflows/$name/edit` routes. ✅
- Added `react-hook-form` + `@hookform/resolvers` deps. ✅
- Unit tests with 80%+ coverage **(REQUIRED)**. ✅ (81.19% branches, 93.65% statements)
- Integration tests for create and edit flows with MSW **(REQUIRED)**. ✅

## Tests
- Unit tests:
  - [x] Saving with two steps sharing an id shows a duplicate-id field error and blocks submit.
  - [x] An edge whose `next_step` matches no step shows a field error and blocks submit.
  - [x] Add/remove/reorder steps updates the form array correctly.
  - [x] Duplicate mode prefills the form from the source workflow.
  - [x] A successful create calls `createWorkflow` and navigates to the list.
  - [x] A server 400 `WORKFLOW_INVALID` is shown without losing form state.
- Integration tests:
  - [x] With MSW: create a valid workflow end-to-end; edit an existing one and save changes.
- Test coverage target: >=80% ✅
- All tests must pass ✅ (268 web, 927 server)

## Success Criteria
- All tests passing ✅
- Test coverage >=80% ✅
- Both create (blank/duplicate) and edit produce valid, runnable workflows ✅
- Invalid workflows cannot be saved (client and server both enforce) ✅
