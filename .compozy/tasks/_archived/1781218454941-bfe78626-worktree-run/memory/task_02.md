# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Added optional `worktreePath?`/`branch?` to `RunSnapshot` + `Run`, round-tripped through `create`/`snapshot`/`fromSnapshot` (ADR-004). Storage-only; effective cwd `worktreePath ?? cwd` is computed downstream in task_03.

## Important Decisions

- Production change confined to `src/domain/run.ts` per task Implementation Details. Did NOT touch `run-store.ts` validator — `parseMetaJson` spreads all non-`schemaVersion` keys through, so the new optional fields persist without validator changes. Integration test is test-only (`run-store.test.ts`).
- `snapshot()` emits the fields only when defined, mirroring the existing `cwd`/`endReason` pattern, so non-isolated snapshots keep their exact shape (no `undefined` keys).

## Learnings

- Run snapshot validator in `run-store.ts` (`validateSnapshotShape`) does not reject unknown/extra fields, so additive optional snapshot fields persist round-trip with no store change. If task_04 wants strict validation of the new fields, it must add explicit checks there.

## Files / Surfaces

- `src/domain/run.ts` — `RunSnapshot` interface, `#worktreePath`/`#branch` fields, `create`, `snapshot`, ctor (fromSnapshot).
- `src/domain/run.test.ts` — 4 new unit tests (emit/omit/round-trip preserve/round-trip absent).
- `src/infra/daemon/run-store.test.ts` — 1 integration test (persist+load retains both fields).

## Errors / Corrections

None.

## Ready for Next Run

- task_03 (`RunManager.startRun`) sets these via `Run.create({ cwd, worktreePath, branch })` and constructs the runner with `worktreePath ?? cwd`. Both fields verified to survive snapshot persistence + reload.
