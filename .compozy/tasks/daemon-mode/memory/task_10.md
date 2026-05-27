# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement four JSON-RPC handlers (`run.attach`, `run.send`, `daemon.doctor`, `daemon.shutdown`), the reusable `mock-context.ts` test helper, and the `read-lockfile.ts` helper.

## Important Decisions

- **`RunSubscriber.onStatusChanged` is optional.** Added so `run.attach` can fan out `event.run.statusChanged` notifications without polling. RunManager invokes it at every status transition (in `#launchRunner`, `stop`, and `retryStep`). Promoted to shared memory.
- **`RunManager.sendInput` now returns `Promise<number>` (acceptedSeq).** It appends a `{type:"log", message: "→ <message>"}` entry to the event log, fans it out to live subscribers, then calls `runner.provideInput`. Promoted to shared memory.
- **`run.attach` defers backlog + buffered-live notifications through `Promise.resolve().then(...)`.** This guarantees the RPC server's serialized writeChain enqueues the result reply (from `sendResult`) before any notification — matching the spec's "synchronously reply with the result, then emit backlog" wire order.
- **`run.attach` registers the subscriber synchronously and buffers events until the backlog drain completes.** Avoids the race window where an event emitted between subscriber registration and backlog snapshot would otherwise reorder ahead of replayed entries.
- **`daemon.doctor` factory takes injectable deps** (`countActiveSubprocesses`, `countOrphanPorts`, `readLockfile`, `diskUsage`). Real implementations get wired in task_11 (`daemon.ts`); tests inject deterministic stubs.
- **WARN thresholds are constants in `daemon-doctor.ts`**: `SUBPROCESS_WARN_THRESHOLD = 8`, `DISK_WARN_THRESHOLD_BYTES = 1 GiB`.

## Learnings

- The RPC server's `writeChain` enqueues all writes (results + notifications) in FIFO call order. To emit notifications **after** a handler's result reply, the handler must defer the `ctx.notify` calls until after the handler's `Promise` resolves — `Promise.resolve().then(...)` works because the dispatch continuation runs `sendResult` synchronously before any microtask scheduled from the handler body fires.
- `readdir(dir, { withFileTypes: true, encoding: "utf8" })` is required to get `Dirent<string>` — without an explicit encoding, TS 5.9 infers `Dirent<NonSharedBuffer>` and `join()` rejects it.

## Files / Surfaces

- `src/infra/daemon/handlers/run-attach.ts` (new)
- `src/infra/daemon/handlers/run-send.ts` (new)
- `src/infra/daemon/handlers/daemon-doctor.ts` (new)
- `src/infra/daemon/handlers/daemon-shutdown.ts` (new)
- `src/infra/daemon/read-lockfile.ts` (new helper)
- `src/infra/daemon/rpc/__tests__/mock-context.ts` (new reusable test helper)
- `src/infra/daemon/run-manager.ts` (modified): `RunSubscriber.onStatusChanged?`, `sendInput` now returns `Promise<number>`, status fan-out in `#launchRunner`/`stop`/`retryStep`.
- Tests added to `src/infra/daemon/handlers/handlers.test.ts` and a new `src/infra/daemon/read-lockfile.test.ts`. Updated existing `sendInput` test in `run-manager.test.ts` to also cover acceptedSeq + log persistence.

## Errors / Corrections

- Initial `daemon-doctor.ts` typed `entries: Awaited<ReturnType<typeof readdir>>` which collided with TS's union of overloads; fixed by removing the annotation and passing `encoding: "utf8"` to `readdir`.

## Ready for Next Run

Task 11 (`daemon.ts`) will register these four factories alongside the existing four. It owns the lockfile and the real `countActiveSubprocesses`/`countOrphanPorts` dependencies, which `createDaemonDoctorHandler` consumes through its injected `DaemonDoctorDeps`.
