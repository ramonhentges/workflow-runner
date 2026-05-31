# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement `POST /runs/:id/retry-step` as a thin HTTP adapter over `RunManager.retryStep`. Returns `{ resumedStepId }` on success.

## Important Decisions

- **409 schema uses optional `candidates`** (`ConflictErrorSchema`): AMBIGUOUS_PREFIX includes candidates; RUN_NOT_RETRY_ELIGIBLE does not. Using optional rather than two separate schemas avoids TypeScript type conflicts at the `c.json()` call site.
- **Read `resumedStepId` before `retryStep()`** (same as RPC handler): `currentStepId` from snapshot captured before the call; safe because `retryStep()` throws if `currentStepId` is null, so the non-null assertion only reaches the success path.
- **No `mapError` helper** for 409: the 409 requires two different payloads (with/without candidates), so errors from `get()` and `retryStep()` are handled explicitly like `stop-run.ts`.

## Files / Surfaces

- Created: `src/app/api/routes/retry-step.ts`
- Created: `src/app/api/routes/retry-step.test.ts`
- Modified: `src/app/api/app.ts` (import + `registerRetryStepRoute` call)

## Errors / Corrections

None.

## Ready for Next Run

Task complete. 11 tests pass, 0 fail. Full suite 592 pass.
