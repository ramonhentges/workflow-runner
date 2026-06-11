# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Done + verified (uncommitted). Mirrored server scope contract in web API layer: `scope` on `WorkflowItem`, threaded through the four CRUD client helpers.

## Important Decisions

- New helper signature order is `(cwd, scope, ...)` per task's unit-test spec (`createWorkflow(cwd, "global", body)`, `deleteWorkflow(cwd, "project", name)`). `updateWorkflow` = `(cwd, scope, name, body)`.
- Added `export type WorkflowScope = 'global' | 'project'` in `web/src/lib/api/types.ts` and reused it for the field + signatures (no zod schema needed web-side; response not re-validated here).
- Did NOT add `scope` to the web `WorkflowDoc` type — task requirements explicitly scope the field to `WorkflowItem` only. Server `WorkflowDoc` carries scope; mirroring it web-side is out of scope here (candidate follow-up if a consumer needs it).
- `scope` sent explicitly on every CRUD call (never relying on server `project` default), per ADR-003 + task SHOULD.

## Learnings

- Changing the helper signatures (required positional `scope`) broke 3 real call sites that belong to later tasks. Kept the build green with a minimal compile-fix: hardcoded `'project'` + `TODO(task_05/06)` at each, preserving today's project-only behavior:
  - `useWorkflow.ts` (getWorkflow) → task_05
  - `WorkflowEditor.tsx` (create/update) → task_05/06
  - `WorkflowList.tsx` (delete) → task_06
- The required `scope` field on `WorkflowItem` also broke typed test fixtures in `WorkflowList.test.tsx` (4 `WorkflowItem[]` literals) — added `scope: 'project'`. Untyped MSW `HttpResponse.json({ workflows: [...] })` literals do not break typecheck.
- Verification gate for web is run from `web/`: `bun run typecheck` + `bun run test` (vitest --coverage, global 80% threshold). Running a SINGLE test file fails the global coverage threshold (only ~7%); always run the full web suite for the gate.

## Files / Surfaces

- `web/src/lib/api/types.ts` — `WorkflowScope` type + `scope` on `WorkflowItem`.
- `web/src/lib/api/client.ts` — `getWorkflow`/`createWorkflow`/`updateWorkflow`/`deleteWorkflow` take `scope`, sent as `scope` param. `listWorkflows` unchanged.
- `web/src/lib/api/client.test.ts` — scope assertions (create→global, delete→project, get forwards, list items carry scope).
- Call-site compile-fixes (task_05/06 will replace): `useWorkflow.ts`, `WorkflowEditor.tsx`, `WorkflowList.tsx`, `WorkflowList.test.tsx`.

## Errors / Corrections

## Ready for Next Run

- task_05 (hooks): replace the `'project'` TODOs in `useWorkflow.ts` + `WorkflowEditor.tsx` with real scope; add `scope` to React Query keys.
- task_06 (list/editor UI): replace `'project'` TODO in `WorkflowList.tsx` delete with `workflow.scope`; render scope badge; editor scope toggle.
