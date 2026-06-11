# TechSpec: Worktree Run — Isolated Working Directories for Concurrent Runs

## Executive Summary

Isolated runs execute in a dedicated git worktree instead of the user's working directory, eliminating file-level collisions between concurrent runs against the same repository (PRD: *Overview*, *Goals*). The design adds a thin `GitWorktrees` infra adapter (backed by `simple-git`) injected into `RunManager`, threads two optional fields — `worktreePath` and `branch` — through the run snapshot and every layer that mirrors it, and adds an opt-in branch parameter to both entry points (CLI `start --branch`, web start form / `POST /runs`). The runner executes in `worktreePath ?? cwd`, so the non-isolated path is unchanged (PRD: *Non-Goals — Always-on isolation*).

The primary trade-off: isolation logic lives in `RunManager.startRun` rather than in the I/O-free domain. `RunManager` is already the daemon's orchestration seam (it owns the `cwd` validation, run-limit, and persistence side effects), so adding worktree provisioning there keeps the domain pure and reuses the existing injectable-dependency test pattern (ADR-002). The cost is one more responsibility on an already central class, mitigated by isolating all git interaction behind the adapter.

## System Architecture

### Component Overview

- **`GitWorktrees` adapter** (`src/infra/git/git-worktrees.ts`, new) — wraps `simple-git`. Resolves the repository root, checks branch existence, and adds a worktree. Normalizes git failures (branch already checked out, path exists) into typed errors. One real implementation + one test fake (ADR-002).
- **`RunManager`** (`src/infra/daemon/run-manager.ts`, modified) — `startRun` gains an optional `branch`. When present, it validates the cwd is a git repo, computes the worktree path adjacent to the repo (ADR-003), provisions the worktree, and records `worktreePath`/`branch` on the run. The runner is constructed with `worktreePath ?? cwd`.
- **`Run` / `RunSnapshot`** (`src/domain/run.ts`, modified) — two optional fields added, round-tripped through `snapshot()` and `fromSnapshot()` (ADR-004).
- **RPC + HTTP edges** — `run.start` params, `StartRunRequestSchema`, and the CLI `parseStartArgs` accept `branch`. `RunListEntry`, `RunSummary`, `RunDetail` and their renderers surface `worktreePath`/`branch`.

Data flow (isolated run):

```
CLI `start --branch b`  ┐
web StartRunForm / POST /runs ┘→ run.start{workflowPath,cwd,branch}
  → run-start handler → RunManager.startRun(workflowPath, cwd, branch)
      → GitWorktrees.resolveRepoRoot(cwd)            (else NOT_A_GIT_REPO)
      → existing = GitWorktrees.findWorktreeForBranch(repoRoot, branch)
        ├─ existing → worktreePath = existing        (REUSE, no creation)  [ADR-005]
        └─ none → worktreePath = sibling(repoRoot, branch)
                → createBranch = !branchExists(repoRoot, branch)
                → GitWorktrees.addWorktree(...)       (else WORKTREE_CONFLICT)
      → Run.create({cwd, worktreePath, branch})
      → new Runner(..., { cwd: worktreePath ?? cwd })
  → snapshot persisted with worktreePath/branch
  → ps / run detail render branch + worktreePath
```

## Implementation Design

### Core Interfaces

The adapter is the primary new dependency other components rely on:

```ts
// src/infra/git/git-worktrees.ts
export interface GitWorktrees {
  /** Absolute path of the repo root containing `dir`, or null if `dir` is not in a git repo. */
  resolveRepoRoot(dir: string): Promise<string | null>;
  /** Path of the worktree already checked out on `branch`, or null if none (ADR-005). */
  findWorktreeForBranch(repoRoot: string, branch: string): Promise<string | null>;
  /** True if a local branch named `branch` already exists. */
  branchExists(repoRoot: string, branch: string): Promise<boolean>;
  /**
   * Create a worktree at `worktreePath` on `branch`. When `createBranch` is true the
   * branch is created off the current HEAD; otherwise the existing branch is checked out.
   * Throws GitWorktreeError("BRANCH_IN_USE" | "PATH_EXISTS") on conflict.
   */
  addWorktree(args: {
    repoRoot: string;
    worktreePath: string;
    branch: string;
    createBranch: boolean;
  }): Promise<void>;
}

export class GitWorktreeError extends Error {
  constructor(readonly code: "BRANCH_IN_USE" | "PATH_EXISTS", message: string) {
    super(message);
  }
}
```

`RunManager.startRun` extends its signature (option injected like `createMcpServer`):

```ts
startRun(workflowPath: string, cwd: string, branch?: string):
  Promise<{ runId: RunId; slug: RunSlug }>;
// RunManagerOptions gains: gitWorktrees?: GitWorktrees (defaults to the real adapter)
```

### Data Models

`RunSnapshot` (and `Run`) gain two optional fields; `snapshot()` emits them only when set, matching the existing conditional `cwd`/`endReason` handling:

