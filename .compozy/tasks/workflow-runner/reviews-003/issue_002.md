---
provider: manual
pr:
round: 3
round_created_at: 2026-05-22T20:45:42Z
status: resolved
file: src/runner.ts
line: 209
severity: high
author: claude-code
provider_ref:
---

# Issue 003: Spawn-error detection is a no-op; the synchronous check never fires

## Review Comment

The spawn-failure handling registers an `error` listener and then checks a flag
synchronously on the very next lines:

```ts
let spawnError: Error | null = null;
agentProcess.on("error", (err) => { spawnError = err as Error; });
// ... stderr wiring ...
if (spawnError) {
  throw new Error(`Failed to spawn opencode agent: ${String(spawnError)}`);
}
```

The `error` event is emitted asynchronously (on a later tick), so `spawnError`
is always `null` at the synchronous `if` check — the guard can never be true.
After that single check the variable is never read again. So when `opencode` is
missing from `PATH` or not executable, the intended clear message
("Failed to spawn opencode agent: ...") is never produced. Instead the code
proceeds to `Writable.toWeb(agentProcess.stdin!)` / `connection.initialize`, and
the failure surfaces later as an opaque stream/initialize error — the captured
`spawnError` is silently swallowed.

The same broken pattern exists in `src/index.ts` (lines 432-450) for the
pre-run connection.

Suggested fix: gate startup on the event rather than a synchronous flag. Either
`await once(agentProcess, "spawn")` and treat an `error` as a rejection, or wrap
the subprocess lifecycle in a promise whose `error` handler rejects with the
clear message. Apply the same fix in both `runner.ts` and `index.ts`.

## Triage

- Decision: `valid`
- Notes: The synchronous flag check pattern (`let spawnError = null; ... on("error", ...)`) was a genuine no-op because the `error` event fires async. Fixed by replacing with `await new Promise(...once("error")/once("spawn")...)` — the promise resolves on `spawn` and rejects on `error` with the clear error message. Applied identically in both `src/runner.ts` and `src/index.ts`. Verified: `tsc --noEmit` passes, all 67 tests pass.
