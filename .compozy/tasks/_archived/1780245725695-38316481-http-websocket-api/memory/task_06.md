# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement `GET /runs/:id` returning `RunDetail` with id/slug-prefix resolution, 404 for unknown, 409 for ambiguous prefix.

## Important Decisions

- Declared 200/404/409 responses in `createRoute` — required explicit `200` status arg on success return (`c.json({...}, 200)`) to avoid TypeScript union-inference failure in `@hono/zod-openapi` v1.4.0.
- 409 body includes `candidates: string[]` from `RunManagerError.data`.
- `AmbiguousErrorSchema` and `ApiErrorSchema` are local to the route file (not shared in schema.ts) — they are transport-internal error shapes, not cross-task contracts.

## Learnings

- OpenAPI path for parameterized routes registered as `/runs/:id` (Hono syntax), NOT `/runs/{id}` (OpenAPI standard). Tests must assert against `/runs/:id`.
- `c.json(body)` without explicit status creates `JSONRespondReturn<body, 200|404|409>` when multiple responses declared — TypeScript fails. Must pass explicit `200`.
- `toContain()` on a string array with an `unknown`-typed argument fails TS — cast to `string` first.

## Files / Surfaces

- `src/app/api/routes/run-detail.ts` — created: route definition + handler
- `src/app/api/app.ts` — updated: import + `registerRunDetailRoute(app, runManager)` call
- `src/app/api/routes/run-detail.test.ts` — created: 8 unit tests + 3 integration tests (11 total, all passing)

## Errors / Corrections

- Initial `interface MockGetBehavior { ... } | { ... }` union syntax was invalid (interface can't use union). Fixed: `type MockGetBehavior = | {...} | {...}`.
- TypeScript error on handler return without explicit status — fixed by adding `200` arg.
- OpenAPI spec test assumed `/runs/{id}` key — corrected to `/runs/:id`.

## Ready for Next Run

Task complete. Route is live, registered in OpenAPI, fully tested. Diff ready for manual review (auto-commit disabled).
