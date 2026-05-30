# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Implemented pure domain run id/slug generation and prefix parsing for task 02.

## Important Decisions
- `generateRunId` follows the UUID hex path from the techspec when the injected/default seed has at least 16 hex chars after dash removal; non-UUID injected strings are UTF-8 encoded so tests can still use readable deterministic seeds.
- Slug generation calls the injected number source once per word and clamps non-finite, negative, and `1.0` edge values to valid wordlist indexes.

## Learnings
- `bun test --coverage` reports `src/domain/run-id.ts` at 100% function and line coverage; repo-wide function coverage remains below 80% because existing ACP infra is not covered by this task.
- Typecheck requires expected values in branded-type assertions to use `asRunId`/`asRunSlug` or string conversion at assertion boundaries.
- Final verification after tracking updates: `bun test --coverage` passed 107 tests with 0 failures; `bun run typecheck` exited 0; `bun run build` exited 0.

## Files / Surfaces
- Added `src/domain/run-id.ts`.
- Added `src/domain/run-id.test.ts`.
- Updated `.compozy/tasks/daemon-mode/task_02.md` and `_tasks.md` after verification.

## Errors / Corrections
- Initial `bun run typecheck` failed because test expectations used plain strings for branded `RunId`/`RunSlug` values; fixed tests to preserve production branded types.

## Ready for Next Run
- Task 08 should implement active-run collision retry around `generateRunId` and `generateSlug`; this task only provides deterministic generation and candidate prefix parsing.
