---
status: completed
title: Daemon entry — UDS bind, lockfile, startup wiring
type: infra
complexity: medium
dependencies:
  - task_09
  - task_10
---

# Task 11: Daemon entry — UDS bind, lockfile, startup wiring

## Overview
Wire everything together into a runnable daemon: bind the Unix domain socket, take the PID lockfile, instantiate the `RunManager`, register every JSON-RPC handler, run the discovery pass on startup, and serve connections until shutdown. This is the file invoked by `workflow-runner daemon` and (transparently) by auto-spawn.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/daemon.ts` and export `runDaemon(opts: { storageRoot?: string }): Promise<void>` returning when the daemon process is asked to exit.
- MUST resolve the socket path as `<storageRoot>/daemon.sock` and the lockfile as `<storageRoot>/daemon.lock`.
- MUST acquire an exclusive `flock` on the lockfile before binding the socket; if the lock is held by another live process (verified by re-reading the PID), exit with non-zero and stderr `daemon already running with pid <N>`.
- MUST detect and clean up a stale lockfile (PID dead): proceed to acquire the lock.
- MUST delete a stale socket file before binding (any leftover from a non-graceful exit).
- MUST `chmod 0600` the socket file immediately after bind (umask is unreliable on UDS).
- MUST instantiate the `RunManager`, run `discoverOnStartup()`, then begin accepting connections.
- For each incoming connection, MUST instantiate a `RpcServer` per connection (the per-connection state pattern from task 07), register all eight handlers, and run the dispatch loop until the connection closes.
- MUST handle SIGTERM and SIGINT gracefully: stop accepting new connections, call `RunManager.shutdown()`, close the listener, release the lockfile, exit 0.
- MUST write a single line to stderr `workflow-runner: daemon started (pid <N>, socket <path>)` on successful startup; nothing on subsequent client connections.
- MUST log structured events to `<storageRoot>/daemon.log` (see TechSpec → Monitoring); rotate that file at 10 MB.
</requirements>

## Subtasks
- [x] 11.1 Implement socket path resolution and stale-socket cleanup.
- [x] 11.2 Implement lockfile acquisition with PID-check stale-detection (use `node:fs` `openSync` + `fcntl.flockSync` via Bun's `node:fs` shim).
- [x] 11.3 Instantiate `RunManager`, run discovery, register all eight handlers via the factory functions from tasks 09 and 10.
- [x] 11.4 Implement the connection accept loop using Bun's `Bun.listen({unix: socketPath, socket: {…}})`.
- [x] 11.5 Implement SIGTERM/SIGINT graceful shutdown.
- [x] 11.6 Implement structured daemon logging with size-based rotation.
- [x] 11.7 Write unit tests for stale lockfile detection, stale socket cleanup, and the structured-log writer (handler registration is exercised by task 19 integration tests).

## Implementation Details
Create `src/infra/daemon/daemon.ts`. Bun's UDS API: `Bun.listen({unix: socketPath, socket: {data, open, close, drain}})`. Convert Bun's `Socket` interface into the `{readable, writable}` duplex pair the `RpcServer` from task 07 expects (Bun sockets expose a readable iterator via `socket.data` callback aggregation; wrap into a `ReadableStream` and provide a `WritableStream` that calls `socket.write`). The structured log writer is small and self-contained — a `DaemonLogger` class in `src/infra/daemon/daemon-log.ts` with the rotation logic; reuse the same atomic-write/rename pattern as `RunStore` but for the daemon log.

### Relevant Files
- `src/infra/daemon/rpc/server.ts` (task 07) — instantiated per connection.
- `src/infra/daemon/run-manager.ts` (task 08) — central state, instantiated once at startup.
- `src/infra/daemon/handlers/*` (tasks 09, 10) — registered factories.
- `src/infra/daemon/run-store.ts` (task 04) — for storage-root resolution and `discoverAndMarkOrphans` (via `RunManager`).

### Dependent Files
- `src/app/commands/daemon.ts` (task 16) — invokes `runDaemon()` for the explicit foreground command.
- `src/infra/client/client.ts` (task 12) — spawns this entry point on auto-spawn.

### Related ADRs
- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — defines lockfile and startup discovery.
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — establishes the silent-on-success daemon visibility rule (single stderr line on first spawn).

## Deliverables
- `src/infra/daemon/daemon.ts` exporting `runDaemon`.
- `src/infra/daemon/daemon-log.ts` with the rotating structured logger.
- Unit tests with 80%+ coverage on lockfile and log rotation **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Stale lockfile (PID is dead): `acquireLock()` deletes the stale file and acquires the lock.
  - [x] Active lockfile (PID is alive — test by pointing at the current test process PID): `acquireLock()` rejects with an error message containing the PID.
  - [x] Stale socket file: `bindSocket()` unlinks the existing path and binds successfully.
  - [x] After bind, socket file mode is `0600` (`stat` + mode-mask check).
  - [x] `DaemonLogger.log({level:"INFO", event:"run.started", runId:"abc"})` appends one JSON line to `daemon.log` with `ts` field.
  - [x] `DaemonLogger` rotates `daemon.log` to `daemon.log.1` when the file exceeds 10 MB.
  - [x] SIGTERM handler: simulate by calling the registered signal handler directly; assert `RunManager.shutdown()` is called and the listener `close()` is called.
- Integration tests:
  - [ ] Covered by every task 19 scenario (each spawns the real daemon).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Manual smoke test: `workflow-runner daemon` starts cleanly and exits cleanly on Ctrl-C.
- Stale lockfile from a `kill -9`'d daemon is detected and reclaimed on the next start.
