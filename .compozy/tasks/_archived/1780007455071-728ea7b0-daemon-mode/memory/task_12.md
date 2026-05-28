# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented `src/infra/client/client.ts`, `src/infra/client/spawn.ts`, and `src/infra/daemon/entry.ts` to provide a UDS JSON-RPC client with gpg-agent-style auto-spawn. `connect()` opens the unix socket, auto-spawns the daemon on ENOENT/ECONNREFUSED, and polls (default 50 ms × 2 s) until reachable. `DaemonClient` exposes type-safe `call`, predicate-based `subscribe`, and `close`; pending calls are rejected with `DaemonConnectionClosedError` on drop or close. `DaemonRpcError` translates JSON-RPC error responses.

## Important Decisions

- Use a small shim `src/infra/daemon/entry.ts` as the spawn target so `spawn.ts` can resolve the daemon-entry path via `import.meta.url`. The shim accepts an optional `storageRoot` from `argv[2]` so callers (including tests) can target a temp dir.
- `connect()` accepts injectable `spawn`, `connectSocket`, `now`, and `sleep` hooks so unit tests cover spawn/poll/timeout behavior without real processes or sockets. The real adapter wires `autoSpawnDaemon` + `connectUnixSocket` (Bun.connect over unix).
- The real Unix-socket adapter (`connectUnixSocket`) reuses the same `ReadableStream`/`WritableStream` bridge pattern as `bindSocket` on the daemon side.
- Pending-promise rejection at abort time uses an inert `.catch(() => {})` observer on the inner promise so rejections that fire before the async wrapper attaches its handler are not flagged as unhandled by Bun.
- TransformStream pairs apply backpressure when the peer never reads; the connection-drop and close() tests therefore spawn a background drain task on `pair.server.readable` so `writer.write` does not stall the call. The implementation continues to honor backpressure (await `writer.ready` and `writer.write`) — real UDS sockets buffer in the kernel so this is not an issue in production.

## Learnings

- `ReturnType<ReadableStream<Uint8Array>["getReader"]>` widens to a union with the BYOB reader because the DOM lib overloads `getReader()`. Explicitly typing the field as `ReadableStreamDefaultReader<Uint8Array>` plus a cast at the `getReader()` callsite avoids both the BYOB-overload error and the bun-types/stream-web `readMany` mismatch.
- `WritableStream.prototype.close()` exists in the WHATWG spec and Bun honors it, but acquiring an explicit writer via `getWriter().close()` is consistent with the pattern used by `rpc/server.test.ts`.
- The `@ts-expect-error` directive only suppresses errors on the immediately following statement; type-level conditional assertions (`type X extends [...]`) are not statements that emit errors. To assert that mismatched call params are caught at compile time, use a non-invoked async function whose body contains the call expressions guarded by `@ts-expect-error`.

## Files / Surfaces

- New: `src/infra/client/client.ts` — `DaemonClient`, `DaemonRpcError`, `DaemonConnectionClosedError`, `connect()`.
- New: `src/infra/client/spawn.ts` — `autoSpawnDaemon()`, `daemonEntryPath`.
- New: `src/infra/daemon/entry.ts` — shim that calls `runDaemon({ storageRoot })`.
- New: `src/infra/client/client.test.ts` — 11 unit tests (call/subscribe/close/connect/UDS round-trip + compile-time type test).
- New: `src/infra/client/spawn.test.ts` — 2 unit tests (entry path resolution, banner + detached spawn).

## Errors / Corrections

- First test run: most tests timed out at 5 s because `close()` only closed the writer; the read loop kept blocking on `reader.read()`. Fixed by tracking the reader in the constructor and cancelling it from `close()`.
- Second run: connection-drop and close tests timed out due to TransformStream backpressure on the unconsumed server-side. Fixed by adding a background drain task in those tests; implementation left intact to preserve backpressure semantics on real sockets.
- Typecheck: storing the reader as a class field with `ReadableStreamDefaultReader<Uint8Array>` failed because `getReader()` returns the `stream/web` flavor while the type alias resolves to bun-types' richer interface. Refactored to keep the reader local to the constructor and expose a `#cancelRead` thunk closing over it.

## Ready for Next Run

- task_13 (CLI output formatting) can now import `DaemonRpcError`, `RpcErrorCode`, and the `RpcMethods` types from `src/infra/client/client.ts` (re-exports) or directly from `src/infra/daemon/protocol.ts`.
- task_15/16 should call `connect()` to obtain a `DaemonClient`; they own the TTY decisions per the requirements (client is transport-only).
