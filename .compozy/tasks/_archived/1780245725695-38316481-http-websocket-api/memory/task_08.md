---
name: task_08
description: Execution memory for task_08 — POST /runs/:id/stop
metadata:
  type: project
---

# Task Memory: task_08.md

## Objective Snapshot

Implement `POST /runs/:id/stop` HTTP route. ✅ Complete.

## Important Decisions

- **Skip `mapError` in `rm.stop()` error handler**: TypeScript's AmbiguousErrorSchema requires `candidates: string[]` on 409 responses. Using `mapError` with `status as 404 | 409` fails typecheck because `{ code, message }` is not assignable to the 409 shape. Fix: catch `RunManagerError` from `rm.stop()` and return directly as 404 (`UNKNOWN_RUN`) — the only realistic error after a confirmed `get()` is a race condition removing the run.
- **Mutable closure in unit test mocks**: to test the read-after-stop pattern, the mock run's `snapshot()` reads from a `let currentStatus` variable that `stop()` mutates. Pre-set terminal status alone can't verify the handler's post-stop read.

## Files / Surfaces

- `src/app/api/routes/stop-run.ts` — new route handler
- `src/app/api/app.ts` — added `registerStopRunRoute`
- `src/app/api/routes/stop-run.test.ts` — 10 tests: 6 unit, 1 OpenAPI, 3 integration

## Errors / Corrections

- Initial version imported `mapError` and used `status as 404 | 409` — caused TS2345 on the AmbiguousErrorSchema type mismatch. Removed `mapError`; handle 404 inline.

## Ready for Next Run

Task complete. All tests green. diff ready for manual commit.
