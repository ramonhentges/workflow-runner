---
status: completed
title: Agent/model picker wired to the IDE catalog
type: frontend
complexity: medium
dependencies:
  - task_05
  - task_06
  - task_08
---

# Task 9: Agent/model picker wired to the IDE catalog

## Overview
Replace the editor's plain agent/model inputs with a combobox that suggests the
selected IDE's actual agents and models from the catalog endpoint, while always
allowing free-text entry. This delivers the per-IDE discovery experience with a
graceful fallback when the IDE is unreachable.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add a `useIdeCatalog(ide)` TanStack Query hook calling `getIdeCatalog(cwd, ide)`, enabled only when an IDE is selected, scoped to the active `cwd`.
- MUST add an `AgentModelPicker` combobox that lists suggested agents/models and ALWAYS accepts a manually typed value (free text), integrated into `StepFields` from task_08.
- MUST show a clear fetching state, indicate when suggestions came from the IDE, and fall back to manual-only entry when `reachable:false` (or on error) without blocking the form.
- MUST avoid spawning on every keystroke (fetch is keyed on the selected `ide`, not on agent/model text), per ADR-005 cost concerns.
- MUST preserve the manually entered value when the catalog is unavailable.
</requirements>

## Subtasks
- [x] 9.1 Add the `useIdeCatalog` hook (enabled on IDE selection, cwd-scoped).
- [x] 9.2 Build `AgentModelPicker` (suggestions + free-text) and integrate into `StepFields`.
- [x] 9.3 Implement fetching/reachable/unreachable UI states.
- [x] 9.4 Ensure free-text values persist and validation still passes.
- [x] 9.5 Test reachable suggestions, manual entry, unreachable fallback, and per-ide fetch keying.

## Implementation Details
Follow the existing query-hook style (`useRuns`, `useWorkflows`) and reuse
`getIdeCatalog` (task_06). The picker is a controlled component bound to the
react-hook-form field from task_08, so a typed value flows back into the form
state. The catalog query key includes `ide` and `cwd`. See TechSpec
"Data Flow → Discovery" and ADR-005.

### Relevant Files
- `web/src/features/workflows/StepFields` (task_08) — integration point for the picker.
- `web/src/lib/api/client.ts` — `getIdeCatalog` (task_06).
- `web/src/features/start-run/useWorkflows.ts` — query-hook pattern to mirror.
- `web/src/stores/cwd-store.ts` — active cwd for the query.

### Dependent Files
- `web/src/features/workflows/WorkflowEditor` (task_08) — hosts `StepFields` with the picker.

### Related ADRs
- [ADR-005: Live IDE catalog discovery via a lightweight ACP probe, graceful by design](../adrs/adr-005.md) — reachable envelope and fallback.
- [ADR-002: Live per-IDE discovery of agents and models, with manual override](../adrs/adr-002.md) — manual override requirement.

## Deliverables
- `useIdeCatalog` hook and `AgentModelPicker` integrated into the editor.
- Fetching/reachable/unreachable UI states with manual fallback.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests for the picker against a mocked catalog **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] With a `reachable:true` catalog, the picker lists the returned agents and models.
  - [x] A typed value not in the suggestions is accepted and written to the form field.
  - [x] With `reachable:false`, the picker shows manual-only mode and preserves typed input.
  - [x] Changing the step's IDE refetches the catalog (query key includes `ide`).
  - [x] Typing agent/model text does not trigger a new catalog fetch.
- Integration tests:
  - [x] With MSW: selecting an IDE populates suggestions; an unreachable IDE degrades to manual entry; the workflow still saves.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Suggestions reflect the selected IDE; manual entry always works
- No catalog fetch is triggered by agent/model keystrokes
