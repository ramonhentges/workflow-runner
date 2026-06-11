# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- task_01 complete: `GitWorktrees` adapter + `FakeGitWorktrees` fake live in `src/infra/git/`. `simple-git@3.36.0` is a runtime dep.
- task_02 complete: `RunSnapshot` + `Run` carry optional `worktreePath?`/`branch?` (emitted only when set, round-trip via `create`/`snapshot`/`fromSnapshot`). `Run.create` accepts both. Storage-only — effective cwd `worktreePath ?? cwd` is computed in task_03's RunManager.
- task_03 complete: `RunManager.startRun(workflowPath, cwd, branch?)` does reuse-or-create worktree orchestration, runs in `worktreePath ?? cwd`, records both fields; `retryStep` carries them forward. `RunManagerOptions.gitWorktrees` injects the adapter (defaults to `SimpleGitWorktrees`). Error codes `NOT_A_GIT_REPO` (-32010) and `WORKTREE_CONFLICT` (-32011) are ALREADY in `RpcErrorCode` (protocol.ts) — task_04 only needs to map them at the RPC/HTTP edges, not add them.
- task_04 complete: RPC `run.start` params accept optional `branch`; the start handler forwards it. `RunListEntry` carries optional `worktreePath`/`branch`, populated by the `run.ps` handler from the snapshot (undefined for non-isolated runs → omitted on the wire). The start handler maps the two worktree error codes for FREE — `RunManagerError` already carries the `RpcErrorCode`, so the pre-existing generic `catch` re-throws `new RpcError(e.code, ...)`; no per-code branch was added. Daemon-harness integration tests with real temp git repos live in `src/infra/daemon/__tests__/integration/isolated-runs.test.ts`.
- task_06 complete: CLI entry point. `parseStartArgs` accepts `--branch <name>` / `--branch=<name>` (rejects missing value), `StartArgs.branch?` added (omitted when absent → unchanged parsed shape). `start` command forwards `branch` to `run.start` via conditional spread and maps `NOT_A_GIT_REPO`→"not a git repository: …", `WORKTREE_CONFLICT`→"worktree conflict: …" in `formatStartError`. `formatPsTable` renders isolation as a CONTINUATION LINE under the row (`  ↳ branch <b>  worktree <path>`), not a new column — non-isolated rows/widths unchanged. Only task_07 (web) remains.
- task_07 complete: Web surface. `web/src/lib/api/types.ts` — `StartRunRequest.branch?`, `RunSummary`/`RunDetail` `worktreePath?`/`branch?`; zod `RunDetailSchema` in `web/src/lib/api/client.ts` gained the two fields (else stripped from the WS snapshot frame). `StartRunForm` adds an optional branch input, sends `branch` only when non-empty (whitespace = empty); isolation errors (`NOT_A_GIT_REPO`/`WORKTREE_CONFLICT`) surface inline via the existing `submit-error` (server 400 message → `ApiError.message`, no special-casing). `RunView` shows worktree path + branch from `vm.snapshot` for isolated runs. SERVER GAP FIXED: `src/app/api/routes/ws-attach.ts` snapshot frame now emits `worktreePath`/`branch` — task_05 had only added them to the HTTP `GET /runs/:id` route, but RunView consumes the WS snapshot, not that endpoint. All worktree-run tasks (01–07) now complete.
- task_05 complete: HTTP surface exposed. `StartRunRequestSchema` gained optional `branch` (`z.string().min(1).optional()`); `POST /runs` (`routes/start-run.ts`) forwards it to `RunManager.startRun(wp, cwd, branch)`. `RunSummarySchema`/`RunDetailSchema` gained optional `worktreePath`/`branch`, emitted from the snapshot by `routes/runs.ts` + `routes/run-detail.ts`. `error-map.ts` `ERROR_HTTP_STATUS` maps `NOT_A_GIT_REPO` + `WORKTREE_CONFLICT` → 400 (no per-code branch needed — `mapError` reads the table by numeric `RpcErrorCode`). HTTP contract for task_07: request `{ workflowPath, cwd, branch? }`; responses carry optional `worktreePath`/`branch`. HTTP-level isolated-run integration tests added in `routes/start-run.test.ts`.

## Shared Decisions

- `GitWorktrees` interface exposes exactly: `resolveRepoRoot`, `findWorktreeForBranch`, `branchExists`, `addWorktree`. Real impl is `SimpleGitWorktrees`; error type is `GitWorktreeError` with codes `"BRANCH_IN_USE" | "PATH_EXISTS"`.
- Dependent tasks (task_03 RunManager) MUST unit-test via `FakeGitWorktrees` from `src/infra/git/git-worktrees.fake.js` — seeds repoRoots/branches/worktreesByBranch, records `addWorktreeCalls`, supports `addWorktreeError`.

## Shared Learnings

- `simple-git` worktree commands work under Bun (verified). Use `git.raw(["worktree", ...])` for add/list; `revparse(["--show-toplevel"])` for root (throws on non-repo → adapter returns null); `branchLocal().all` for branch existence.
- Tests against real temp repos must `realpathSync` the mkdtemp dir — git reports canonical paths or assertions fail on symlinked tmp.

## Open Risks

- `addWorktree` error normalization keys off git stderr text (`/already exists/`, `/already (checked out|used by worktree)/`); fragile if git changes wording.
- `run-store.ts` `validateSnapshotShape` does NOT reject unknown/extra keys, and `parseMetaJson` spreads all non-`schemaVersion` fields through — so additive optional snapshot fields persist round-trip with no store change. If task_04 needs strict validation of `worktreePath`/`branch`, it must add explicit checks there.

## Handoffs

- task_03 consumes this adapter via `RunManagerOptions.gitWorktrees`; reuse-or-create flow = `findWorktreeForBranch` first (reuse, ADR-005), else compute sibling path + `addWorktree` with `createBranch = !branchExists`.
