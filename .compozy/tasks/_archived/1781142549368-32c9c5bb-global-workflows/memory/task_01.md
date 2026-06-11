# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Add `scope` contract + server-side directory resolution that every other backend/web task depends on. Done.

## Important Decisions

- List route (`workflows.ts`) tags each item `scope: "project"` — required now because `WorkflowItemSchema` makes `scope` mandatory; the project/global merge itself is task_03.

## Learnings

- Making `scope` required on `WorkflowItemSchema` breaks the list route's `c.json` typecheck (response is type-checked against the schema) — hence the `scope: "project"` stub in `workflows.ts`.
- Verification gate for this surface: `bun run typecheck` + `bun test` (full suite, 64 files, ~30s). Both green.

## Files / Surfaces

- `src/app/api/schema.ts` — `WorkflowScopeSchema`/`WorkflowScope`, `scope` on `WorkflowItemSchema` (required) + `WorkflowsQuerySchema` (optional).
- `src/app/api/routes/workflow-crud.ts` — exported `resolveGlobalWorkflowsDir`, `resolveScopedWorkflowsDir`.
- `src/app/api/routes/workflows.ts` — adds `scope: "project"` tag to list items.
- Tests: `schema.test.ts`, `workflow-crud.test.ts`.

## Errors / Corrections

(none)

## Ready for Next Run

- task_02 (CRUD handlers) and task_03 (list merge) consume `resolveScopedWorkflowsDir`. CRUD handlers currently still call `resolveWorkflowsDir(cwd)` directly and hard-require `cwd` — switching them to the scope helper is task_02's job.
- Changes are uncommitted (auto-commit disabled); diff left for manual review.
