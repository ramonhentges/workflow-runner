# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Daemon entry wired in `src/infra/daemon/daemon.ts`. Exports `runDaemon`, `acquireLock`, `releaseLock`, `bindSocket`, `makeShutdown`, and `DaemonAlreadyRunningError`. Storage root resolves via `RunStore.resolveStorageRoot()` when not injected; socket and lockfile derive from it.

## Important Decisions

- `acquireLock` uses `openSync(path, "wx")` + `writeSync(pid)` + `fsyncSync` for atomic lockfile create; an existing lockfile is parsed and re-read to disambiguate live vs dead PID. Up to 3 attempts handles the race where another process unlinks the stale lockfile between our create and read.
- `releaseLock` only unlinks the lockfile when its on-disk PID still matches the holder PID we recorded. Prevents the case where another daemon legitimately took the lock after we crashed and we'd otherwise delete its lockfile.
- `bindSocket` is structured as a pure factory returning the Bun listener. The per-connection `RpcDuplex` is built by wrapping `socket.write` in a `WritableStream` and collecting `socket.data(...)` chunks through a `ReadableStream` controller stored on `socket.data`. The connection lifecycle ends when `onConnection` resolves OR the peer closes.
- `chmod 0600` is applied AFTER bind. Bun's UDS API doesn't expose a creation umask; chmod is the only reliable way.
- `makeShutdown` returns an idempotent function. Concurrent invocations (e.g. SIGTERM races SIGINT) all collapse to a single shutdown sequence via a captured `invoked` boolean.
- Single stderr banner on startup: `workflow-runner: daemon started (pid <N>, socket <path>)`. ADR-002 mandates silence on every subsequent connection.

## Learnings

- Bun 1.3 `UnixSocketListener` exposes `.stop(closeActiveConnections?: boolean)` not `.close()`. Tests and `makeShutdown` must use `stop(true)` to drop in-flight client connections.
- `Bun.connect({unix})` returns a socket whose `write()` is fire-and-forget; tests need a small `setTimeout` flush before `end()` to make sure the server side observed the bytes.
- For the "dead PID" test, probing pids near the kernel maximum (`4194300+`) is a portable way to find a likely-dead pid without `fork`/`spawn` overhead.

## Files / Surfaces

- `src/infra/daemon/daemon.ts` — `runDaemon`, `acquireLock`/`releaseLock`, `bindSocket`, `makeShutdown`, `DaemonAlreadyRunningError`, `daemonLogSize`.
- `src/infra/daemon/daemon-log.ts` — `DaemonLogger` with 10 MB default rotation, single-slot rotation to `<path>.1`.
- `src/infra/daemon/daemon.test.ts` — 7 unit tests: 3 lockfile (fresh/stale/contested), 2 socket (stale cleanup + chmod 0600, end-to-end byte routing), 2 shutdown (full sequence + idempotency).
- `src/infra/daemon/daemon-log.test.ts` — 9 unit tests covering append, order, creation, rotation at threshold, default 10 MB threshold not triggered, prior-rotation replacement, 0600 perms.

## Errors / Corrections

- First draft of `daemon.test.ts` used `await tempRootSync(...)` inside non-async `it(...)` callbacks. Fixed by making each affected `it` async and inlining the `tempRoot` call.

## Ready for Next Run

Task 11 complete. Daemon entry is end-to-end runnable: smoke test (`runDaemon` -> SIGTERM) confirmed clean startup, socket mode `0600`, and graceful shutdown that unlinks both socket and lockfile. `runDaemon` is now the entry point that task 12 (`infra/client`) will spawn on auto-spawn and task 16 (`app/commands/daemon.ts`) will invoke for the explicit foreground command.
