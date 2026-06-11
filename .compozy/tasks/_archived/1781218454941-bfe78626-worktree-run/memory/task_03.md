# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Teach `RunManager.startRun` an optional `branch`: when present, provision an isolated git worktree (reuse existing per ADR-005 or create a sibling per ADR-003) and run in `worktreePath ?? cwd`, recording `worktreePath`/`branch`. Non-isolated path (no branch) unchanged.

## Important Decisions

- Added `NOT_A_GIT_REPO` / `WORKTREE_CONFLICT` to `RpcErrorCode` in protocol.ts here (task_04 owns handler wiring; names must exist for `RunManagerError`).
- Pure validation (resolveRepoRoot, findWorktreeForBranch, branchExists, path compute) runs BEFORE reserving the run slot; `addWorktree` is the LAST fallible step inside the slot-reservation try (per TechSpec known-risks mitigation).
- `retryStep` carries `worktreePath`/`branch` forward in the rebuilt snapshot and runs the retry Runner in `worktreePath ?? cwd` (previously omitted cwd → process.cwd(); now correct).
- Branch sanitize: `[^a-zA-Z0-9._-]+` → `-`, trim leading/trailing `-`.

## Learnings

- `FakeSessionFactory({ onCreate })` captures `RunnerAgentSessionArgs.cwd` — used to assert the run executes in the worktree path.
- Integration tests against real git must `realpathSync` temp dirs (git returns canonical paths; shared learning from task_01/02).

## Files / Surfaces

- `src/infra/daemon/protocol.ts` — 2 new error codes.
- `src/infra/daemon/run-manager.ts` — `RunManagerOptions.gitWorktrees`, `startRun(branch?)`, sanitize helper, retryStep carry-forward.
- `src/infra/daemon/run-manager.test.ts` — fake-adapter unit tests.
- `src/infra/daemon/run-manager.integration.test.ts` — real-git integration tests (new).

## Errors / Corrections

## Ready for Next Run

- task_04 wires `branch` through `run.start` params/handlers and maps the two error codes at the RPC/HTTP edges (codes already in registry).