```ts
export interface RunSnapshot {
  // ...existing fields...
  cwd?: string;          // repo root the user selected (unchanged meaning)
  worktreePath?: string; // present only for isolated runs
  branch?: string;       // present only for isolated runs
}
```

`Run.create` accepts `{ ..., worktreePath?, branch? }`. The effective working directory is `worktreePath ?? cwd`; `RunManager` passes that to `new Runner(...)`. Retry (`Run.fromSnapshot` in `retryStep`) carries both fields forward unchanged.

Worktree path: `join(dirname(repoRoot), `${basename(repoRoot)}-${sanitize(branch)}`)`, where `sanitize` replaces `/`, whitespace, and filesystem-unsafe characters with `-` (ADR-003).

### API Endpoints

| Method | Path | Change |
|--------|------|--------|
| POST | `/runs` | `StartRunRequestSchema` gains optional `branch: string` (min length 1 when present). Behavior unchanged when omitted. |
| GET | `/runs` | `RunSummary` gains optional `worktreePath`, `branch`. |
| GET | `/runs/:id` | `RunDetail` gains optional `worktreePath`, `branch`. |

RPC `run.start` params become `{ workflowPath; cwd; branch? }`. New RPC error codes: `NOT_A_GIT_REPO` (cwd not in a git repo) and `WORKTREE_CONFLICT` (the computed new path is occupied by a non-worktree directory), mapped in the run-start handler and the HTTP `error-map`. An existing worktree for the branch is **not** an error — it is reused (ADR-005). CLI: `start <workflow.json> [--branch <name>] [--detach|-d]`; supplying `--branch` requests isolation.

## Integration Points

