---
provider: manual
pr:
round: 2
round_created_at: 2026-06-11T18:25:47Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 175
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: git read failures during isolation pre-validation surface as opaque 500

## Review Comment

In `startRun`, the isolation pre-validation block (before the slot is reserved)
makes three adapter calls:

```ts
const repoRoot = await this.#gitWorktrees.resolveRepoRoot(cwd);          // catches → null
if (repoRoot === null) throw new RunManagerError("NOT_A_GIT_REPO", ...);
const existing = await this.#gitWorktrees.findWorktreeForBranch(repoRoot, branch); // NOT guarded
...
const exists = await this.#gitWorktrees.branchExists(repoRoot, branch);  // NOT guarded
```

`resolveRepoRoot` swallows git errors and returns `null` (mapped to a clean
`NOT_A_GIT_REPO` → HTTP 400). But `findWorktreeForBranch` and `branchExists`
let any underlying git failure propagate raw:

- `SimpleGitWorktrees.findWorktreeForBranch` calls
  `git worktree list --porcelain` with no try/catch (git-worktrees.ts:94).
- `SimpleGitWorktrees.branchExists` calls `branchLocal()` with no try/catch
  (git-worktrees.ts:103).

Both run **before** the slot-reservation `try` block (run-manager.ts:230), so a
thrown `simple-git` error escapes `startRun` entirely. The `run-start` handler
only translates `RunManagerError` and `WorkflowConfigError`
(handlers/run-start.ts:12-19), so a raw git error rethrows as a generic JSON-RPC
internal error. On the HTTP edge, `mapError` maps it to `500 INTERNAL_ERROR`,
which `start-run.ts:67` then returns via `c.json({ code, message }, status as
400 | 429)` — a status the route never declares.

This is reachable whenever git can resolve the repo root but a subsequent read
fails: a corrupted/locked index, a partially-initialized repo, a transient
`git` invocation error, or a repo whose `worktree list` errors. The result
contradicts the PRD's *Clear failure on invalid isolation request* goal — the
user gets an opaque 500 instead of a stable, actionable code, and no run state
is even reserved to explain it.

Suggested fix: treat these two reads the same way `resolveRepoRoot` already
treats its failure — either catch inside the adapter and map to a stable code,
or wrap the two calls in `startRun` and translate a thrown error into a
dedicated `RunManagerError` (e.g. reuse `NOT_A_GIT_REPO` or add a
`GIT_ISOLATION_FAILED` code mapped to 400/500 deliberately). Add a `RunManager`
unit test with a `FakeGitWorktrees` configured to throw from
`findWorktreeForBranch`/`branchExists`, asserting a stable mapped code rather
than a raw error. (The `as 400 | 429` cast in `start-run.ts` is the symptom that
makes the misrouting silent; once a stable code exists it lands on the declared
400 path.)

## Triage

- Decision: `VALID`
- Root cause: In `RunManager.startRun`, the isolation pre-validation block runs
  *before* the slot-reservation `try` (run-manager.ts:230). `resolveRepoRoot`
  swallows git errors → `null` → clean `NOT_A_GIT_REPO` (400), but the two
  subsequent reads — `findWorktreeForBranch` (run-manager.ts:175) and
  `branchExists` (run-manager.ts:184) — are unguarded. `SimpleGitWorktrees`
  runs `git worktree list --porcelain` / `branchLocal()` with no try/catch
  (git-worktrees.ts:90-105), so once the repo root resolves but a subsequent
  read fails (locked/corrupt index, transient git error, unreadable worktree
  list) a raw `simple-git` error escapes `startRun`. `run-start.ts` only
  translates `RunManagerError`/`WorkflowConfigError`, so the raw error reaches
  `mapError` as `500 INTERNAL_ERROR` — an opaque status the `start-run.ts`
  route does not even declare (the `as 400 | 429` cast hides it). This
  contradicts the PRD's *Clear failure on invalid isolation request* goal.
- Fix approach: Guard both reads in `startRun`. Since `resolveRepoRoot` has
  already proven the directory is a git repo, a failure here is a genuine
  isolation read failure, not "not a git repo" — so reusing `NOT_A_GIT_REPO`
  would emit a misleading code/message. Introduced a dedicated stable
  `GIT_ISOLATION_FAILED` RpcErrorCode mapped to HTTP 400 (consistent with the
  sibling isolation failures `NOT_A_GIT_REPO`/`CWD_INVALID`/`WORKTREE_CONFLICT`
  and the route's declared 400 path) and wrapped both adapter calls so a thrown
  error becomes `RunManagerError("GIT_ISOLATION_FAILED", ...)` carrying the
  underlying git message as actionable detail. No slot is reserved on this path.
- Out-of-scope edits (minimum required, documented per the scope rule):
  introducing a new stable code necessarily touches `protocol.ts` (one enum
  entry) and `error-map.ts` (one status-map entry). Both files are already part
  of the `worktree-run` change set. The `FakeGitWorktrees` test fixture gained
  optional throw-injection config to exercise the new path.
- Notes: Added `RunManager` unit tests asserting both `findWorktreeForBranch`
  and `branchExists` failures map to the stable `GIT_ISOLATION_FAILED` code and
  reserve no slot.

