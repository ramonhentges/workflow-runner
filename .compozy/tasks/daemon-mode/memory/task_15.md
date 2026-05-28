# Task Memory: task_15.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement four lifecycle CLI subcommands (`start`, `stop`, `retry-step`, `ps`), the shared `_tui-source.ts` adapter, and a reusable mock DaemonClient. All in `src/app/commands/` plus `src/infra/client/__tests__/mock-client.ts`.

## Important Decisions

- Each `run(argv, deps?)` takes optional deps so tests inject `connect`, `stdout`, `stderr`, `isTty`, and (for `start`) `attach`. Production callers omit `deps`.
- Split the start.ts attach loop into `_attach-loop.ts` (depends on `@opentui/core`, intentionally out of unit-test coverage) and `_status-watcher.ts` (pure subscription logic, fully unit-tested via `watchExitCode`).
- Retry banner literal output is `↻ retrying ${resumedStepId} — LLM output may differ from the previous attempt` (no extra `step-` prefix), matching the daemon's own banner in `run-manager.ts:242` (where `failedStepId` already includes the `step-` prefix). Task spec's `step-{resumedStepId}` is template notation, not a literal prefix.
- Error mapping lives in `_errors.ts` so all commands share `UNKNOWN_RUN`, `AMBIGUOUS_PREFIX`, `RUN_NOT_RETRY_ELIGIBLE`, `RUN_NOT_INTERACTIVE`, `DAEMON_SHUTTING_DOWN` formatting. `start` additionally maps `WORKFLOW_INVALID` and `RUN_LIMIT_REACHED` inline.

## Learnings

- `MockDaemonClient` is structurally compatible with `DaemonClient` only via `as unknown as DaemonClient` (the real class uses `#private` fields). Expose this via an `asClient()` helper to keep test sites tidy.
- Tasks 16 (`attach`) and 18 (dispatcher refactor) can reuse `_status-watcher.ts`, `_tui-source.ts`, `_attach-loop.ts`, and `_errors.ts` directly. The mock client is in `src/infra/client/__tests__/mock-client.ts` and is import-safe from any test under `src/`.

## Files / Surfaces

- `src/app/commands/start.ts`, `stop.ts`, `retry-step.ts`, `ps.ts` — entry-point commands.
- `src/app/commands/_tui-source.ts` — wraps DaemonClient as a `TuiEventSource`.
- `src/app/commands/_status-watcher.ts` — exports `watchExitCode`.
- `src/app/commands/_attach-loop.ts` — default attach loop (uses Tui).
- `src/app/commands/_errors.ts` — `mapDaemonError`.
- `src/infra/client/__tests__/mock-client.ts` — reusable mock client.
- Tests: `*.test.ts` siblings for each command plus `_tui-source.test.ts`. 26 tests passing locally; coverage ≥91% on every new file except `_attach-loop.ts` (deferred to task 19 integration).

## Errors / Corrections

- Initial retry banner used a redundant `step-` prefix concatenated with `resumedStepId` (which already contains `step-`), producing `step-step-1`. Corrected to match the daemon's banner format.

## Ready for Next Run

Task 16 (`attach`) can import `_attach-loop.ts` directly and only needs to add its own argv parsing + `run.attach` invocation. Task 17 (dispatcher) can `import * as start from "./commands/start.js"` etc. and call `run()` with `argv.slice(N)`. No follow-ups blocked.
