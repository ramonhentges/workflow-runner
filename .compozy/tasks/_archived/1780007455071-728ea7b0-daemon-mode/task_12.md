---
status: completed
title: UDS JSON-RPC client with auto-spawn
type: infra
complexity: high
dependencies:
  - task_06
---

# Task 12: UDS JSON-RPC client with auto-spawn

## Overview
Implement the client-side counterpart of the daemon: connects to the Unix domain socket, sends JSON-RPC requests, awaits responses, subscribes to notifications, and — critically — auto-spawns the daemon (gpg-agent style) when the socket is absent. This is what every `workflow-runner <subcommand>` invocation runs through.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/client/client.ts`. May add supporting files in `src/infra/client/` (e.g., `spawn.ts`).
- MUST expose `connect(opts: { storageRoot?: string }): Promise<DaemonClient>` returning a connected client.
- `connect()` MUST: (1) attempt to connect to `<storageRoot>/daemon.sock`; (2) if connection fails (ENOENT or ECONNREFUSED), invoke `autoSpawnDaemon()`; (3) re-attempt connection with a 2-second total timeout, polling at 50 ms intervals; (4) if it still fails, reject with an actionable error.
- `autoSpawnDaemon()` MUST fork the daemon binary detached (`stdio: 'ignore'`, `detached: true`, `unref()`'d) and print `workflow-runner: starting daemon` to stderr exactly once per spawn.
- `DaemonClient` MUST expose `call<M extends keyof RpcMethods>(method: M, params: RpcMethods[M]["params"]): Promise<RpcMethods[M]["result"]>` with type-safe params/result derived from the protocol module.
- `DaemonClient` MUST expose `subscribe(predicate: (n: RpcNotification) => boolean, handler: (n: RpcNotification) => void): () => void` returning an unsubscribe function.
- MUST translate JSON-RPC error responses into typed errors: a `DaemonRpcError` carrying `code` (`RpcErrorCode`), `message`, and optional `data`.
- MUST expose `close(): Promise<void>` to close the connection cleanly.
- MUST handle a daemon-side connection drop by rejecting all in-flight calls with a typed error.
- MUST NOT auto-reconnect (V1 keeps it simple — client invocations are short-lived; `attach` holds one long-lived connection).
- MUST detect non-TTY stdout in callers but NOT make TTY decisions itself (caller's responsibility); the client is purely an RPC plumbing layer.
</requirements>

## Subtasks
- [x] 12.1 Implement socket connect attempt using Bun's `Bun.connect({unix: path, socket: {…}})`.
- [x] 12.2 Implement the auto-spawn logic in `src/infra/client/spawn.ts` using `node:child_process` `spawn` with detached + stdio:ignore + unref.
- [x] 12.3 Implement the connect-with-spawn retry loop with the 2 s timeout and 50 ms poll interval.
- [x] 12.4 Implement the `DaemonClient` with id allocation, pending-request map, NDJSON envelope reader, type-safe `call`.
- [x] 12.5 Implement notification subscription with predicate matching.
- [x] 12.6 Implement `close()` and the connection-drop reject-all behavior.
- [x] 12.7 Write unit tests with an in-memory mock daemon (just a `TransformStream` pair speaking JSON-RPC) for the request/response path; system-level tests for spawn live in task 19.

## Implementation Details
Create `src/infra/client/client.ts` and `src/infra/client/spawn.ts`. The detached spawn uses `node:child_process`'s `spawn(process.execPath, [<path-to-daemon-entry>], {detached:true, stdio:'ignore'})` then `child.unref()`. The daemon-entry path can be derived at runtime from `import.meta.url` of a small shim file under `src/infra/daemon/` (or it's a bundled `bin` entry — depends on packaging; task 20 may simplify this). For the connection, Bun's `Bun.connect({unix})` returns a `Socket`; wrap it into the same readable/writable pair pattern from task 07's server side. Auto-spawn idempotency: the lockfile in the daemon process (task 11) is what prevents double-spawn; the client's role is just to poll the socket.

### Relevant Files
- `src/infra/daemon/protocol.ts` (task 06) — `RpcMethods`, `RpcNotification`, `RpcErrorCode`.
- `src/infra/daemon/daemon.ts` (task 11) — the entry the client auto-spawns.

### Dependent Files
- `src/app/commands/*` (tasks 15, 16) — every subcommand calls `client.connect()`.
- `src/infra/client/format.ts` (task 13) — used by `ps`/`doctor` commands to format `client.call()` results.
- `src/infra/tui/tui.ts` (task 14) — receives subscribed notifications via the client for the attach flow.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — establishes the gpg-agent-style auto-spawn pattern.
- [ADR-004: JSON-RPC 2.0 over NDJSON for the Daemon Protocol](adrs/adr-004.md) — wire format the client speaks.

## Deliverables
- `src/infra/client/client.ts` and `src/infra/client/spawn.ts`.
- `DaemonRpcError` typed error class.
- Unit tests with 80%+ coverage on the request/response/notification path **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `client.call("run.ps", {})` over a mock duplex sends a `Request {jsonrpc:"2.0", id:1, method:"run.ps", params:{}}` line and resolves with the mock's `result`.
  - [x] Two concurrent `call()` invocations are correlated correctly (one returns its own response, not the other's).
  - [x] `call()` against a mock that returns `{error:{code:-32000, message:"unknown"}}` rejects with a `DaemonRpcError` whose `code === RpcErrorCode.UNKNOWN_RUN`.
  - [x] `subscribe((n) => n.method === "event.run.event", handler)` invokes `handler` only for matching notifications; the returned function unsubscribes.
  - [x] When the mock duplex's readable side ends, all in-flight `call()` promises reject with a typed connection-drop error.
  - [x] `close()` ends the writable side and rejects any pending calls.
  - [x] `connect()` with a present socket connects without spawning (verify the spawn helper is not invoked).
  - [x] `connect()` with a missing socket invokes auto-spawn (mock the spawn helper); the poll loop succeeds on the second poll iteration; total time well under 2 s.
  - [x] `connect()` where the spawn helper succeeds but the socket never appears within 2 s rejects with an error message naming the timeout and the socket path.
  - [x] `connect()` where spawn itself fails (mock helper throws) rejects with an error referencing the spawn failure.
- Integration tests:
  - [ ] Real daemon auto-spawn covered by task 19's "Auto-spawn" scenario.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Type system catches a mismatch between requested method and supplied params at compile time (verified by a `// @ts-expect-error` test).
- No connection state leaks across test cases (every test cleanly closes its mock duplex).
