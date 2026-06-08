---
status: completed
title: Workflow editor + Step/Edges fields migration to shadcn
type: frontend
complexity: high
dependencies:
  - task_01
---

# Task 6: Workflow editor + Step/Edges fields migration to shadcn

## Overview
Re-skin the workflow editor and its step/edges fields with shadcn primitives while preserving the react-hook-form + zod wiring, and replace the native `ide`/`mode` `<select>` elements with shadcn `Select` driven by `Controller` (ADR-005). This is the heaviest form migration: it must keep the custom-IDE round-trip and every field/error test identifier intact.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST re-skin `WorkflowEditor.tsx`, `StepFields.tsx`, and `EdgesField.tsx` with shadcn primitives, keeping the existing `useForm`/`zodResolver`/`FormProvider`/`useFieldArray` wiring untouched (ADR-002 visual-primitives-only).
- MUST replace the native `ide` and `mode` `<select>` elements with shadcn `Select`, rewiring those two fields from `register` to react-hook-form `Controller` (ADR-005).
- MUST preserve the custom-IDE behavior: an `ide` value outside the four built-ins still renders as a selectable option and round-trips on edit.
- MUST NOT change `AgentModelPicker` semantics — it is an `<Input>` + `<datalist>`, not a select, and is out of ADR-005 scope (visual re-skin only).
- MUST preserve all form test identifiers and roles: `workflow-editor-form`, `workflow-filename-input`, `filename-error`, `add-step-button`, `step-row-${i}`, `step-id-input-${i}`, `step-id-error-${i}`, `step-ide-select-${i}`, `step-mode-select-${i}`, `step-agent-input-${i}`, `step-model-input-${i}`, move/remove step buttons and their `aria-label`s, `steps-array-error`, `server-error` (`role="alert"`), `save-button`, `cancel-button`.
- MUST rely on the shadcn `select` primitive and the shared jsdom shims (added in Task 5) and rewrite select-driven test interactions accordingly.
</requirements>

## Subtasks
- [x] 6.1 Re-skin `WorkflowEditor` layout/inputs/buttons with shadcn primitives, keeping RHF/zod wiring.
- [x] 6.2 Convert the step `ide` field from `register` to `Controller` + shadcn `Select`, preserving the custom-IDE option.
- [x] 6.3 Convert the step `mode` field from `register` to `Controller` + shadcn `Select`.
- [x] 6.4 Re-skin `EdgesField` and visually re-skin `AgentModelPicker` (no semantic change).
- [x] 6.5 Carry forward every form/step/edge test identifier, error element, and `aria-label`.
- [x] 6.6 Rewrite select-driven tests and verify the custom-IDE round-trip and validation errors.

## Implementation Details
Modify `web/src/features/workflows/WorkflowEditor.tsx`, `StepFields.tsx`, `EdgesField.tsx`, and re-skin `AgentModelPicker.tsx`. The `ide`/`mode` fields move to `Controller` mirroring how `agent`/`model` already use `Controller`. Reuse the shadcn `select` primitive and jsdom shims from Task 5. See TechSpec "Impact Analysis" (`StepFields`, `WorkflowEditor`) and ADR-005.

### Relevant Files
- `web/src/features/workflows/WorkflowEditor.tsx` — top-level form with RHF/zod, `FormProvider`, `useFieldArray`, server-error handling.
- `web/src/features/workflows/StepFields.tsx` — native `ide`/`mode` selects + custom-IDE option + `Controller`-wrapped agent/model pickers.
- `web/src/features/workflows/EdgesField.tsx` — per-step edges sub-form (re-skin).
- `web/src/features/workflows/AgentModelPicker.tsx` — `<Input>`+`<datalist>`, visual re-skin only.
- `web/src/features/workflows/WorkflowDraftSchema.ts` — zod schema + payload mapping; unchanged.
- `web/src/features/workflows/useIdeCatalog.ts` — feeds agent/model suggestions; unchanged.

### Dependent Files
- `web/src/features/workflows/WorkflowEditor.test.tsx`, `web/src/features/workflows/AgentModelPicker.test.tsx` — selectors preserved; select interactions rewritten.
- `web/src/router.tsx` — `NewWorkflowPage`/`EditWorkflowPage` render the editor; behavior unchanged.

### Related ADRs
- [ADR-005: Adopt the Radix-backed shadcn Select for all dropdowns](../adrs/adr-005.md) — `ide`/`mode` selects → `Select` via `Controller`; custom-IDE round-trip preserved.
- [ADR-002: V1 dashboard and form-migration scope refinements](../adrs/adr-002.md) — Keep RHF/zod wiring; visual-primitives-only elsewhere.

## Deliverables
- `WorkflowEditor`, `StepFields`, `EdgesField` re-skinned to shadcn; `ide`/`mode` on `Controller` + `Select`.
- `AgentModelPicker` visually re-skinned with unchanged datalist semantics.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for create/edit submit and the custom-IDE round-trip **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Adding a step appends a `step-row-${i}` with all field controls and testids present.
  - [x] Selecting an IDE via the shadcn `Select` updates the `ide` field value (`Controller`-bound).
  - [x] A loaded workflow with a non-built-in `ide` renders that value as a selectable option and is preserved on save (custom-IDE round-trip).
  - [x] `mode` Select toggles between `interactive` and `autonomous`.
  - [x] Invalid filename surfaces `filename-error`; an invalid step surfaces its `step-id-error-${i}`.
  - [x] Move-up/move-down/remove step buttons reorder/remove the correct step (disabled at boundaries).
- Integration tests:
  - [x] Create mode submits `createWorkflow` and navigates to `/workflows`; a `WORKFLOW_INVALID` server error renders `server-error` (`role="alert"`).
  - [x] Edit mode with a renamed file submits `updateWorkflow` with the new name.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Editor and step/edges fields are fully shadcn with RHF/zod wiring intact and the custom-IDE round-trip preserved.
- Every prior editor/step/edge test selector still resolves.
