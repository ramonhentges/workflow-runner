# Task Memory: task_16.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement `attach`, `send`, `doctor`, `daemon` commands under `src/app/commands/` with unit tests using the shared `MockDaemonClient`. Completed.

## Important Decisions

- `daemon.ts` dep is typed `() => Promise<number | void>`; void → 0. Lets tests assert numeric propagation while wrapping the real `runDaemon` (which returns void).
- `doctor.ts` treats only `"fail"` as exit 1; `"warn"` returns 0 (V1 policy per task spec).
- `attach.ts` early-return paths (zero/many active runs) had to call `client.close()` via a single outer `finally` — initial version leaked the connection. Refactored to nest the attach-loop try/catch inside the outer try/finally so every exit path closes the mock.

## Learnings

- `MockDaemonClient` throws a plain `Error("no responder for ...")` when a method has no responder, not a `DaemonRpcError`. Tests that exercise indirect calls (e.g., `attachFn` forwarding to `client.call("run.attach", ...)`) must register a `run.attach` responder.

## Files / Surfaces

- New: `src/app/commands/doctor.ts`, `daemon.ts`, plus tests `attach.test.ts`, `send.test.ts`, `doctor.test.ts`, `daemon.test.ts`.
- Modified: `src/app/commands/attach.ts` — moved early-return cleanup under the outer `finally` so `client.close()` always runs.

## Errors / Corrections

- First attach test run failed because (a) explicit-runId test needed a `run.attach` responder on the mock, and (b) zero/many-runs paths returned without closing the client. Both fixed.

## Ready for Next Run

Task 17 (CLI subcommand dispatcher) now has all eight `commands/*.ts` `run(argv, deps?)` entry points available: `start`, `attach`, `ps`, `send`, `retry-step`, `stop`, `doctor`, `daemon`. `daemon` is the only one whose `run` does not require `client.connect()`.
