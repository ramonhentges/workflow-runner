# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Thread `scope` through the per-workflow React Query hooks so `(scope, name)` addresses a workflow. Hooks-layer only — component wiring deferred to task_06 (WorkflowList) / task_07 (WorkflowEditor) per the task's Dependent Files list.

## Important Decisions

- `workflowQueryKey(cwd, scope, name)` → `['workflow', cwd, scope, name]`; scope sits between cwd and name so same-named global/project entries get distinct cache entries.
- `useWorkflow(name, scope = 'project')` — scope is optional with a `'project'` default. This keeps current callers (`router.tsx` NewWorkflowPage/EditWorkflowPage, `WorkflowEditor.test.tsx`) compiling untouched; task_07 passes real scope. Default mirrors the server's ADR-003 back-compat default.
- Added three mutation hooks in `useWorkflow.ts`: `useCreateWorkflow` / `useUpdateWorkflow` / `useDeleteWorkflow`. Each takes `{ scope, ... }` vars, forwards to the task_04 client helper, and invalidates `workflowListQueryKey(cwd)` on success. UI concerns (navigate, error text) left to callers via the returned mutation object.
- Did NOT modify `WorkflowEditor.tsx` / `WorkflowList.tsx` inline mutations (still hardcoded `'project'` with TODO). Those components are task_06/07 Dependent Files; task spec's Dependent-Files split overrides task_04's earlier handoff note that put WorkflowEditor create/update in task_05.
- `useWorkflowList.ts` unchanged — already keyed by cwd only; the combined list merges scopes server-side (task_03).

## Learnings

- Asserting list invalidation: `vi.spyOn(queryClient, 'invalidateQueries')` then `expect(...).toHaveBeenCalledWith({ queryKey: workflowListQueryKey('/p') })`. Clean and decoupled from refetch timing.

## Files / Surfaces

- `web/src/features/workflows/useWorkflow.ts` — scope-aware detail hook + 3 mutation hooks.
- `web/src/features/workflows/useWorkflow.test.tsx` — NEW, 8 tests (key scoping, scope forwarding, default scope, no-collision, no-cwd gate, create/update/delete forward+invalidate).

## Errors / Corrections

## Ready for Next Run

- task_06/07: wire `WorkflowList.tsx` delete to `useDeleteWorkflow({ scope: workflow.scope })` and `WorkflowEditor.tsx` create/update to `useCreate/UpdateWorkflow`; pass `useWorkflow(name, scope)` real scope from route. Remove the `'project'` TODO compile-fixes.
- Verified green: `bun run typecheck` + full `bun run test` from `web/` — 422 pass, coverage 93.98% stmts / 84.42% branch (>=80%).
