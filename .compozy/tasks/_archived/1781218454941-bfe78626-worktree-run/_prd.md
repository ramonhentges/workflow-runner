# PRD: Worktree Run — Isolated Working Directories for Concurrent Runs

## Overview

Workflow Runner can already execute many runs at once (up to 16 concurrently), but every run shares a single working directory rooted at the user's chosen `cwd`. When two or more runs target the same repository, their agents edit the same files in the same tree. One agent reads a file, another rewrites it, and the first agent's changes are silently overwritten — neither the user nor the agents are warned.

**Worktree Run** lets a user start a run in *isolation*: the run executes inside its own git worktree, on its own branch, while sharing the repository's `.git` object store. Concurrent isolated runs never touch each other's files, and they never touch the user's active working tree.

- **Problem it solves:** file-level collisions between concurrent runs against the same repository.
- **Who it is for:** users who run multiple workflows in parallel on one codebase — the same audience already relying on the daemon's concurrency.
- **Why it is valuable:** it makes the existing parallelism actually safe to use on a shared repo, which is the dominant pattern for orchestrating multiple AI coding agents.

Isolation is **opt-in per run**: the default behavior (run in the chosen `cwd`) is unchanged.

## Goals

- A run can be started in an isolated git worktree on a user-named branch.
- Concurrent isolated runs against the same repository produce zero file-level collisions.
- The default, non-isolated path behaves exactly as it does today (backward compatible).
- The isolated worktree's path and branch are visible everywhere the run is shown.
- The agent's work is always preserved when a run ends.

**Success metric:** two or more isolated runs editing overlapping files in the same repository complete without any run's changes being overwritten by another.

## User Stories

**Primary persona — the parallel operator** (runs several workflows on one codebase):

- As a parallel operator, I want to start a run in its own worktree so that it cannot clobber the files of another run I have going.
- As a parallel operator, I want to name the branch a run works on so that I can find and reason about its output later.
- As a parallel operator, I want an isolated run to continue work on an existing branch when I name one that already exists, so that I can resume or build on prior work.
- As a parallel operator, I want to see each isolated run's worktree path and branch in the run listing so that I can `cd` into it or open it in my editor.
- As a parallel operator, I want a finished run's worktree left intact so that I can inspect, diff, commit, or merge its changes with my own git tooling.

**Secondary persona — the cautious single-run user:**

- As a cautious user, I want to run a workflow without it touching my current working tree, so that my checkout and branch stay exactly as I left them.

**Edge cases:**

- As a user, I want a clear error when I ask for isolation but my directory is not a git repository, so that I am not silently given a non-isolated run.
- As a user, I want a run on a branch that already has a worktree to continue inside that worktree, so that I can extend work already in progress rather than being blocked.

## Core Features

### 1. Opt-in isolated run (must-have)

Starting a run can request isolation. An isolated run executes in a dedicated git worktree instead of the user's working directory.

- Available from both entry points: the CLI `start` command and the web UI start flow.
- Requires a branch name supplied by the user.
- Non-isolated runs remain the default and are unchanged.

### 2. User-named branch with existing-or-create semantics (must-have)

The user supplies a branch name for the isolated run.

- If the branch **already has a worktree**, the run reuses that worktree to extend in-progress work.
- If the branch **exists** but has no worktree, a worktree is created and checks it out.
- If the branch **does not exist**, it is created off the current repository state.
- This lets a run start fresh, check out an existing branch, or continue work already underway — the user's choice via the name they provide.

### 3. Worktree path and branch visibility (must-have)

Wherever a run appears, an isolated run also shows its worktree filesystem path and its branch.

- CLI: run listing (`ps`) and attach surfaces.
- Web: run details.
- The user uses this to locate the work; the tool does not open editors or manage the directory beyond display.

### 4. Preserve-on-finish (must-have)

When an isolated run ends — completed, failed, crashed, or aborted — its worktree and branch are left intact. The tool never deletes the agent's work.

### 5. Clear failure on invalid isolation request (must-have)

Isolation requests that cannot be honored fail at start with a precise message, before the run begins, rather than degrading silently:

- The directory is not inside a git repository.
- The worktree path the run would create is already occupied by a directory that is not a worktree for that branch.

