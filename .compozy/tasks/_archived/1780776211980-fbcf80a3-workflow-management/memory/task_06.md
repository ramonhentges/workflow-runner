# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Implement the web API data layer for workflow CRUD and IDE catalog discovery:
  wire types, five client functions, and MSW-backed tests for request/response
  behavior and `ApiError` propagation.
- Completed implementation and verification for task_06.

## Important Decisions
- Keep tests at the HTTP boundary using existing MSW setup; do not introduce
  production-only hooks or server-package imports.
- `deleteWorkflow` mirrors the current server route by returning `{ deleted:
  string }` instead of `void`.

## Learnings
- `AGENTS.md` is not present at the repository root; `CLAUDE.md` is present and
  remains the available repo guidance file.
- `rg` is unavailable in this environment; use `find`/`grep` fallbacks.
- Web client convention keeps `apiFetch` private and exports endpoint functions
  plus redeclared wire types from `web/src/lib/api/types.ts`.
- Focused single-file coverage runs fail the global 80% coverage threshold even
  when `src/lib/api/client.ts` is fully covered; use the full web test script
  for the task coverage gate.

## Files / Surfaces
- Touched: `web/src/lib/api/client.ts`, `web/src/lib/api/types.ts`,
  `web/src/lib/api/client.test.ts`.
- Tracking/memory: `.compozy/tasks/workflow-management/task_06.md`,
  `.compozy/tasks/workflow-management/_tasks.md`,
  `.compozy/tasks/workflow-management/memory/task_06.md`,
  `.compozy/tasks/workflow-management/memory/MEMORY.md`.

## Errors / Corrections
- Initial root `bun test web/src/lib/api/client.test.ts` did not match web test
  files; corrected to run Vitest from `web/`.
- `bunx vitest run src/lib/api/client.test.ts --coverage` passed 38 client tests
  but failed global coverage due unrelated untested files; full `bun run test`
  is the relevant coverage command.

## Ready for Next Run
- task_07/task_08/task_09 can import `getWorkflow`, `createWorkflow`,
  `updateWorkflow`, `deleteWorkflow`, `getIdeCatalog`, and the matching wire
  types from the web API module/type file.
- Verification evidence for this task: `bun run typecheck`, `bun run test`, and
  `bun run build` in `web/` all exited 0 after final edits.
