# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

DONE. Exposed worktree isolation over the HTTP API: optional `branch` in on `POST /runs`; `worktreePath`/`branch` out on `GET /runs` + `GET /runs/:id`; `NOT_A_GIT_REPO`/`WORKTREE_CONFLICT` → HTTP 400.

## Important Decisions

- `RunManager.startRun(workflowPath, cwd, branch?)` ALREADY accepted `branch` (added in task_03). The route was the only forwarding gap — no RunManager change needed.
- `mapError` needed NO per-code branch: it derives the HTTP status from `ERROR_HTTP_STATUS` keyed by the numeric `RpcErrorCode`, so adding the two table entries was the whole error-map change. The start-run route's `status as 400 | 429` cast still holds since both new codes map to 400 (already a declared response).

## Learnings

- Zod `.optional()` fields are simply absent (undefined) on parse when omitted — both summary/detail "omit when not isolated" assertions just check `toBeUndefined()`, no `.strict()` needed.
- HTTP-level isolated-run integration tests can run against a real temp git repo using `execFileSync("git", ...)` + real `RunManager` + `FixtureSessionFactory` + `createApiApp`, mirroring the daemon harness pattern. `realpathSync` the repo/parent dirs (canonical paths) and clean up the worktree's parent dir too (worktree is a sibling of the repo, outside storageRoot).
- Non-git `cwd` → `NOT_A_GIT_REPO`: a plain `mkdtemp` dir under `/tmp` is reliably outside any repo.

## Files / Surfaces

- `src/app/api/schema.ts` — `StartRunRequestSchema.branch` (z.string().min(1).optional()); `worktreePath?`/`branch?` on `RunSummarySchema` + `RunDetailSchema`.
- `src/app/api/routes/start-run.ts` — destructure + forward `branch`.
- `src/app/api/routes/runs.ts`, `run-detail.ts` — emit `snap.worktreePath`/`snap.branch`.
- `src/app/api/error-map.ts` — `ERROR_HTTP_STATUS` entries for `NOT_A_GIT_REPO`/`WORKTREE_CONFLICT` = 400.
- Tests: `schema.test.ts`, `error-map.test.ts`, `routes/runs.test.ts`, `routes/run-detail.test.ts`, `routes/start-run.test.ts` (added unit + HTTP integration).

## Errors / Corrections

- Widened the local `StartRunFn` test type in `start-run.test.ts` to `(workflowPath, cwd, branch?)` so the forwarding mock compiles.

## Ready for Next Run

- task_06 (CLI `--branch`) and task_07 (web) are the remaining surfaces. The HTTP contract is now: request `{ workflowPath, cwd, branch? }`; responses carry optional `worktreePath`/`branch`. Coverage on touched files 98.6–100%; full suite green (1100 pass).
