---
provider: manual
pr:
round: 2
round_created_at: 2026-05-28T10:17:03Z
status: resolved
file: src/app/commands/_attach-loop.ts
line: 21
severity: medium
author: claude-code
provider_ref:
---

# Issue 004: Live events between attach response and TUI subscribe are dropped

## Review Comment

`attachLoop` awaits `client.call("run.attach", …)` and only **after** the
response resolves does it create the `TuiEventSource` and call
`tui.attachSource(source)`, which is what finally invokes `client.subscribe`
to register the live-event predicate.

Between the daemon-side `rm.attachSubscriber(...)` call (run-attach.ts:38) and
the daemon writing the response, the runner observer can iterate the new
subscriber list and enqueue `event.run.event` notifications. The RPC server's
`writeChain` keeps frames ordered, so on the wire the daemon may produce
`[response, notif1, notif2]` packed in a single TCP segment.

On the client, `DaemonClient.#runReadLoop` decodes the segment into multiple
lines and dispatches them **synchronously** in one pass before yielding on the
next `reader.read()`. The pending response's `resolve()` only schedules a
microtask — it does not switch context — so when `notif1` and `notif2` are
dispatched, `#subscriptions` is still empty and they are silently dropped
(client.ts:142–155). Only when the chunk dispatch finishes and microtasks run
does the caller resume and call `client.subscribe`, by which point the
notifications are gone.

Round 1's issue 011 covered the historical-backlog half of this race (now
returned inline). The live-event half is still open.

Suggested fix: register the client-side subscription **before** sending
`run.attach`, e.g.

```ts
const off = client.subscribe(predicate, dispatch);
let result;
try {
  result = await client.call("run.attach", { runId });
} catch (err) {
  off(); throw err;
}
```

…then have `createTuiEventSource` reuse that subscription instead of opening a
second one. Add a regression test that drives an in-memory duplex where the
notifications and the response are emitted in the same chunk, and assert the
observer received the notifications.

## Triage

- Decision: `valid`
- Root cause: The race occurs because `attachLoop` awaits the `run.attach` RPC response before subscribing to live events via `client.subscribe`. Events emitted during the RPC (between daemon subscriber registration and response) may arrive in the same TCP segment as the response and be dispatched synchronously before the subscription is registered, causing them to be silently dropped.
- Fix approach: 
  1. Modified `_attach-loop.ts` to subscribe BEFORE calling `run.attach`, capturing early events in a queue
  2. Modified `createTuiEventSource` to accept `earlyUnsubscribe` and `earlyEvents` parameters
  3. When the TUI's observer subscribes, the early events are replayed first, then the early subscription is unsubscribed
  4. Added a regression test to verify early events are replayed correctly
