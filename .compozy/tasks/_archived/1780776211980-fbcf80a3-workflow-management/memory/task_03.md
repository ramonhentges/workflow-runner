# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented GET /workflows/:name, POST /workflows, PUT /workflows/:name, and DELETE /workflows/:name in `src/app/api/routes/workflow-crud.ts`. Registered in `app.ts`. OpenAPI completeness test updated. 32 unit+integration tests all passing.

## Important Decisions

- DELETE route required an explicit `400` response in its `createRoute` definition to satisfy TypeScript — the `MISSING_CWD` return path must be declared.
- Path traversal tests use POST body (name field) rather than URL path param — Hono normalizes URL `..` sequences which makes path-param traversal tests unreliable.
- In-place PUT (no rename) skips the run-guard check intentionally — only destructive/identity-changing operations (rename, delete) are guarded.
- `writeJsonAtomic` puts the temp file in the same directory as the target for atomicity (same filesystem = atomic rename on POSIX).
- `resolveWorkflowFile` exported for potential reuse by future tasks (e.g., task_05 catalog route, task_06 client).

## Learnings

- `z.unknown()` in a zod-openapi `createRoute` response schema works fine; TypeScript accepts `unknown` assignable to `unknown` in the response body.
- Hono `c.req.valid("param")` runs schema validation after routing; `WorkflowNameParamSchema` refine rejects names with `..`, `/`, `\` and returns 400 from Hono's default validation error handler.
- `RunSnapshot` requires a `kickoffPrompts` field in test fixtures (added to `makeRunningSnapshot`).

## Files / Surfaces

- `src/app/api/routes/workflow-crud.ts` — new (4 routes + helpers)
- `src/app/api/app.ts` — added `registerWorkflowCrudRoutes` import + call
- `src/app/api/openapi-completeness.test.ts` — added 4 new test cases + `/workflows/:name` to expected paths
- `src/app/api/routes/workflow-crud.test.ts` — new (32 tests: unit + integration + OpenAPI)

## Errors / Corrections

- Initial DELETE route definition was missing the `400` response entry; TypeScript caught it immediately via `c.json(…, 400)` type mismatch.

## Ready for Next Run

task_03 is complete. task_04 (if any) or task_06 (API client) can import `resolveWorkflowFile` / `writeJsonAtomic` if needed, but those are internal — the public surface is the HTTP API.
