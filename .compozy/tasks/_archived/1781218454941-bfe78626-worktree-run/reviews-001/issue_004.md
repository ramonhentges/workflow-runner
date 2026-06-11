---
provider: manual
pr:
round: 1
round_created_at: 2026-06-11T13:33:39Z
status: resolved
file: src/infra/git/git-worktrees.test.ts
line: 129
severity: low
author: claude-code
provider_ref:
---

# Issue 004: BRANCH_IN_USE normalization path is untested

## Review Comment

`normalizeAddWorktreeError` has two branches —

```ts
if (/already exists/.test(message)) { /* PATH_EXISTS */ }
if (/already (checked out|used by worktree)/.test(message)) { /* BRANCH_IN_USE */ }
```

— but only the `PATH_EXISTS` branch is covered (git-worktrees.test.ts:129,
"throws GitWorktreeError('PATH_EXISTS') when target is a non-worktree
directory"). The `BRANCH_IN_USE` regex is never exercised, so a future change to
git's wording (or to the regex) could silently break the mapping and no test
would fail.

Because this code emits a code that callers do not currently map (see issue
002), the gap compounds: there is neither a test that the adapter produces
`BRANCH_IN_USE`, nor that the caller handles it.

Suggested fix: add an adapter test that drives a real `git worktree add` for a
branch already checked out in another worktree and asserts
`GitWorktreeError.code === "BRANCH_IN_USE"`. The integration harness already
creates real repos and worktrees, so the setup is available
(`git worktree add -b <b> <p>` then a second `addWorktree` on `<b>`).

## Triage

- Decision: `VALID`
- Root cause: `normalizeAddWorktreeError` (git-worktrees.ts:144) maps the
  `/already (checked out|used by worktree)/` git stderr wording to
  `GitWorktreeError("BRANCH_IN_USE")`, but no test exercises that branch. Only
  the `PATH_EXISTS` branch is covered (git-worktrees.test.ts:129). A change to
  git's wording or to the regex would silently break the mapping without any
  failing test.
- Fix approach: Add an adapter test in the `SimpleGitWorktrees.addWorktree`
  describe block that creates a worktree on a new branch (so the branch is
  checked out in worktree #1), then attempts a second `addWorktree` checking out
  the same branch into a different path. git rejects the second add with
  "is already checked out", driving the `BRANCH_IN_USE` branch; the test asserts
  `GitWorktreeError.code === "BRANCH_IN_USE"`. Scope is limited to the test file
  listed in the batch.
