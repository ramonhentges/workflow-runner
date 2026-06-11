---
status: completed
title: Combined scope-tagged list endpoint
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 3: Combined scope-tagged list endpoint

## Overview
Make `GET /workflows` return one combined array of project and global workflows,
each tagged with its scope, so the web UI can render a single badged list. The
handler reads the project directory (when `cwd` is present) and the global
directory, tags every entry, and concatenates the results.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST return both project and global workflow items from `GET /workflows`, each carrying a `scope` of `"project"` or `"global"`.
- MUST include global items regardless of `cwd`; project items MUST require `cwd` (absent `cwd` yields only global items, not an error).
- MUST preserve the existing behavior for the project portion: `*.json` files directly under `<cwd>/workflows`, ENOENT → empty, ENOTDIR/EACCES → `400 INVALID_CWD`.
- MUST treat a missing global directory as an empty global list (no error).
- MUST reuse `resolveGlobalWorkflowsDir` (task_01) and the existing project-dir read logic; entries keep `name` and `path` plus the new `scope`.
</requirements>

## Subtasks
- [x] 3.1 Read project workflows (when `cwd` present) and tag each `scope: "project"`.
- [x] 3.2 Read global workflows from the global dir and tag each `scope: "global"`, treating a missing dir as empty.
- [x] 3.3 Concatenate both into the `WorkflowListSchema` response.
- [x] 3.4 Preserve existing project-side error handling (ENOENT/ENOTDIR/EACCES) and the no-`cwd` path.
- [x] 3.5 Extend list-route tests with a temp `XDG_STATE_HOME` global fixture.

## Implementation Details
Modify `src/app/api/routes/workflows.ts`. Factor the existing directory read into a
small reader used for both scopes, or call it twice with the two resolved
directories. Use `resolveGlobalWorkflowsDir` from task_01. See TechSpec "API
Endpoints" for the combined-list contract.

### Relevant Files
- `src/app/api/routes/workflows.ts` — the list handler to extend.
- `src/app/api/routes/workflow-crud.ts` — exports `resolveGlobalWorkflowsDir` (task_01).
- `src/app/api/schema.ts` — `WorkflowItemSchema`/`WorkflowListSchema` now carry `scope` (task_01).

### Dependent Files
- `src/app/api/routes/workflows.test.ts` — extend for combined output.
- `web/src/features/workflows/useWorkflowList.ts` — consumes the combined list (task_05).

### Related ADRs
- [ADR-002: Store global workflows in the XDG state directory](../adrs/adr-002.md) — global directory the list reads.
- [ADR-003: Thread scope through the existing workflow routes](../adrs/adr-003.md) — server-side merged, scope-tagged list.

## Deliverables
- `GET /workflows` returning project + global items, each tagged with `scope`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests exercising the route through the Hono app **(REQUIRED)**

## Tests
- Unit tests:
  - [x] With `cwd` set and globals present, response contains both, each with the correct `scope`.
  - [x] With `cwd` set and no global dir, response contains only project items (no error).
  - [x] With `cwd` omitted, response contains only global items (no `MISSING_CWD` error).
  - [x] Project dir ENOENT yields an empty project portion; globals still listed.
  - [x] `cwd` pointing at a file (ENOTDIR) returns `400 INVALID_CWD`.
  - [x] A global and project workflow sharing a name appear as two items distinguished by `scope`.
- Integration tests:
  - [x] After `POST ?scope=global`, the new global workflow appears in `GET /workflows` tagged `global`.
- Test coverage target: >=80% — met (workflows.ts 100% funcs/lines).
- All tests must pass — 1041 pass, 0 fail.

## Success Criteria
- All tests passing
- Test coverage >=80%
- One response carries both scopes, correctly tagged; project error handling unchanged.
- Missing global or project directory degrades to an empty portion, never an error (except the existing project ENOTDIR/EACCES cases).
