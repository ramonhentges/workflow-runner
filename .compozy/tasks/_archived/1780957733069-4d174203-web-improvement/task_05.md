---
status: completed
title: Start-run form migration to shadcn
type: frontend
complexity: medium
dependencies:
  - task_01
---

# Task 5: Start-run form migration to shadcn

## Overview
Re-skin the start-run form with shadcn primitives and replace its native workflow-picker `<select>` with the Radix-backed shadcn `Select` (ADR-005). The existing local-state validation and submit/navigate flow is preserved; only the presentation and the select control change.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST re-skin `web/src/features/start-run/StartRunForm.tsx` using shadcn primitives (`Button`/`Input`/`Label` already present; add others as needed).
- MUST replace the native workflow `<select>` with the shadcn `Select` (`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`) per ADR-005, preserving the `workflow-select` identifier on the trigger.
- MUST preserve the manual-path input, the select-vs-manual mutual-exclusion behavior, and the validation/submit/navigate flow.
- MUST preserve the `no-cwd-prompt`, `workflows-loading`, `workflows-error`, `validation-error`, and `submit-error` test identifiers.
- MUST add the shadcn `select` primitive via the CLI (installs `@radix-ui/react-select`).
- MUST add shared jsdom test shims (`hasPointerCapture`, `scrollIntoView`, `ResizeObserver`) and rewrite the affected `selectOptions`-based test interactions to drive the Radix `Select`.
</requirements>

## Subtasks
- [x] 5.1 Add the shadcn `select` primitive via the CLI.
- [x] 5.2 Add shared jsdom shims for Radix `Select` to the Vitest setup.
- [x] 5.3 Replace the native workflow `<select>` with shadcn `Select`, keeping the `workflow-select` id and mutual-exclusion with the manual path.
- [x] 5.4 Re-skin the rest of the form with shadcn primitives, preserving all state testids.
- [x] 5.5 Rewrite the form's select-driven test interactions; keep validation/submit assertions.

## Implementation Details
Modify `web/src/features/start-run/StartRunForm.tsx`. The workflow picker currently is a native `<select>` driven by local `useState`; it becomes shadcn `Select` with `value`/`onValueChange`. Add jsdom shims once in the shared Vitest setup (reused by Task 6). See TechSpec "Impact Analysis" (`StartRunForm`) and ADR-005.

### Relevant Files
- `web/src/features/start-run/StartRunForm.tsx` — the form migrated here (native `<select>` + manual path + validation).
- `web/src/features/start-run/useWorkflows.ts` — provides the workflow options; unchanged.
- `web/src/components/ui/` — `select` primitive output location.
- `web/src/lib/api/client.ts` — `startRun` mutation target; unchanged.

### Dependent Files
- `web/src/features/start-run/StartRunForm.test.tsx` — `selectOptions` interactions rewritten for Radix `Select`.
- Shared Vitest setup file — gains the Radix/jsdom shims (also used by Task 6).

### Related ADRs
- [ADR-005: Adopt the Radix-backed shadcn Select for all dropdowns](../adrs/adr-005.md) — Native `<select>` → shadcn `Select`; jsdom shims; test rewrite.
- [ADR-002: V1 dashboard and form-migration scope refinements](../adrs/adr-002.md) — Visual-primitives-only baseline (Select is the sanctioned exception).

## Deliverables
- `StartRunForm` re-skinned with shadcn primitives and a shadcn `Select` workflow picker.
- `select` shadcn primitive present under `components/ui`.
- Radix/jsdom shims added to the shared test setup.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the start-run submit flow **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Selecting a workflow via the shadcn `Select` sets the chosen path and clears the manual-path field.
  - [x] Typing a manual path clears the select selection.
  - [x] Submitting with neither a selection nor a manual path renders `validation-error`.
  - [x] `no-cwd-prompt` renders when no active cwd is set.
  - [x] `workflows-loading` and `workflows-error` render under their respective query states.
- Integration tests:
  - [x] With MSW, selecting a workflow and submitting calls `startRun` and navigates to the new run; a failed mutation renders `submit-error`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The start-run form is fully shadcn including a Radix `Select`, with unchanged validation/submit behavior.
- `bun test` is green with the new jsdom shims.
