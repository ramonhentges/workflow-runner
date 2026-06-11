---
status: completed
title: GitWorktrees adapter (simple-git) with reuse-or-create operations
type: backend
complexity: medium
dependencies: []
---

# Task 1: GitWorktrees adapter (simple-git) with reuse-or-create operations

## Overview
Introduce a single infra adapter that wraps `simple-git` and exposes the few git operations isolated runs need: resolve a repository root, find an existing worktree for a branch, check branch existence, and add a worktree. This adapter is the seam every higher layer depends on, and isolating git here keeps `RunManager` testable with a fake.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `simple-git` as a runtime dependency in `package.json`.
- MUST define a `GitWorktrees` interface and one real implementation in a new `src/infra/git/` location, exposing exactly: `resolveRepoRoot`, `findWorktreeForBranch`, `branchExists`, `addWorktree` (see TechSpec "Core Interfaces").
- `resolveRepoRoot(dir)` MUST return the absolute repository root for a directory inside a repo (including a nested subdirectory) and `null` when the directory is not in a git repository.
- `findWorktreeForBranch(repoRoot, branch)` MUST return the path of an existing worktree already checked out on that branch, or `null` when none exists (parses `git worktree list --porcelain`).
- `addWorktree` MUST create the branch off current HEAD when `createBranch` is true and check out the existing branch otherwise, and MUST throw `GitWorktreeError("PATH_EXISTS")` when the target path is occupied by a non-worktree directory.
- MUST expose a test fake implementing `GitWorktrees` for use by dependent tasks' unit tests.
- MUST verify `simple-git` worktree commands (including `worktree list --porcelain`) execute correctly under the Bun runtime.
</requirements>

## Subtasks
- [x] 1.1 Add `simple-git` to `package.json` dependencies and install.
- [x] 1.2 Define the `GitWorktrees` interface and `GitWorktreeError` typed error.
- [x] 1.3 Implement the real adapter over `simple-git` for all four operations.
- [x] 1.4 Implement a reusable test fake of `GitWorktrees`.
- [x] 1.5 Cover the adapter with unit tests against real temporary git repositories.

## Implementation Details
Create `src/infra/git/git-worktrees.ts` (interface, `GitWorktreeError`, real adapter) and a test fake (co-located, e.g. `src/infra/git/git-worktrees.fake.ts` or under a test-helpers path consistent with the project). The adapter wraps `simple-git`; repository-root resolution uses `rev-parse --show-toplevel`, existing-worktree lookup parses `worktree list --porcelain`, and creation uses `worktree add` (with branch creation when needed). See TechSpec "Core Interfaces", "Implementation Design", and ADR-002/ADR-005.

### Relevant Files
- `package.json` — add `simple-git` dependency (currently only `@agentclientprotocol/sdk`, `@hono/zod-openapi`, `hono`, `zod`).
- `src/infra/git/git-worktrees.ts` — new adapter, interface, and error type.
- `src/infra/acp/agent-session.ts` — existing precedent for spawning subprocess tooling; mirror error-normalization style.

### Dependent Files
- `src/infra/daemon/run-manager.ts` — will consume this adapter (task_03).

### Related ADRs
- [ADR-002: Git worktree operations via simple-git behind an injectable adapter](adrs/adr-002.md) — Defines the adapter seam and DI rationale.
- [ADR-005: Reuse an existing worktree for a branch instead of erroring](adrs/adr-005.md) — Drives the `findWorktreeForBranch` operation.
- [ADR-003: Place isolated worktrees adjacent to the repository](adrs/adr-003.md) — Path placement consumed by the caller, resolved via `resolveRepoRoot`.

## Deliverables
- `GitWorktrees` interface, real `simple-git`-backed adapter, and `GitWorktreeError` typed error.
- Reusable `GitWorktrees` test fake.
- `simple-git` added to `package.json`.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests exercising the adapter against real temporary git repositories **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `resolveRepoRoot` returns the repo root when given the repo root directory.
  - [x] `resolveRepoRoot` returns the repo root when given a nested subdirectory of the repo.
  - [x] `resolveRepoRoot` returns `null` for a directory outside any git repository.
  - [x] `branchExists` returns true for an existing local branch and false for an unknown name.
  - [x] `findWorktreeForBranch` returns the path of a branch that already has a worktree, and `null` when the branch has no worktree.
  - [x] `addWorktree` with `createBranch: true` creates a new branch off HEAD and a worktree at the target path.
  - [x] `addWorktree` with `createBranch: false` checks out an existing branch into a new worktree.
  - [x] `addWorktree` throws `GitWorktreeError("PATH_EXISTS")` when the target path is an existing non-worktree directory.
- Integration tests:
  - [x] Full sequence against a real temp repo: init+commit, create worktree on a new branch, then `findWorktreeForBranch` reports that worktree's path.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- `GitWorktrees` exposes only the four required operations and a typed error
- Adapter verified to run under Bun (worktree commands succeed)
