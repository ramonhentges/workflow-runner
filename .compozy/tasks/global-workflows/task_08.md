---
status: completed
title: Start-run picker surfaces scope
type: frontend
complexity: low
dependencies:
  - task_05
---

# Task 8: Start-run picker surfaces scope

## Overview
Surface workflow scope in the Start-a-Run picker so a user can pick a global
workflow and run it against the active working directory. Starting the run needs
no new logic — the run already accepts the selected item's absolute path plus the
active cwd — so this task is about showing scope in the picker and verifying the
global-run path.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST list global and project workflows in the start-run picker, with each option's scope visible (badge or label).
- MUST start a run using the selected item's absolute `path` as `workflowPath` and the active cwd as `cwd` (existing start contract — no run-layer change).
- MUST keep the existing gate: no active cwd → the start form stays disabled/prompts for a directory (per PRD).
- SHOULD preserve the existing manual-path entry option unchanged.
</requirements>

## Subtasks
- [x] 8.1 Consume the combined scoped workflow list in the start-run picker.
- [x] 8.2 Show each option's scope (badge or suffix) so global vs project is clear.
- [x] 8.3 Confirm start passes the selected item's path + active cwd unchanged for global items.
- [x] 8.4 Extend start-run tests for scoped options and the global-run start payload.

## Implementation Details
Modify `web/src/features/start-run/StartRunForm.tsx` and
`web/src/features/start-run/useWorkflows.ts`. The picker already maps list items to
options by `path`; add scope to the option display. Starting a global run reuses the
existing `startRun({ workflowPath, cwd })` call. See TechSpec "System Architecture"
(data flow: run a global workflow) and PRD "User Experience".

### Relevant Files
- `web/src/features/start-run/StartRunForm.tsx` — the run picker and submit handler.
- `web/src/features/start-run/useWorkflows.ts` — workflow list source for the picker.
- `web/src/components/ui/badge.tsx` — optional scope indicator in options.

### Dependent Files
- `web/src/features/start-run/StartRunForm.test.tsx` — extend for scoped options.

### Related ADRs
- [ADR-001: Merged scope model](../adrs/adr-001.md) — global runs execute against the active cwd.

## Deliverables
- Start-run picker showing scoped workflow options (global + project).
- Verified global-run start using the item path + active cwd.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: start-run flow selecting a global workflow **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The picker lists both global and project workflows, each showing its scope.
  - [x] Selecting a global workflow and submitting calls `startRun` with that item's `path` and the active cwd.
  - [x] With no active cwd, the start form stays gated (existing behavior preserved).
  - [x] Manual-path entry still starts a run unchanged.
- Integration tests:
  - [x] End-to-end (mocked client): choose a global workflow, submit, and assert the start payload targets the active cwd.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Users can pick a global workflow (scope visible) and run it against the active cwd.
- No run-layer change; the cwd gate and manual-path entry remain intact.
