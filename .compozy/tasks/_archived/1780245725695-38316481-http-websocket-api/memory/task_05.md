# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement `GET /runs` endpoint returning `{ runs: RunSummary[] }` with optional `?all=true` query
that maps to `RunManager.list({ includeOldTerminal })`. Mirrors `run-ps.ts` handler mapping logic.

## Important Decisions

- Query param `?all` accepted as raw `z.string().optional()`, converted in handler via `=== "true"`.
  Avoids `z.coerce.boolean()` pitfall (coerces "false" → `true` in JS).
- Ordering is not re-applied in the handler — we trust `RunManager.list()` return order.
- `attachedCount` uses exact same try/catch pattern as `run-ps.ts` (exact-id lookup can't ambiguate).

## Learnings

- `new Set(Array(n).fill({}))` → size is always 1 (same reference). Use
  `Array.from({ length: n }, () => ({}))` to get n unique objects.
- `fake:hang` + `manager.stop()` blocks for up to `STOP_TIMEOUT_MS = 5000ms`. Use `fake:complete`
  + a short `setTimeout(200)` wait for integration tests that need a terminal run.
- `event-log.test.ts` has a pre-existing intermittent failure in the full parallel suite (ENOENT on
  a temp file); passes in isolation. Not introduced by this task.

## Files / Surfaces

- `src/app/api/routes/runs.ts` — new: `GET /runs` handler + route definition
- `src/app/api/routes/runs.test.ts` — new: 14 unit + integration tests
- `src/app/api/app.ts` — modified: added `registerRunsRoute` import + call

## Errors / Corrections

- First test run: `attachedCount` test failed (Set dedup); fixed by using unique object array.
- First test run: integration stop-test timed out; replaced with `fake:complete` pattern.

## Ready for Next Run

Task complete. All 14 tests pass; typecheck clean; full suite 547 pass / 0 fail.
Next task (06) can import `RunSummarySchema` from `schema.ts` and follow the same `runs.ts` pattern.
