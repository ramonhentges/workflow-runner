---
provider: manual
pr:
round: 1
round_created_at: 2026-05-30T12:34:08Z
status: resolved
file: src/app/api/routes/ws-attach.ts
line: 151
severity: low
author: claude-code
provider_ref:
---

# Issue 003: `activeConnections` slot can leak if upgrade aborts before onOpen/onClose

## Review Comment

The max-connections cap counter is incremented inside the `upgradeWebSocket`
factory, which runs synchronously during the upgrade request:

```ts
// src/app/api/routes/ws-attach.ts:151
activeConnections++;
...
const state = createPerConnectionState(rm, id, fromSeq, () => {
  activeConnections = Math.max(0, activeConnections - 1);   // decrement
  ...
});
```

The decrement only ever runs via `onCleanedUp`, which is called from
`cleanup()`, which is reached only through `onOpen` error paths or `onClose`.
If the WebSocket upgrade is initiated (factory runs, counter incremented) but the
connection then fails/aborts such that **neither `onOpen` nor `onClose` fires**,
the slot is never reclaimed. Repeated occurrences permanently shrink the usable
pool until the 50-connection cap (`MAX_WS_CONNECTIONS`) wedges the endpoint and
all further attaches get `503 Too Many Connections`.

This is the operational-guardrail surface the PRD calls out (a stalled/abusive
client must not exhaust resources); a counter that can monotonically leak
undermines that guarantee. The `Math.max(0, ...)` floor prevents going negative
but does not address an over-count that never decrements.

Suggested fix: tie the counter strictly to the connection's lifecycle so every
increment has a guaranteed matching decrement — e.g. increment in `onOpen` (when
the socket is real and `onClose` is guaranteed by Bun), or register the
connection in the registry and derive the active count from `registry` size
rather than a free-standing counter. Add a test that simulates an upgrade whose
`onOpen` never fires and asserts the slot is reclaimed.

## Triage

- Decision: `valid`
- Notes: The increment at factory time (line 160) is separated from the only decrement path (`onCleanedUp` → `cleanup()`, reachable only via `onOpen` or `onClose`). If the TCP upgrade is initiated but the WebSocket handshake never completes (connection dropped before the OS delivers the upgrade), neither `onOpen` nor `onClose` fires, so `cleanup()` never runs and the slot leaks permanently. Root cause: wrong lifecycle attachment point for the increment. Fix: move `activeConnections++` from the `upgradeWebSocket` factory into the `onOpen` handler. Since Bun's WebSocket runtime guarantees `onClose` fires if and only if `onOpen` has fired, moving the increment to `onOpen` ensures every increment has a guaranteed matching decrement. No change to the decrement location (`onCleanedUp`) is needed.
