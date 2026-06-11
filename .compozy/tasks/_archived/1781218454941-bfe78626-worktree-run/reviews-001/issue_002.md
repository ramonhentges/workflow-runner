---
provider: manual
pr:
round: 1
round_created_at: 2026-06-11T13:33:39Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 241
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: GitWorktreeError BRANCH_IN_USE never mapped to a stable code

## Review Comment

The adapter defines two normalized failure codes and `normalizeAddWorktreeError`
can produce either:

```ts
export type GitWorktreeErrorCode = "BRANCH_IN_USE" | "PATH_EXISTS";
```

But `RunManager.startRun`'s catch only maps `PATH_EXISTS`:

```ts
if (err instanceof GitWorktreeError && err.code === "PATH_EXISTS") {
  throw new RunManagerError("WORKTREE_CONFLICT", err.message);
}
throw err; // a BRANCH_IN_USE GitWorktreeError falls through here
```

A `BRANCH_IN_USE` error therefore escapes as a raw `GitWorktreeError`. Downstream:

- The RPC `run-start` handler only translates `RunManagerError` and
  `WorkflowConfigError`, so it rethrows as a generic JSON-RPC internal error.
- The HTTP `mapError` does not recognize `GitWorktreeError`, so it maps to
  `500 INTERNAL_ERROR` (and `start-run.ts` even casts the status `as 400 | 429`,
  masking the undocumented 500).

This contradicts the PRD goal of *clear failure on invalid isolation request* —
the user gets an opaque 500/internal error instead of a stable, actionable code.

The reuse-first flow (`findWorktreeForBranch`) makes `BRANCH_IN_USE` unlikely in
the common case, but it is still reachable via a TOCTOU race: between
`findWorktreeForBranch` returning null and `addWorktree` running, another run (or
external process) can check the branch out into a worktree, and git's "already
checked out / already used by worktree" error becomes `BRANCH_IN_USE`.

Suggested fix: introduce a **distinct** stable error code for this case rather
than folding it into `WORKTREE_CONFLICT`, so callers and users can tell "the
branch is checked out in another worktree" apart from "a non-worktree directory
occupies the computed path." Concretely:

1. Add `BRANCH_IN_USE` to `RpcErrorCode` in `protocol.ts` (next free value, e.g.
   `-32012`).
2. Map it in the `error-map.ts` `ERROR_HTTP_STATUS` table to `400` (alongside
   `NOT_A_GIT_REPO` / `WORKTREE_CONFLICT`).
3. Map both adapter codes in the `RunManager.startRun` catch:

```ts
if (err instanceof GitWorktreeError) {
  const code = err.code === "PATH_EXISTS" ? "WORKTREE_CONFLICT" : "BRANCH_IN_USE";
  throw new RunManagerError(code, err.message);
}
```

4. Optionally surface a tailored CLI message in `start.ts`'s `formatStartError`
   (mirroring the existing `WORKTREE_CONFLICT` branch), e.g.
   `branch already checked out: ${err.message}`.

The `RpcErrorName`-keyed `RunManagerError` constructor and the HTTP `mapError`
reverse-lookup will then carry the new code end-to-end without further changes.

Add coverage: a `RunManager` unit test with a fake configured to throw
`BRANCH_IN_USE` asserting the mapped `RpcErrorCode.BRANCH_IN_USE`, and an
`error-map` test for the new 400 mapping.

## Triage

- Decision: `VALID`
- Root cause: `RunManager.startRun`'s provisioning-cleanup catch only translates
  `GitWorktreeError` with `code === "PATH_EXISTS"` into a `RunManagerError`
  (`WORKTREE_CONFLICT`). A `GitWorktreeError` carrying `code === "BRANCH_IN_USE"`
  — reachable via a TOCTOU race between `findWorktreeForBranch` returning null and
  `addWorktree` running — falls through the `throw err`. The `run.start` RPC
  handler then rethrows it as a generic JSON-RPC internal error and the HTTP
  `mapError` maps the raw `GitWorktreeError` to `500 INTERNAL_ERROR`, contradicting
  the PRD goal of a clear, stable failure on an invalid isolation request.
- Fix approach (per reviewer guidance — a **distinct** stable code, not folded
  into `WORKTREE_CONFLICT`):
  1. Add `BRANCH_IN_USE: -32012` to `RpcErrorCode` in `protocol.ts`.
  2. Map `BRANCH_IN_USE` → `400` in `error-map.ts`'s `ERROR_HTTP_STATUS`.
  3. In `RunManager.startRun`'s catch, map both adapter codes:
     `PATH_EXISTS → WORKTREE_CONFLICT`, `BRANCH_IN_USE → BRANCH_IN_USE`.
  4. Add a tailored CLI branch in `start.ts`'s `formatStartError`.
  The `RpcErrorName`-keyed `RunManagerError` constructor and the `run-start`
  handler's `RunManagerError` translation carry the new code end-to-end unchanged.
- Out-of-scope files touched (minimum needed): `protocol.ts` (new code constant),
  `error-map.ts` (HTTP status mapping), `start.ts` (CLI message). These are
  unavoidable for an end-to-end stable code per the reviewer's numbered fix.
- Tests: added a `RunManager` unit test (fake throws `BRANCH_IN_USE`, asserts the
  mapped `RpcErrorCode.BRANCH_IN_USE` and full slot/MCP/run-dir cleanup) plus
  `error-map` tests for the new 400 mapping.