- **git (via simple-git)** — the only external system. Requires the git binary installed (already a project E2E prerequisite). No auth. Failures (non-repo, branch-in-use, path-exists) are normalized by the adapter and mapped to stable error codes; no retries.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/infra/git/git-worktrees.ts` | new | simple-git adapter + `GitWorktreeError`. Low risk; isolated. | Implement adapter + fake. |
| `src/domain/run.ts` | modified | Add `worktreePath`/`branch` to snapshot + `Run`. Low risk; additive optional fields. | Thread through create/snapshot/fromSnapshot. |
| `src/infra/daemon/run-manager.ts` | modified | `startRun` reuses or provisions worktree, uses `worktreePath ?? cwd`. Medium risk; central path. | Add branch param + git orchestration (reuse-or-create) + error mapping. |
| `src/infra/daemon/protocol.ts` | modified | `run.start` params + `RunListEntry` fields + 2 error codes. Low risk. | Extend types/codes. |
| `src/infra/daemon/handlers/run-start.ts`, `run-ps.ts` | modified | Pass `branch`; map new errors; emit fields. Low risk. | Update handlers. |
| `src/app/api/schema.ts`, `routes/start-run.ts`, `routes/runs.ts`, `routes/run-detail.ts`, `error-map.ts` | modified | Optional `branch` in/`worktreePath`+`branch` out; map errors to 400. Low risk. | Extend zod + mappers. |
| `src/app/cli.ts`, `commands/start.ts` | modified | Parse `--branch`; forward in `run.start`. Low risk. | Add flag + USAGE. |
| CLI `ps`/run output formatter (`src/infra/client/`) | modified | Render branch/worktree for isolated runs. Low risk. | Add display. |
| `web/src/features/start-run/StartRunForm.tsx` + run detail view + `web/src/lib/api/types` | modified | Optional branch input; show worktree/branch. Low risk. | Add field + display. |
| `package.json` | modified | Add `simple-git`. Low risk. | Add dependency. |

## Testing Approach

### Unit Tests

- **`GitWorktrees` adapter** — against real temporary git repos (init, commit): `resolveRepoRoot` for repo/subdir/non-repo; `findWorktreeForBranch` returns the path for an already-checked-out branch and null otherwise; `branchExists` true/false; `addWorktree` create-new vs checkout-existing; `("PATH_EXISTS")` when a non-worktree dir occupies the target.
- **`RunManager.startRun`** — with a **fake `GitWorktrees`**: non-isolated path unchanged (no git calls); new-worktree path computes the sibling path, calls `addWorktree` with correct `createBranch`, sets `worktreePath`/`branch`, constructs the runner with the worktree path; **reuse path** — when `findWorktreeForBranch` returns a path, `addWorktree` is *not* called and the run uses the existing path; non-repo → `NOT_A_GIT_REPO`; `PATH_EXISTS` from the adapter → `WORKTREE_CONFLICT`.
- **`Run`** — snapshot round-trip preserves/omits `worktreePath`/`branch`; retry carries them forward.
- **Schema/protocol** — `StartRunRequestSchema` accepts/omits `branch`; `RunSummary`/`RunDetail` carry the new fields; openapi-completeness still passes.

### Integration Tests

- Extend the daemon harness: start an isolated run against a real temp git repo, assert the worktree directory exists on the branch and the agent ran there; assert `GET /runs/:id` reports `worktreePath`/`branch`.
- **Concurrency**: two isolated runs on **distinct** branches over the same repo both complete with no lost edits (mirrors `concurrent-runs.test.ts`).
- **Reuse**: a second isolated run on a branch that already has a worktree runs inside the **same** existing worktree path (no error), confirming the extend-work flow (ADR-005).

## Development Sequencing

### Build Order

1. **`GitWorktrees` adapter + `GitWorktreeError` + fake** — no dependencies. Add `simple-git`. Unit-test against temp repos.
2. **`Run`/`RunSnapshot` fields** — no dependencies on step 1. Add `worktreePath`/`branch`, update create/snapshot/fromSnapshot + tests.
3. **`RunManager.startRun` orchestration** — depends on steps 1 and 2. Add `branch` param, inject adapter via `RunManagerOptions`, reuse-or-create the worktree (`findWorktreeForBranch` first), run in `worktreePath ?? cwd`, map errors.
4. **RPC protocol + run-start/run-ps handlers** — depends on step 3. Add `branch` to params, new error codes, emit fields.
5. **HTTP schema + routes + error-map** — depends on step 4. Optional `branch` in; `worktreePath`/`branch` out; map new errors to 400.
6. **CLI `--branch`** — depends on step 4 (RPC). Parse flag, forward in `run.start`, render in `ps`/output.
7. **Web start form + run detail** — depends on step 5 (HTTP). Optional branch input; display worktree/branch.
8. **Integration tests** — depends on steps 3–7. Isolated-run lifecycle + concurrency cases.

### Technical Dependencies

- `simple-git` added to `package.json` (step 1).
- git binary available in dev/test environments (already an E2E prerequisite).

## Monitoring and Observability

- Reuse the existing daemon logger and event log. On isolated start, log a structured event with `runId`, `branch`, `worktreePath`, and whether the worktree was `reused`, `created` (existing branch), or `created` with a new branch. Surface `NOT_A_GIT_REPO` / `WORKTREE_CONFLICT` failures through the existing error-response path (no new alerting infrastructure).

## Technical Considerations

### Key Decisions

- **Decision:** git operations via `simple-git` behind an injectable `GitWorktrees` adapter. **Rationale:** typed ergonomics + testability via the existing DI pattern. **Trade-off:** a new dependency on the git binary. **Alternatives rejected:** direct CLI shell-out (parsing burden), isomorphic-git (no worktree support), direct simple-git in RunManager (untestable). (ADR-002)
- **Decision:** worktrees placed adjacent to the repo root. **Rationale:** discoverable, no in-repo nesting. **Trade-off:** parent-dir clutter, branch-name sanitization collisions. **Alternatives rejected:** daemon-managed dir, in-repo gitignored dir. (ADR-003)
- **Decision:** model isolation as `worktreePath` + `branch` on the snapshot; run in `worktreePath ?? cwd`. **Rationale:** keeps non-isolated path unchanged, retains repo root. **Trade-off:** two fields threaded through every mirrored schema. **Alternatives rejected:** overwrite `cwd`, single nested object. (ADR-004)

### Known Risks

- **Provisioning failure after slot reservation** leaves a persisted snapshot but no usable run. *Likelihood:* low. *Mitigation:* perform pure validation (`resolveRepoRoot`, `branchExists`) before reserving the slot; run `addWorktree` last before constructing the runner so it is the only late failure, handled by the existing registry-cleanup catch.
- **Worktree path collision** with a non-worktree directory. *Mitigation:* `addWorktree` fails on existing path → `WORKTREE_CONFLICT`; never overwrite.
- **Concurrent isolated runs on the same branch share one worktree** and can clobber each other (ADR-005 reuse). *Likelihood:* user-driven. *Mitigation:* reuse is intentional for extending work; surface the resolved `worktreePath` so sharing is visible; document that concurrent *isolation* requires distinct branches.
- **simple-git under Bun** — verify worktree commands (including `worktree list --porcelain`) run correctly in the Bun runtime during step 1 (small prototyping risk).
- **Stale/diverged existing branch** is checked out as-is (PRD open question; assumed acceptable, no warning in MVP).

## Architecture Decision Records

- [ADR-001: Opt-in per-run git worktree isolation with a user-provided branch](adrs/adr-001.md) — Isolation is opt-in per run; branch checked out if it exists, else created off current state; worktree preserved on finish.
- [ADR-002: Git worktree operations via simple-git behind an injectable adapter](adrs/adr-002.md) — Wrap simple-git in a `GitWorktrees` adapter injected into `RunManager` for testability.
- [ADR-003: Place isolated worktrees adjacent to the repository](adrs/adr-003.md) — Worktree created as a sibling of the repo root, named from repo + sanitized branch.
- [ADR-004: Represent isolation as worktreePath + branch on the run snapshot](adrs/adr-004.md) — Keep `cwd` as repo root; add optional `worktreePath`/`branch`; run in `worktreePath ?? cwd`.
- [ADR-005: Reuse an existing worktree for a branch instead of erroring](adrs/adr-005.md) — If the branch already has a worktree, run inside it (extend work); only a non-worktree dir at the computed path is a conflict.
