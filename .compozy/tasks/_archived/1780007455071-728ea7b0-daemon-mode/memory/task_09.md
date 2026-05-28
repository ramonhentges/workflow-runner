# Task Memory: task_09.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented four lifecycle JSON-RPC handlers plus shared prefix-resolution helper. All complete and verified.

## Important Decisions

- Added `RpcError` class to `src/infra/daemon/rpc/server.ts` and updated the server's catch block to recognize it. Handlers throw `RpcError` (not generic `Error`) to send specific JSON-RPC error codes; the server sends `-32603` for everything else.
- Added optional `data?: unknown` field to `RunManagerError` and updated `RunManager.get()` to pass `{ candidates: RunId[] }` in the `AMBIGUOUS_PREFIX` throw so `_resolve-run.ts` can forward the candidates into the RPC error envelope.
- `run-start.ts` maps any non-`RunManagerError` exception from `startRun` to `WORKFLOW_INVALID` (covers `Workflow.load` failures).
- `run-retry-step.ts` snapshots `currentStepId` before calling `retryStep`, since `retryStep` throws if it's null — so post-call assertion with `!` is safe.
- `run-ps.ts` calls `rm.get(snap.id)` with the full 8-char id to get `subscribers.size`; exact-id lookup never produces ambiguity.

## Learnings

- Bun's `expect(nullable).toBe(value)` has type overloads that conflict on `T | null` types; use an array accumulator or non-nullable type for call-tracking in tests.

## Files / Surfaces

- `src/infra/daemon/run-manager.ts` — `RunManagerError` constructor extended with optional `data`; AMBIGUOUS_PREFIX throw updated to pass candidates.
- `src/infra/daemon/rpc/server.ts` — `RpcError` class added and exported; catch block updated.
- `src/infra/daemon/handlers/_resolve-run.ts` — new: shared prefix resolver.
- `src/infra/daemon/handlers/run-start.ts` — new.
- `src/infra/daemon/handlers/run-stop.ts` — new.
- `src/infra/daemon/handlers/run-retry-step.ts` — new.
- `src/infra/daemon/handlers/run-ps.ts` — new.
- `src/infra/daemon/handlers/handlers.test.ts` — new: 15 unit tests covering all spec scenarios.

## Errors / Corrections

None.

## Ready for Next Run

Task complete. All 188 tests pass, typecheck clean. Handlers are ready to be registered in `daemon.ts` (task_11).
