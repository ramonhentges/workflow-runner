---
provider: manual
pr:
round: 2
round_created_at: 2026-06-11T18:25:47Z
status: resolved
file: src/infra/daemon/__tests__/integration/isolated-runs.test.ts
line: 85
severity: low
author: claude-code
provider_ref:
---

# Issue 003: concurrency test asserts separate paths, not the no-clobber metric

## Review Comment

The feature's headline success metric (PRD *Success Metrics — Correctness*) is:

> 100% of concurrent isolated runs over a shared repo complete without one run's
> file changes being overwritten by another.

and the TechSpec *Integration Tests* calls for:

> two isolated runs on **distinct** branches over the same repo both complete
> with **no lost edits**.

The integration test `two isolated runs on distinct branches both complete in
separate worktrees` (isolated-runs.test.ts:85) verifies the structural
*precondition* — two distinct worktree directories exist on their respective
branches — but the workflows it runs are `fake:complete` stubs that perform no
file edits. The test therefore never exercises the actual no-clobber claim: it
asserts that the isolation *mechanism* (separate directories sharing one
`.git`) is in place, not that overlapping edits in two concurrent runs both
survive.

This is a testing gap, not a code defect — the structural guarantee is sound and
is the mechanism by which no-clobber holds. But the central correctness metric
is asserted only by proxy.

Suggested fix: have each concurrent run write to the *same relative path* in its
own worktree (e.g. a fake workflow step that writes a distinct marker to
`shared.txt`), then after both complete assert each worktree's `shared.txt`
holds that run's marker — proving neither run overwrote the other. This upgrades
the proxy assertion to a direct test of the success metric without needing real
IDE subprocesses.

## Triage

- Decision: `VALID`
- Root cause: The concurrency test (`isolated-runs.test.ts:85`) ran `fake:complete`
  stubs that perform no file edits, so it asserted only the structural
  precondition (two distinct worktree directories on their respective branches)
  and never exercised the PRD's headline no-clobber correctness metric. The
  central claim — that overlapping edits in two concurrent isolated runs over a
  shared repo both survive — was verified only by proxy (distinct paths).
- Fix approach: Make the two concurrent runs actually write to the *same relative
  path* (`shared.txt`) in their own worktrees, then assert each worktree's
  `shared.txt` holds that run's distinct marker. This proves neither run
  overwrote the other directly, upgrading the proxy assertion to a direct test of
  the success metric — without real IDE subprocesses.
  - The fixture session factory had no way for a fake step to perform a file
    edit, so I added a minimal `fake:write <relPath> <content>` marker to the
    test-only `test-helpers/fixture-session-factory.ts`. This file is outside the
    batch's scoped code-file list, but the change is the minimum required to let
    a fake run exercise a real file edit (the factory is the only mechanism by
    which a `fake:*` step can act on its worktree). It is a test helper, adds no
    production surface, and is exercised only when `WORKFLOW_RUNNER_FAKE_FACTORY=1`.
- Verification: `bun test src/infra/daemon/__tests__/integration/isolated-runs.test.ts`
  and the marker parser unit tests pass; `bun run typecheck` clean. See the
  Verification section appended below.
- Notes:

## Resolution

Changes:

- `src/infra/daemon/test-helpers/fixture-session-factory.ts` — added a
  `fake:write <relPath> <content>` marker. When a fake step carries this marker
  the session writes `content` to `<cwd>/<relPath>` (creating parent dirs) and
  resolves with a `finish` outcome. Because an isolated run's `cwd` is its
  worktree path (`run-manager.ts:295`), the edit lands inside that run's worktree.
- `src/infra/daemon/__tests__/integration/isolated-runs.test.ts` — rewrote the
  concurrency test as `two concurrent isolated runs writing the same path keep
  each other's edits`. Both runs now write a distinct marker (`marker-a` /
  `marker-b`) to the *same relative path* `shared.txt`, then the test asserts
  each worktree's `shared.txt` still holds that run's own marker — a direct test
  of the no-clobber metric, not just distinct paths.
- `src/infra/daemon/test-helpers/fixture-session-factory.test.ts` — added unit
  coverage for parsing `fake:write` (including space-containing content and the
  empty-content default) and for the session performing the file write before
  finishing.

## Verification

```
VERIFICATION REPORT
-------------------
Claim: No-clobber concurrency is directly tested; no regressions
Command: bun run typecheck && bun test
Executed: just now, after all changes
Exit code: 0
Output summary: typecheck (tsc --noEmit) clean; bun test → 1127 pass, 1 skip, 0 fail (67 files)
Warnings: none
Errors: none
Verdict: PASS
```
