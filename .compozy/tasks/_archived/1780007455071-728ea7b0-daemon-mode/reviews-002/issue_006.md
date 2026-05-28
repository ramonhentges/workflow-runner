---
provider: manual
pr:
round: 2
round_created_at: 2026-05-28T10:17:03Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 317
severity: low
author: claude-code
provider_ref:
---

# Issue 006: stop() leaks a setTimeout when the run resolves first

## Review Comment

`RunManager.stop` races the run promise against a 5-second timeout:

```ts
await Promise.race([
  record.runPromise,
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("stop timeout")), STOP_TIMEOUT_MS),
  ),
]).catch(() => {});
```

When `record.runPromise` wins the race, the inner `setTimeout` is never
cleared. The handle remains active for the full `STOP_TIMEOUT_MS` (5 s), at
which point it rejects an already-resolved promise (harmless) but in the
meantime keeps the Bun event loop refed.

Concretely this means:

- A test (or a real client) that calls `stop` and then expects the daemon to
  exit cleanly waits at least 5 seconds before `process` can quit naturally.
- Each `stop` call holds a timer ref; under heavy churn the timer pool grows.

Fix: capture the handle and clear it on the success path.

```ts
let timer!: ReturnType<typeof setTimeout>;
try {
  await Promise.race([
    record.runPromise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("stop timeout")), STOP_TIMEOUT_MS);
    }),
  ]);
} catch {} finally {
  clearTimeout(timer);
}
```

The same pattern already exists in `rpc/server.ts:76–94` for the
backpressure-drain race; reuse it here.

## Triage

- Decision: `valid`
- Notes: Confirmed the timer leak exists in the current code. The Promise.race() creates a setTimeout that is never cleared when the runPromise resolves first, causing the Bun event loop to remain referenced for the full 5-second timeout. This blocks clean daemon shutdown and leaks timer handles under heavy churn. The fix captures and clears the timer in a finally block, matching the established pattern in rpc/server.ts.

## Implementation

**Changes made:**
1. Modified `src/infra/daemon/run-manager.ts:322-329` to use try-catch-finally pattern
2. Captured setTimeout handle and added clearTimeout() in finally block
3. Added test `src/infra/daemon/run-manager.test.ts` to verify timer cleanup prevents event loop hang

**Verification:**
- All 421 tests pass (including new timer cleanup test)
- Type checking: 0 errors
- Build: successful
- No regressions in existing functionality
