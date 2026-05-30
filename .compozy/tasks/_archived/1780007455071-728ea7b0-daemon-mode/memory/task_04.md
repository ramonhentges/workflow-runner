# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Implemented `RunStore` persistence/discovery for `meta.json` under `$XDG_STATE_HOME/workflow-runner/runs/<run-id>/`, including atomic tmp/fsync/rename writes, schema validation, list skipping, and restart orphan marking.

## Important Decisions
- `RunStore` accepts optional `storageRoot` and `logger` for isolated tests and daemon wiring; production default resolves from `XDG_STATE_HOME` with the home fallback.
- `discoverAndMarkOrphans()` removes stray `meta.json.tmp` files for every valid discovered run and marks only `running` snapshots as `crashed` with `endReason: "daemon restart"`.

## Learnings
- `bun --eval` child processes expose the first user argument at `process.argv[1]`, not `process.argv[2]`; the partial-write crash test relies on that behavior.
- `RunStore` coverage is 100% lines/functions via `bun test --coverage src/infra/daemon/run-store.test.ts`.

## Files / Surfaces
- Added `src/infra/daemon/run-store.ts`.
- Added `src/infra/daemon/run-store.test.ts`.

## Errors / Corrections
- Fixed a TypeScript assertion signature issue by validating from `unknown` rather than asserting `MetaJson` from `Record<string, unknown>`.
- Corrected the child-process crash simulation argument indexing after the first focused test run failed to leave the expected tmp file.

## Ready for Next Run
- Run-store task is implemented and tracking can remain completed if final verification stays green.
