---
status: completed
title: Scope schema + directory-resolution helpers
type: backend
complexity: medium
dependencies: []
---

# Task 1: Scope schema + directory-resolution helpers

## Overview
Establish the `scope` contract and the server-side directory resolution that every
other backend and web task depends on. This adds a workflow scope enum, a `scope`
field on the workflow list item, an optional `scope` on the workflow query, and two
helpers that map a scope to a concrete directory on disk.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `WorkflowScopeSchema` as an enum of exactly `"global"` and `"project"`, with an exported inferred `WorkflowScope` type.
- MUST add a required `scope` field to `WorkflowItemSchema` and an optional `scope` to the workflow query schema (`WorkflowsQuerySchema`), preserving the existing `cwd` field.
- MUST add `resolveGlobalWorkflowsDir(env)` returning `(XDG_STATE_HOME ?? ~/.local/state)/workflow-runner/workflows`, matching the storage-root convention in `run-store.ts`.
- MUST add `resolveScopedWorkflowsDir(scope, cwd, env)` that returns the global dir for `"global"` (ignoring `cwd`) and `<cwd>/workflows` for `"project"`, throwing `WorkflowConfigError` when project scope is requested without a `cwd`.
- MUST keep all changes additive and back-compatible — existing project-only callers that omit `scope` MUST continue to type-check and behave as today.
</requirements>

## Subtasks
- [x] 1.1 Add `WorkflowScopeSchema`/`WorkflowScope` and extend `WorkflowItemSchema` and the workflow query schema with `scope`.
- [x] 1.2 Add `resolveGlobalWorkflowsDir` using the daemon storage-root convention.
- [x] 1.3 Add `resolveScopedWorkflowsDir` selecting the directory by scope, with a guard for missing `cwd` on project scope.
- [x] 1.4 Add unit tests for the schema additions and both helpers (including `XDG_STATE_HOME` override and the missing-`cwd` error).
- [x] 1.5 Confirm `openapi-completeness` and `typecheck` stay green with the additive fields.

## Implementation Details
Add the scope enum and fields to `src/app/api/schema.ts`. Add both directory
helpers to `src/app/api/routes/workflow-crud.ts` (exported, so the list route and
CRUD handlers reuse them). Mirror `resolveStorageRoot` from
`src/infra/daemon/run-store.ts` for the global path. See TechSpec "Core
Interfaces" and "Data Models" for the exact field shapes; do not duplicate them
here.

### Relevant Files
- `src/app/api/schema.ts` — home of `WorkflowItemSchema`, `WorkflowsQuerySchema`; add scope here.
- `src/app/api/routes/workflow-crud.ts` — already defines `resolveWorkflowsDir`; add the new scope helpers alongside it.
- `src/infra/daemon/run-store.ts` — `resolveStorageRoot` is the storage-root convention to mirror.
- `src/domain/workflow.ts` — exports `WorkflowConfigError` thrown by the project-scope guard.

### Dependent Files
- `src/app/api/routes/workflows.ts` — will consume the helpers (task_03).
- `src/app/api/routes/workflow-crud.ts` handlers — will consume the helpers (task_02).
- `web/src/lib/api/types.ts` — mirrors the `scope` contract (task_04).

### Related ADRs
- [ADR-002: Store global workflows in the XDG state directory](../adrs/adr-002.md) — fixes the global directory location.
- [ADR-003: Thread scope through the existing workflow routes](../adrs/adr-003.md) — defines the scope discriminator and defaults.

## Deliverables
- `WorkflowScopeSchema`/`WorkflowScope`, scoped `WorkflowItemSchema`, and `scope` on the query schema.
- `resolveGlobalWorkflowsDir` and `resolveScopedWorkflowsDir` helpers, exported.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests: covered at the route level by task_02/task_03 (these helpers have no standalone integration surface) **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `WorkflowScopeSchema` accepts `"global"` and `"project"` and rejects `"team"`.
  - [x] `WorkflowItemSchema` requires `scope`; an item missing `scope` fails parsing.
  - [x] Query schema parses with `scope` omitted (back-compat) and with `scope: "global"`.
  - [x] `resolveGlobalWorkflowsDir` honors `XDG_STATE_HOME` and falls back to `~/.local/state/workflow-runner/workflows`.
  - [x] `resolveScopedWorkflowsDir("global", undefined)` returns the global dir ignoring cwd.
  - [x] `resolveScopedWorkflowsDir("project", undefined)` throws `WorkflowConfigError`.
  - [x] `resolveScopedWorkflowsDir("project", "/p")` returns `/p/workflows`.
- Integration tests:
  - [x] Deferred to task_02/task_03 route tests that exercise the helpers end-to-end.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Schema additions are additive; existing project-scope callers compile and behave unchanged.
- Both helpers resolve directories per ADR-002/ADR-003, including the `XDG_STATE_HOME` override.
