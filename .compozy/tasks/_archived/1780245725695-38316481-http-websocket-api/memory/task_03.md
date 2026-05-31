---
name: task-03-memory
description: Task-local execution context for task_03 — HTTP app harness, error map, OpenAPI, speciation guard
metadata:
  type: project
---

# Task Memory: task_03.md

## Objective Snapshot

Create `src/app/api/` Hono harness:
1. `app.ts` — `createApiApp(rm: RunManager): OpenAPIHono` factory + `app.doc('/openapi.json', ...)`
2. `error-map.ts` — `ERROR_HTTP_STATUS` table + `httpStatusForError(err)` helper
3. `app.test.ts` — unit tests (error map, `/openapi.json`)
4. `speciation-guard.test.ts` — test-only stdin/stdout adapter proves RunManager needs no changes

## Important Decisions

- `createApiApp` returns `OpenAPIHono` (bare, no generic env). Route tasks receive `(app, rm)` and register via `app.openapi(...)`.
- `app.doc('/openapi.json', ...)` is registered in the factory; routes added later appear at request time.
- `error-map.ts` exports `ERROR_HTTP_STATUS: Record<number, number>` + `httpStatusForError`. Also exports `mapError(err)` for full error shape (code string, message, status).
- `WorkflowConfigError` from `src/domain/workflow.ts` maps to 400 in `mapError` (same as WORKFLOW_INVALID).
- Speciation guard: minimal in-memory stdin/stdout adapter (plain handler functions, no real I/O) drives `RunManager.list()` and error mapping. Proves thin-handler pattern without RunManager changes.

## Files / Surfaces

- `src/app/api/app.ts` — new
- `src/app/api/error-map.ts` — new
- `src/app/api/app.test.ts` — new
- `src/app/api/speciation-guard.test.ts` — new
- No changes to `src/infra/daemon/run-manager.ts`

## Errors / Corrections

- `fakeSnapshot` helper initially spread `...overrides` after branded `asRunId`/`asRunSlug` calls, causing TS2783 ("specified more than once") and TS2322 (plain string not assignable to branded type). Fixed by changing to positional parameters instead of Partial<RunSnapshot> spread.

## Outcome

**Status: done.** All 4 files present and verified:
- 73/73 app/api tests pass (app.test.ts + speciation-guard.test.ts)
- 523/523 full suite passes
- Typecheck: exit 0
- Route tasks 04–10 import `ApiApp` type from `app.ts` and use `app.openapi(...)` with `rm` closure