A branch that already has a worktree is **not** a failure — the run reuses it (Core Feature #2).

## User Experience

**Starting an isolated run (CLI):** the user invokes `start` with the isolation option and a branch name. If valid, the run begins in a new or reused worktree on that branch; the response identifies the run as usual. If invalid (no git repo, or the computed worktree path is occupied by a non-worktree directory), the command fails with a clear message and starts nothing.

**Starting an isolated run (web):** the start flow offers an isolation choice and a branch-name field. The same validation and errors apply, surfaced inline.

**Observing a run:** in `ps`/attach and in the web run details, an isolated run displays its branch and worktree path alongside its normal status. A non-isolated run shows nothing extra.

**After a run ends:** the worktree remains on disk on its branch. The user opens it, diffs it, and commits or merges with their own git workflow. Cleanup is the user's responsibility.

**Onboarding/discoverability:** isolation is a visible option on the start surfaces; the displayed path teaches users where isolated work lives. No new concepts beyond "this run has its own worktree and branch."

## High-Level Technical Constraints

- **Required integration:** the host environment must provide git; isolation depends on git worktree support. A directory outside a git repository cannot be isolated.
- **Concurrency constraint (user-visible):** a branch maps to a single worktree, so two concurrent isolated runs naming the same branch share that worktree and are no longer isolated from each other. To keep concurrent runs isolated, the user must give them distinct branch names.
- **Backward compatibility:** the non-isolated run path must remain the default and behave identically to today.
- **Data safety:** agent work in an isolated worktree is never auto-deleted by the tool.

## Non-Goals (Out of Scope)

- **Automatic worktree cleanup / removal commands.** The tool will not delete or prune worktrees; the user manages this with git. (Deferred — see Phase 2.)
- **Merging or PR creation.** The tool will not merge an isolated run's branch to a base branch or open a pull request. (Deferred — see Phase 3.)
- **Always-on isolation.** Isolation is never forced; it is always opt-in.
- **Auto-generated branch names.** The branch name is always user-provided in this effort.
- **Non-git isolation** (containers, copied directories, database/port isolation). Out of scope; only git worktrees.
- **Cross-run coordination/merge sequencing.** No supervisor logic to order or reconcile multiple runs' branches.

## Phased Rollout Plan

### MVP (Phase 1)

- Opt-in isolated run from CLI and web, with a user-provided branch name.
- Existing-branch checkout or create-off-current-state semantics.
- Worktree path and branch surfaced in run listing/details.
- Preserve worktree on finish.
- Clear failure on non-git directories and already-checked-out branches.

**Success criteria to proceed:** concurrent isolated runs editing overlapping files in one repository complete with no lost changes; non-isolated runs are unaffected.

### Phase 2 (deferred)

- Tool-assisted worktree lifecycle: list a run's worktree state, remove a finished run's worktree+branch on request.

**Success criteria to proceed:** users report worktree accumulation as a real friction point worth tooling.

### Phase 3 (deferred)

- Merge/review flow: merge an isolated run's branch to a base branch or open a PR as part of finishing.

**Long-term success criteria:** isolated runs become a reviewable, mergeable unit of work end-to-end.

## Success Metrics

- **Correctness:** 100% of concurrent isolated runs over a shared repo complete without one run's file changes being overwritten by another.
- **Backward compatibility:** non-isolated runs show no behavioral change.
- **Discoverability:** for every isolated run, the worktree path and branch are present in the run's CLI and web representations.
- **Safe failure:** every invalid isolation request (non-git dir, or an occupied non-worktree path) is rejected at start with a specific message and leaves no partial state.
- **Adoption:** users start running parallel workflows against the same repo with isolation rather than serializing them.

## Risks and Mitigations

- **Adoption risk — users don't discover isolation.** Mitigation: present it as a clear option on both start surfaces and show the resulting path so the value is visible.
- **Usability risk — unintended worktree sharing** when two concurrent isolated runs name the same branch and silently share a directory. Mitigation: surface the resolved worktree path so reuse is visible; document that concurrent isolated runs need distinct branches.
- **Data risk — accumulated/abandoned worktrees** consume disk and clutter the repo since cleanup is manual. Mitigation: surface the path so users can find and prune them; revisit automated cleanup in Phase 2.
- **Dependency risk — git availability/version.** Mitigation: detect a non-git directory and fail clearly; treat git as a stated prerequisite.

## Architecture Decision Records

- [ADR-001: Opt-in per-run git worktree isolation with a user-provided branch](adrs/adr-001.md) — Isolation is opt-in per run; the user names a branch that is checked out if it exists or created off current state; the worktree is preserved on finish; no cleanup or merge in this effort.
- [ADR-005: Reuse an existing worktree for a branch instead of erroring](adrs/adr-005.md) — A branch that already has a worktree is reused so the run extends in-progress work, rather than being rejected (refines Core Feature #2 and #5).

## Open Questions

- When the user names a branch that already exists but is **stale or diverged** from the current state, should the tool warn, or silently check it out as-is? (Assumed: check out as-is.)
- Should the worktree be created at a tool-managed location, or adjacent to the repository? This is a UX/discoverability question (where users will look) and may need a default surfaced to users; implementation detail otherwise deferred to TechSpec.
- For a non-isolated run started while an isolated run holds a branch, are there any interactions to warn about? (Assumed: none — non-isolated runs are unchanged.)
