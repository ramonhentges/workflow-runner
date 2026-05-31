# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement `POST /runs` endpoint: accepts `StartRunRequest` body (`workflowPath` + `cwd`, both required), calls `RunManager.startRun(workflowPath, cwd)`, returns 201 `{ runId, slug }`. Maps WORKFLOW_INVALID → 400 and RUN_LIMIT_REACHED → 429.

## Important Decisions

- Implementation was already complete when task started — `src/app/api/routes/start-run.ts` and `start-run.test.ts` were fully written and registered.
- No code changes were needed; verified via full test suite.

## Learnings

- `StartRunRequestSchema` uses `z.string().min(1)` for both fields, so empty strings and missing fields both return 400 before the handler is invoked.
- The route is registered in `app.ts` line 32 via `registerStartRunRoute(app, runManager)`.

## Files / Surfaces

- `src/app/api/routes/start-run.ts` — POST /runs handler + OpenAPI route definition
- `src/app/api/routes/start-run.test.ts` — 13 unit + integration tests (all pass)
- `src/app/api/app.ts` — route registration via `registerStartRunRoute`
- `src/app/api/error-map.ts` — `mapError` handles WorkflowConfigError and RunManagerError

## Errors / Corrections

None.

## Ready for Next Run

Task complete. All 13 tests pass. Full suite (571 pass, 1 skip, 0 fail). Type-clean.
