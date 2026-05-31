# Task Memory: task_15.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Write `docs/ws-protocol.md`, add README HTTP/WS API section, add OpenAPI completeness test. All done.

## Important Decisions

- **OpenAPI schemas are inlined, not `$ref` components**: `@hono/zod-openapi` inlines Zod schema shapes directly in route responses rather than generating `components.schemas` entries. Tested against inline properties instead.
- **WS `/runs/:id/attach` is NOT in the OpenAPI doc**: registered with `app.get()` not `app.openapi()`, so it doesn't appear in `/openapi.json` paths. Task requirement only lists HTTP endpoints (health, runs, runs/:id, start, stop, retry-step, events) — the WS endpoint is documented in `docs/ws-protocol.md` instead.
- **OpenAPI path key format**: parameterized routes appear as `/runs/:id` (Hono syntax), not `/runs/{id}` (OpenAPI standard). Tests assert `:id` form.

## Files / Surfaces

- `docs/ws-protocol.md` — new; ~50 lines; documents all AttachFrame variants, input frame, fromSeq, truncation, close codes, guardrails.
- `README.md` — added HTTP/WS API section before "Development"; names port 4517, lists all endpoints, WS attach, daemon.json discovery.
- `src/app/api/openapi-completeness.test.ts` — new; 16 tests (all pass); unit tests for doc content + OpenAPI completeness via `createApiApp` in-process.

## Ready for Next Run

Task 15 complete. All tasks in _tasks.md are now done. diff ready for manual review and commit.
