# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Thread optional `branch` through RPC `run.start`; surface isolated run `worktreePath`/`branch` in `run.ps`; ensure the two worktree error codes map at the RPC edge. COMPLETE.

## Important Decisions

- Error mapping needed NO new code in `run-start.ts`: `RunManagerError` already carries the `RpcErrorCode` for its name, and the existing generic `catch (e instanceof RunManagerError)` re-throws `new RpcError(e.code, ...)`. So `NOT_A_GIT_REPO`/`WORKTREE_CONFLICT` flow through unchanged — only added a clarifying comment + unit tests proving it.
- Did NOT populate `cwd` in `run.ps` even though `RunListEntry.cwd?` exists and is currently unpopulated — out of task scope and would change non-isolated `ps` output (req: "non-isolated behavior unchanged"). Left as pre-existing gap.
- `run-ps.ts` sets `worktreePath: snap.worktreePath` / `branch: snap.branch` unconditionally; for non-isolated runs these are `undefined` and drop out of JSON-RPC serialization, so the wire shape is unchanged.

## Learnings

- The fixture session factory (`WORKFLOW_RUNNER_FAKE_FACTORY=1`) writes NO files to cwd, so "no lost edits" can't be asserted via agent output at the harness level. Modeled the concurrency test as: distinct branches → distinct worktree paths, both exist on disk on their respective branches, both runs `completed`.
- Integration tests must create their own temp git repo (harness `storageRoot` is under `XDG_STATE_HOME`, not a repo). Worktrees land adjacent to the repo (`dirname(repoRoot)`), so the temp repo needs a `parentDir` that the test cleans up separately from `h.cleanup()`.
- `realpathSync` the mkdtemp parent so worktree-path assertions match git's canonical paths; reuse test asserts against `realpathSync(existing)`.
- `sanitizeBranch("feature/iso")` → `feature-iso`; worktree dir = `<repo>-feature-iso`.

## Files / Surfaces

- `src/infra/daemon/protocol.ts` — `run.start` params `+branch?`; `RunListEntry` `+worktreePath?/+branch?`.
- `src/infra/daemon/handlers/run-start.ts` — forward `params.branch` to `startRun`.
- `src/infra/daemon/handlers/run-ps.ts` — emit `worktreePath`/`branch` from snapshot.
- `src/infra/daemon/handlers/handlers.test.ts` — unit tests (branch forward, both error codes, ps emit/omit); extended `makeSnapshot` with worktreePath/branch overrides.
- `src/infra/daemon/__tests__/integration/isolated-runs.test.ts` — NEW harness+real-git tests (lifecycle, distinct-branch concurrency, reuse).

## Errors / Corrections

(none)

## Ready for Next Run

- task_05 (HTTP `error-map.ts`) maps `NOT_A_GIT_REPO`/`WORKTREE_CONFLICT` → 400; task_06 (`src/infra/client/format.ts`) renders `RunListEntry.worktreePath`/`branch`. Both fields are now on `RunListEntry`.
