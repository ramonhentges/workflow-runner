---
provider: manual
pr:
round: 3
round_created_at: 2026-05-28T10:39:05Z
status: resolved
file: src/app/commands/_attach-loop.ts
line: 45
severity: low
author: claude-code
provider_ref:
---

# Issue 004: earlyUnsubscribe leaks if Tui.create throws after run.attach

## Review Comment

`_attach-loop.ts:26-66` registers the early subscription before
`client.call("run.attach", ...)`, and is careful to call `earlyUnsubscribe()`
in the `catch` branch (line 41) and to pass it into
`createTuiEventSource` where it is invoked inside `subscribe()`. But there
is a gap between the RPC returning and `tui.attachSource(source)` being
called:

```ts
result = await client.call("run.attach", { runId });
const { runId: resolvedRunId, backlog } = result;
...
const watcher = watchExitCode(client, resolvedRunId);
const tui = await Tui.create({ hooks: { exit: () => resolveQuit() } });
const source = createTuiEventSource(client, resolvedRunId, backlog,
                                    earlyUnsubscribe, earlyEvents);
tui.attachSource(source);
```

If `Tui.create` throws (terminal allocation failure, opentui init error)
— or any of the intervening statements throw — `earlyUnsubscribe` is
never invoked. The subscription stays registered in `client.#subscriptions`
and the `earlyEvents` array keeps growing for every matching notification
until the entire `client` is closed. In a short-lived CLI process this is
harmless; in any context where the same `client` outlives the failed attach
(integration tests, future programmatic API, retries on the same
connection), this is a slow leak.

Suggested fix: wrap the post-RPC setup in `try`/`catch` (or `try`/`finally`
with a "successfully handed off to source" flag) and call
`earlyUnsubscribe()` from the failure path. Equivalently, hoist the cleanup
into a small helper:

```ts
let handedOff = false;
try {
  const source = createTuiEventSource(...);
  handedOff = true;
  tui.attachSource(source);
} finally {
  if (!handedOff) earlyUnsubscribe();
}
```

## Triage

- Decision: `VALID`
- Notes: Subscription leak confirmed. Between `run.attach` RPC returning and successful handoff to TUI source, any exception (Tui.create failure, createTuiEventSource failure, or attachSource failure) would leave earlyUnsubscribe uncalled, causing memory leak in long-lived clients or test scenarios.

## Implementation

Wrapped post-RPC setup (lines 56-81) in try/finally:
- Line 56: Initialize `handedOff = false` flag
- Line 70: Set `handedOff = true` immediately before `tui.attachSource(source)`
- Line 71: Call attachSource, which internally calls source.subscribe() → earlyUnsubscribe()
- Lines 79-81: Finally block ensures earlyUnsubscribe is called if handedOff never reached true

This matches the suggested fix pattern exactly. All 427 tests pass with no TypeScript errors and clean build.
