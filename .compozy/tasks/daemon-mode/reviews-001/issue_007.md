---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/infra/daemon/daemon-log.ts
line: 74
severity: medium
author: claude-code
provider_ref:
---

# Issue 007: DaemonLogger blocks the event loop with synchronous writeSync per record

## Review Comment

`DaemonLogger.log` is called from RPC error paths and from `run.statusChanged`
fan-out, so it is on the hot path of every connection error and every run
lifecycle transition. The implementation uses `writeSync` (and `statSync`,
`renameSync`, `closeSync`, `openSync`) on every call, blocking the Bun event
loop on disk I/O. Under modest load (several concurrent runs each emitting
events) this serializes all RPC dispatch behind disk latency. On a slow disk
or NFS mount it also stalls the listener accept loop.

The rest of the codebase consistently uses `node:fs/promises`. The daemon log
should too.

Suggested fix: switch to async writes with a serialized queue (the same
`#writeChain` pattern that `EventLog.append` already uses). The async fs API
returns once the kernel has buffered the data, which is enough for the
informational JSON-lines log; the `fsync` step is only necessary on `close()`.

```typescript
async log(record): Promise<void> {
  this.#writeChain = this.#writeChain.then(() => this.#writeOne(record));
  await this.#writeChain;
}
```

## Triage

- Decision: `valid`
- Notes: Confirmed. Every `log()` call invokes `writeSync`, and rotation calls `statSync`, `closeSync`, `renameSync`, `openSync` — all blocking. Since `log()` is called on every connection error and run lifecycle event, this puts disk latency directly on the RPC dispatch path. The `EventLog` class in the same package already uses `node:fs/promises` with a `#writeChain` promise-chain serializer; `DaemonLogger` should do the same. Fix: introduce a private async-factory (`DaemonLogger.open()`), replace the fd-integer with a `FileHandle`, make `close()` async so it drains the chain then fsyncs, and change `log()` to a fire-and-forget queuer that advances `#writeChain`. Callers in `daemon.ts` already live in async functions so `await DaemonLogger.open()` and `await logger.close()` fit naturally.
