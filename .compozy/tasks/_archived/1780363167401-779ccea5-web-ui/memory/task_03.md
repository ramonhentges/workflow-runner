# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

COMPLETE. `GET /workflows?cwd=` endpoint listing `*.json` files directly under `<cwd>/workflows`.

## Important Decisions

- `cwd` declared as optional in query schema (matching `runs.ts` pattern), validated explicitly in handler to control 400 error shape (`{ code: "MISSING_CWD", message: ... }`).
- No RunManager dependency — `registerWorkflowsRoute(app)` takes only `app`.
- `path.resolve(cwd)` normalizes traversal sequences before constructing `workflowsDir = join(resolved, "workflows")`.
- `readdirSync(..., { withFileTypes: true })` with ENOENT catch → empty list for absent folder.
- `WorkflowsQuerySchema` + `WorkflowItemSchema` + `WorkflowListSchema` added to `schema.ts`.
- `openapi-completeness.test.ts` `expectedPaths` extended to include `/workflows`.

## Files / Surfaces

- `src/app/api/schema.ts` — added WorkflowsQuerySchema, WorkflowItemSchema, WorkflowListSchema
- `src/app/api/routes/workflows.ts` — new file (listing endpoint)
- `src/app/api/app.ts` — registered route via `registerWorkflowsRoute(app)`
- `src/app/api/routes/workflows.test.ts` — new test file (14 tests)
- `src/app/api/schema.test.ts` — extended with 7 new schema tests
- `src/app/api/openapi-completeness.test.ts` — `/workflows` added to expectedPaths

## Verification Evidence

- `bun run typecheck`: 0 errors
- `bun test`: 763 pass, 1 skip, 0 fail across 55 files

## Ready for Next Run

Task complete. No follow-up needed.
