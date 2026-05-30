---
status: completed
title: JSON-RPC 2.0 server over NDJSON
type: infra
complexity: high
dependencies:
  - task_06
---

# Task 07: JSON-RPC 2.0 server over NDJSON

## Overview
Implement a small in-house JSON-RPC 2.0 server that runs over any NDJSON-framed duplex stream. It owns request/response correlation, notification fan-out, error envelope construction, and backpressure-aware writes. This server is transport-agnostic so it can be tested over an in-memory duplex without binding a real socket.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/rpc/server.ts`. Supporting types/utilities may sit in `src/infra/daemon/rpc/*.ts` (line splitter, frame writer) but the public entry point is `server.ts`.
- MUST accept a duplex `{ readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> }` per connection — transport-agnostic.
- MUST dispatch incoming Requests by `method` name to a registered handler `(params, ctx: RpcContext) => Promise<unknown>`. Handlers are registered via `server.handle(method, handler)`.
- MUST construct JSON-RPC-spec-compliant Response objects (`{jsonrpc: "2.0", id, result}` or `{jsonrpc: "2.0", id, error: {code, message, data?}}`).
- MUST support server-pushed Notifications via `connection.notify(method, params)` available through `RpcContext` (notifications are JSON-RPC messages without an `id`).
- MUST handle malformed input (invalid JSON, missing `jsonrpc`/`method`, unknown `method`) by responding with the appropriate JSON-RPC error code (`-32700`, `-32600`, `-32601`).
- MUST NOT support JSON-RPC batch requests (explicit no-op; document inline).
- MUST handle backpressure on the writable side by awaiting `writer.ready` before each write; if the socket buffer is full and a client is slow, the server must not lose notifications, but it may close the connection with a `DAEMON_SHUTTING_DOWN` error if the writer cannot drain within a configurable timeout.
- MUST clean up per-connection state (registered subscriptions, pending request handles) when a connection ends.
- MUST swallow no handler exceptions — they map to JSON-RPC `-32603` (`Internal error`) Responses with the error message in `data.message`.
</requirements>

## Subtasks
- [x] 7.1 Implement NDJSON line splitter on the readable side (handle partial lines across chunks).
- [x] 7.2 Implement the JSON-RPC envelope reader (parse, validate `jsonrpc === "2.0"`, distinguish Request vs Notification by presence of `id`).
- [x] 7.3 Implement the handler registry (`server.handle(method, fn)`) and per-connection dispatch loop.
- [x] 7.4 Implement Response construction with success and error envelopes.
- [x] 7.5 Implement `RpcContext` with `notify(method, params)` and a `subscriptions` registry (handlers register cleanup callbacks).
- [x] 7.6 Implement backpressure-aware write loop with the drain-timeout escalation.
- [x] 7.7 Implement connection cleanup on EOF or error.
- [x] 7.8 Write unit tests using an in-memory duplex (`TransformStream` pair) covering all the requirements above.

## Implementation Details
Create `src/infra/daemon/rpc/server.ts` plus supporting helpers in `src/infra/daemon/rpc/` (e.g., `ndjson.ts` for the line splitter, `envelope.ts` for the type-narrowing of incoming messages). The transport-agnostic shape lets task 11 wire it to a real `Bun.listen({unix: …})` socket and lets task 19 test the same server over an in-memory pair. Use the type-safe approach: define `type RpcHandler<M extends keyof RpcMethods>` and have `server.handle()` infer the params/result types from `RpcMethods[M]` — this is how the daemon catches a handler returning the wrong shape at compile time.

### Relevant Files
- `src/infra/daemon/protocol.ts` (task 06) — `RpcMethods`, `RpcNotification`, `RpcErrorCode` come from here.
- `src/infra/acp/acp-client.ts` — existing in-tree usage of `@agentclientprotocol/sdk`'s `ndJsonStream`; reference for NDJSON handling patterns.

### Dependent Files
- `src/infra/daemon/handlers/*` (tasks 09, 10) — each handler is registered via `server.handle()`.
- `src/infra/daemon/daemon.ts` (task 11) — accepts connections and hands their duplex to the server.
- `src/infra/client/client.ts` (task 12) — the matching client; its envelope handling must agree byte-for-byte with what this server produces.

### Related ADRs
- [ADR-004: JSON-RPC 2.0 over NDJSON for the Daemon Protocol](adrs/adr-004.md) — establishes envelope, framing, batching omission, and method namespace.

## Deliverables
- `src/infra/daemon/rpc/server.ts` plus supporting helpers.
- Type-safe handler registration that catches return-type mismatches at compile time.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Register a handler for `run.ps` returning `{runs: []}`. Send a Request `{jsonrpc:"2.0",id:1,method:"run.ps",params:{}}`. Assert the response is `{jsonrpc:"2.0",id:1,result:{runs:[]}}`.
  - [x] Send a Request for an unregistered method `foo.bar`. Assert response `{jsonrpc:"2.0",id:1,error:{code:-32601,message:/method not found/i}}`.
  - [x] Send malformed JSON. Assert response with `error.code: -32700` (`Parse error`).
  - [x] Send a payload missing `jsonrpc` field. Assert response with `error.code: -32600` (`Invalid request`).
  - [x] Register a handler that throws an `Error("boom")`. Assert response has `error.code: -32603` and `error.data.message === "boom"`.
  - [x] Send a Notification (no `id`). Assert no response is written.
  - [x] Call `ctx.notify("event.run.event", {…})` from inside a handler. Assert a Notification frame `{jsonrpc:"2.0",method:"event.run.event",params:{…}}` is written and the original Request still gets its Response.
  - [x] Send a batch (`[{…},{…}]`). Assert a single error response with `error.code: -32600` and an explanatory message that batching is unsupported.
  - [x] Two pipelined Requests on one connection (ids 1, 2) get responses with the correct ids.
  - [x] Handler registers a subscription cleanup via `ctx.onClose(cb)`; close the connection; assert `cb` was called exactly once.
  - [x] Partial-line scenario: send `'{"jsonrpc":"2.0","id":1,"method":'` then later `'"run.ps","params":{}}\n'`. Assert the request still parses and gets a response.
- Integration tests:
  - [ ] Covered indirectly by task 19 against the real socket transport.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The server has no transport-specific code (no `Bun.listen`, no `net.Socket`); transport is injected per connection.
- Type system catches a handler returning the wrong result shape at compile time.
