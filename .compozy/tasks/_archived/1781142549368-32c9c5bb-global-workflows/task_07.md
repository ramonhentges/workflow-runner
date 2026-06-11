---
status: completed
title: Editor scope toggle and read-only badge
type: frontend
complexity: medium
dependencies:
  - task_05
---

# Task 7: Editor scope toggle and read-only badge

## Overview
Let users choose a new workflow's scope when creating it, and make scope visible
but immutable when editing an existing one. A Global/Project toggle appears on the
create form (default Project); an existing workflow shows a read-only scope badge
and an edit preserves its scope.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST present a Global/Project scope selector on the create form, defaulting to Project.
- MUST pass the selected scope into the create mutation (task_05) so the workflow is saved in the right scope.
- MUST render scope as a read-only badge when editing an existing workflow and MUST NOT change scope on save (edits preserve scope).
- MUST keep saving frictionless — no extra confirmation step for global workflows (per PRD Non-Goals).
- SHOULD reuse an existing primitive (`Select` or a `Button` group) for the toggle rather than adding a new shadcn dependency; if a dedicated primitive is preferred, install it via the project's shadcn CLI flow.
</requirements>

## Subtasks
- [x] 7.1 Add a scope selector (default Project) to the create path of the editor form.
- [x] 7.2 Forward the chosen scope into the create mutation.
- [x] 7.3 Show a read-only scope badge in edit mode and ensure update preserves scope.
- [x] 7.4 Keep the save flow free of extra confirmation for global workflows.
- [x] 7.5 Extend editor tests for the toggle default, create-with-scope, and read-only edit behavior.

## Implementation Details
Modify `web/src/features/workflows/WorkflowEditor.tsx` and its form fields
(`StepFields.tsx` / `WorkflowDraftSchema.ts` as needed for the scope field). Use
the scope-aware create/update mutations from task_05. Reuse `select.tsx` or
`button.tsx`; reuse `badge.tsx` for the read-only badge. See TechSpec "System
Architecture" (web layer) and PRD "User Experience".

### Relevant Files
- `web/src/features/workflows/WorkflowEditor.tsx` — create/edit form.
- `web/src/features/workflows/WorkflowDraftSchema.ts` — form schema if scope joins the form model.
- `web/src/components/ui/select.tsx` / `button.tsx` — toggle options; `badge.tsx` for read-only display.
- `web/src/features/workflows/useWorkflow.ts` — create/update mutations from task_05.

### Dependent Files
- `web/src/features/workflows/WorkflowEditor.test.tsx` — extend for toggle and read-only behavior.

### Related ADRs
- [ADR-001: Merged scope model](../adrs/adr-001.md) — scope is a visible, first-class property.
- [ADR-003: Thread scope through the existing workflow routes](../adrs/adr-003.md) — create defaults to project; edits preserve scope.

## Deliverables
- Create-form scope toggle (default Project) wired to the create mutation.
- Read-only scope badge in edit mode with scope preserved on save.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: editor create/edit flows covering scope **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The create form's scope selector defaults to Project.
  - [x] Selecting Global and saving calls the create mutation with `scope: "global"`.
  - [x] Editing an existing global workflow shows a read-only Global badge and no scope selector.
  - [x] Saving an edit to an existing workflow keeps its original scope (no scope change sent).
- Integration tests:
  - [x] Create-as-global then list shows the new workflow badged Global (with mocked hooks/client).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- New workflows can be created as global or project (default project); existing scope is immutable and clearly shown.
- Save remains frictionless for global workflows.
