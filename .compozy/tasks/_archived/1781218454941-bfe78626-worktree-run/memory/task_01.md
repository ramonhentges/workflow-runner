# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

- Done. `GitWorktrees` adapter (simple-git) with reuse-or-create ops; fake; tests at 100% coverage; verified under Bun.

## Important Decisions

- Branch existence via `branchLocal().all.includes(branch)` (not a worktree-list parse).
- `gitFactory` injected into `SimpleGitWorktrees` ctor only to keep parsing/normalization seams unit-testable; defaults to real `simpleGit`.
- Exported `parseWorktreeForBranch` standalone for direct unit testing of porcelain parsing.

## Learnings

- 100% func+line coverage achieved; `bun test --coverage` confirms.
- `git worktree add -b <branch> <path>` = create-off-HEAD; `git worktree add <path> <branch>` = checkout existing.

## Files / Surfaces

- `src/infra/git/git-worktrees.ts` (interface, error, `SimpleGitWorktrees`, `parseWorktreeForBranch`)
- `src/infra/git/git-worktrees.fake.ts` (`FakeGitWorktrees`)
- `src/infra/git/git-worktrees.test.ts`
- `package.json` (+simple-git@3.36.0)

## Errors / Corrections

- none

## Ready for Next Run

- task_02 (Run/RunSnapshot fields) and task_03 (RunManager orchestration) can start; adapter + fake ready to inject.
