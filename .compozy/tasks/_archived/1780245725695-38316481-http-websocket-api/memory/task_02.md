# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Thread explicit `cwd` through run start: `RunManager.startRun(workflowPath, cwd)`, `run.start` JSON-RPC params, CLI client sends `process.cwd()`.

## Important Decisions

- `cwd` is a required (not optional) parameter on `RunManager.startRun` — matches ADR-002 and TechSpec decision.
- Integration tests use `h.storageRoot` as the `cwd` value (a real directory available in the test harness).
- Protocol type test updated: `satisfies` assertion now includes `cwd`.

## Learnings

- More test files touched than the task spec listed: `__tests__/integration/` tests (attach-detach, concurrent-runs, lifecycle, stop-semantics, restart-discovery) all call `run.start` over the mock client and required `cwd`.
- `protocol.test.ts` uses `satisfies` type assertions — required update alongside the interface change.
- `FakeSessionFactory.onCreate` callback captures `RunnerAgentSessionArgs` including `cwd`; ideal hook for asserting cwd propagation.

## Files / Surfaces

- `src/infra/daemon/run-manager.ts` — `startRun` signature + `new Runner(...)` opts
- `src/infra/daemon/protocol.ts` — `run.start` params type
- `src/infra/daemon/handlers/run-start.ts` — forwards `params.cwd`
- `src/app/commands/start.ts` — sends `process.cwd()` as `cwd`
- `src/infra/daemon/run-manager.test.ts` — all `startRun(wfPath)` → `startRun(wfPath, tmpDir)` + new cwd propagation test
- `src/infra/daemon/handlers/handlers.test.ts` — `run.start` handler tests updated + new forwarding test
- `src/app/commands/start.test.ts` — new test verifying `cwd` = `process.cwd()` in RPC params
- `src/infra/daemon/protocol.test.ts` — `satisfies` assertion updated
- `src/infra/daemon/__tests__/integration/{attach-detach,concurrent-runs,lifecycle,stop-semantics,restart-discovery}.test.ts` — `run.start` calls updated with `cwd: h.storageRoot`

## Errors / Corrections

No errors. Typecheck revealed 7 additional call sites in integration tests not listed in the task spec — all fixed.

## Ready for Next Run

Task complete. 493 pass / 0 fail. `src/app/api/` task 07 (`POST /runs`) can now consume `RunManager.startRun(workflowPath, cwd)` with the cwd coming from the HTTP request body.
