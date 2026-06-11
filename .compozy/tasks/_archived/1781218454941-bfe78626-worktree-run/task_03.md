---
status: completed
title: RunManager.startRun reuse-or-create worktree orchestration
type: backend
complexity: high
dependencies:
  - task_01
  - task_02
---

# Task 3: RunManager.startRun reuse-or-create worktree orchestration

## Overview
Teach `RunManager.startRun` to accept an optional `branch` and, when present, provision an isolated worktree: reuse an existing worktree for the branch or create one adjacent to the repository, then run the agent in the worktree instead of the user's directory. This is the core of the feature, where the adapter (task_01) and snapshot fields (task_02) come together.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `startRun` MUST accept an optional `branch` and behave identically to today when it is absent (no git calls, run in `cwd`).
- A `GitWorktrees` instance MUST be injectable via `RunManagerOptions` (defaulting to the real adapter), mirroring `createMcpServer`/`generateId`.
- When `branch` is present, the cwd MUST be validated as a git repo via `resolveRepoRoot`; a non-repo MUST raise `RunManagerError("NOT_A_GIT_REPO")`.
- When the branch already has a worktree, the run MUST reuse that worktree path and skip creation (ADR-005).
- When the branch has no worktree, a worktree MUST be created at a path adjacent to the repo root named from the repo directory and a sanitized branch (ADR-003), creating the branch off HEAD only when it does not already exist.
- A `GitWorktreeError("PATH_EXISTS")` MUST be surfaced as `RunManagerError("WORKTREE_CONFLICT")`.
- The run MUST execute in `worktreePath ?? cwd`, and `worktreePath`/`branch` MUST be recorded on the run snapshot.
- Pure validation (`resolveRepoRoot`, existing-worktree lookup) SHOULD occur before reserving the run slot; the mutating `addWorktree` SHOULD be the last fallible step before constructing the `Runner`.
</requirements>

## Subtasks
- [x] 3.1 Add the optional `branch` parameter and inject `GitWorktrees` via options.
- [x] 3.2 Implement reuse-or-create resolution of the worktree path (validate repo, lookup existing, compute sibling path, create when needed).
- [x] 3.3 Sanitize the branch name into a safe directory segment for the worktree path.
- [x] 3.4 Record `worktreePath`/`branch` on the run and construct the `Runner` with `worktreePath ?? cwd`.
- [x] 3.5 Map adapter/validation failures to `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT`.
- [x] 3.6 Cover with fake-adapter unit tests and direct-RunManager integration tests against real git.

## Implementation Details
Modify `src/infra/daemon/run-manager.ts`. The new git work slots into `startRun` near the existing `cwd` validation block (absolute/exists/isDirectory) and run-limit check. The error codes `NOT_A_GIT_REPO` and `WORKTREE_CONFLICT` are added to the registry in task_04; this task throws `RunManagerError` with those names — coordinate ordering so the names exist (they may be added here or pulled from task_04). Worktree path = `join(dirname(repoRoot), repoBase + "-" + sanitize(branch))`. See TechSpec "System Architecture" data-flow, "Implementation Design", and ADR-003/ADR-005.

### Relevant Files
- `src/infra/daemon/run-manager.ts` — `startRun`, `RunManagerOptions`, `RunManagerError`, `retryStep` (carry fields forward).
- `src/infra/daemon/run-manager.test.ts` — existing unit tests to extend with the fake adapter.
- `src/infra/git/git-worktrees.ts` — adapter + fake from task_01.
- `src/domain/run.ts` — `Run.create` with new fields from task_02.

### Dependent Files
- `src/infra/daemon/handlers/run-start.ts` — forwards `branch` and maps errors (task_04).
- `src/infra/daemon/__tests__/integration/` — daemon-harness tests (task_04).

### Related ADRs
- [ADR-005: Reuse an existing worktree for a branch instead of erroring](adrs/adr-005.md) — Reuse-vs-create decision logic.
- [ADR-003: Place isolated worktrees adjacent to the repository](adrs/adr-003.md) — Worktree path computation.
- [ADR-004: Represent isolation as worktreePath + branch on the run snapshot](adrs/adr-004.md) — `worktreePath ?? cwd` execution and field recording.
- [ADR-002: Git worktree operations via simple-git behind an injectable adapter](adrs/adr-002.md) — Inject the adapter via `RunManagerOptions`.

## Deliverables
- `startRun` reuse-or-create orchestration honoring the non-isolated default.
- Branch-name sanitization for worktree paths.
- `NOT_A_GIT_REPO` / `WORKTREE_CONFLICT` error mapping at the manager boundary.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests driving a real `RunManager` against real temporary git repositories **(REQUIRED)**

## Tests
- Unit tests (fake `GitWorktrees`):
  - [x] No `branch`: no git calls made; run uses `cwd`; snapshot has no `worktreePath`/`branch`.
  - [x] Branch with an existing worktree: `addWorktree` is NOT called; run uses the existing worktree path; snapshot records it.
  - [x] New branch (does not exist, no worktree): `addWorktree` called with `createBranch: true` and the computed sibling path; run uses it.
  - [x] Existing branch without a worktree: `addWorktree` called with `createBranch: false`.
  - [x] `resolveRepoRoot` returns null → `RunManagerError("NOT_A_GIT_REPO")` and no slot reserved.
  - [x] Adapter throws `GitWorktreeError("PATH_EXISTS")` → `RunManagerError("WORKTREE_CONFLICT")`.
  - [x] Branch name containing `/` sanitizes into a single safe directory segment in the path.
- Integration tests (real `RunManager` + real git temp repo):
  - [x] Isolated run against a fresh repo creates the worktree on the branch and the run completes; snapshot reports `worktreePath`/`branch`.
  - [x] Second isolated run on the same branch reuses the same worktree directory.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Non-isolated `startRun` behavior is unchanged
- Isolated runs execute in the resolved worktree and record it on the snapshot
