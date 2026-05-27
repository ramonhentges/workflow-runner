# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented JSON-RPC 2.0 server over NDJSON in `src/infra/daemon/rpc/`.

## Important Decisions

- Used a promise-chain write queue (`writeChain`) for serialized writes rather than a mutex class — keeps the closure-based design minimal and avoids class allocation per connection.
- `ctx.notify()` returns `Promise<void>` (not fire-and-forget) so handlers can `await` it; this ensures the notification is written before the response when called from inside a handler.
- Drain timeout defaults to `DEFAULT_DRAIN_TIMEOUT_MS = 30_000` but tests pass `drainTimeoutMs: 0` (no timeout, await forever) to avoid flaky timing.
- Client-to-server notifications (no `id`) with unknown methods are silently ignored (per JSON-RPC spec — no response can be sent).
- Batch request detection returns `-32600` with "Batch requests are not supported" as the message.

## Learnings

- `writer.ready` in the Web Streams API is the backpressure signal — it resolves when the internal queue has room. Must be awaited before each `writer.write()`.
- `TransformStream<Uint8Array, Uint8Array>` makes a clean in-memory duplex for tests — no need for an in-process socket.
- Accessing `private` class members in tests via `(srv as unknown as {...}).handlers` is idiomatic for Bun/TypeScript test scenarios where the public API doesn't expose the internal state.

## Files / Surfaces

- `src/infra/daemon/rpc/ndjson.ts` — async generator line splitter
- `src/infra/daemon/rpc/envelope.ts` — `parseEnvelope()` discriminated union
- `src/infra/daemon/rpc/server.ts` — `RpcServer` class, `RpcContext`, `RpcHandler<M>`, `RpcDuplex`
- `src/infra/daemon/rpc/server.test.ts` — 12 unit tests, all pass

## Errors / Corrections

None.

## Ready for Next Run

Task complete. All 11 required unit tests pass. Full suite: 152 pass, 0 fail. Typecheck clean.
Downstream tasks (08 RunManager, 09/10 handlers) can now call `server.handle()` and `server.accept()`.
