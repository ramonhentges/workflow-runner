---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/infra/daemon/handlers/daemon-shutdown.ts
line: 7
severity: high
author: claude-code
provider_ref:
---

# Issue 001: daemon.shutdown leaves daemon half-closed but still listening

## Review Comment

`createDaemonShutdownHandler` only calls `rm.shutdown()`, which closes every
`McpServer` and `EventLog` but never stops the socket listener, releases the
lockfile, or exits the process. After this RPC returns, the daemon keeps
accepting new connections with `record.mcpServer === null` and
`record.eventLog === null` on every active run, so any subsequent `run.send`,
`run.attach`, or new `run.start` will throw (e.g. `sendInput` calls
`record.runner.provideInput`, but the runner's MCP server was shut down).
`daemon.shutdown` was designed to terminate the daemon (per the techspec's
"daemon ↔ client protocol" section); the only graceful-exit path today is the
SIGTERM/SIGINT handler in `runDaemon`.

Suggested fix: have the handler signal the main exit promise (e.g. accept a
shutdown callback from `runDaemon` and invoke it after `rm.shutdown()`),
mirroring the SIGTERM path. Until that is wired, do not expose
`daemon.shutdown` as a valid RPC.

```typescript
export function createDaemonShutdownHandler(
  rm: RunManager,
  triggerExit: (reason: string) => void,
): RpcHandler<"daemon.shutdown"> {
  return async () => {
    triggerExit("rpc");
    return {};
  };
}
```

## Triage

- Decision: `VALID`
- Root cause: `createDaemonShutdownHandler` only awaited `rm.shutdown()`, which
  closes per-run MCP servers and event logs but never stops the UDS listener,
  releases the lockfile, removes the socket, or resolves the main exit promise.
  Result: after the RPC returns, the daemon keeps accepting connections while
  every active run has `record.mcpServer === null` / `record.eventLog === null`,
  so any follow-up `run.send` / `run.attach` / `run.start` would fail.
- Fix:
  - `daemon.ts` now plumbs a `triggerExit(reason)` callback through
    `registerHandlers` into the `daemon.shutdown` handler. The SIGTERM/SIGINT
    paths and the RPC path now share the same `makeShutdown` callback, which
    closes the listener, calls `runManager.shutdown()`, unlinks the socket,
    releases the lock, closes the logger, and resolves the daemon's exit
    promise.
  - `createDaemonShutdownHandler(triggerExit)` defers the trigger via
    `setImmediate` so the JSON-RPC `{}` response can flush before the listener
    stops accepting writes. The handler no longer takes `RunManager` — the
    shutdown closure owns it.
- Tests: rewrote the handler unit test to assert that the result is `{}` is
  returned before `triggerExit("rpc")` fires (verified with a `setImmediate`
  fence). Existing `makeShutdown` tests already cover the rest of the
  shutdown sequence end-to-end.
- Notes: no compatibility shim required — there is no in-tree client of
  `daemon.shutdown` yet (a grep across `src/infra/client` and the CLI returned
  no callers).
