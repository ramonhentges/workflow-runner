---
provider: manual
pr:
round: 3
round_created_at: 2026-06-01T13:45:01Z
status: resolved
file: web/src/lib/ws/attach-client.ts
line: 14
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Live stream is silently dropped after 30s with no client keepalive

## Review Comment

The web attach client never sends anything to the daemon except when the user
submits a chat message:

```ts
sendInput(message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'input', message }))
  }
},
```

The daemon's WS attach handler enforces a 30-second idle timeout
(`src/app/api/routes/ws-attach.ts`: `IDLE_TIMEOUT_MS = 30_000`) whose timer is
reset **only** by `onOpen` and inbound `onMessage` — never by outbound event
frames (`resetIdleTimer()` is not called in `sendFrame`). Consequently the
"idle" measured by the server is *time since the last client→server message*,
not time since the last activity.

Effect on the web UI:

- An **autonomous** step (no interactive input is ever sent) is closed 30s
  after attach, regardless of how much output is streaming.
- An **interactive** step is closed whenever the user goes >30s without typing,
  even while the agent is actively producing output.

Because agent steps routinely run for minutes, the common case is that the live
view a user is watching is terminated after 30s with `close()` →
`{ ...model, closed: true }` → the "Connection closed." notice in `RunView`,
and — per the accepted MVP no-reconnect decision — it never recovers. This
significantly undercuts the PRD's primary goal ("watch its output stream live")
and the "no manual refresh needed" success metric.

The TechSpec does accept idle-close as a close reason and no-reconnect for the
MVP, but the intent of an *idle* timeout is a genuinely quiet connection; here
an actively streaming run is treated as idle because the timer ignores outbound
traffic.

Suggested fix (note the root timer lives in the out-of-scope, unchanged
`ws-attach.ts`, so a clean fix likely spans both files):

- Preferred: reset the daemon idle timer on outbound activity (call
  `resetIdleTimer()` in `sendFrame`), so an actively streaming connection is not
  considered idle. This is the smallest correct change but touches
  `ws-attach.ts`.
- Or: have `attach-client.ts` send a periodic keepalive. Note that `onMessage`
  calls `resetIdleTimer()` *before* frame validation, so any client frame resets
  the timer — but an unrecognized frame is answered with an
  `{type:'error',code:'INVALID_FRAME'}` frame, which `RunView` would surface as a
  spurious "Socket error" banner. A client-only keepalive therefore needs a
  server-tolerated no-op/ping frame type to avoid that side effect.

Either way the current behavior — the live view dying ~30s into every
long-running step — should be addressed or the idle window raised substantially
for the observer use case.

## Triage

- Decision: `valid`
- Root cause: `createPerConnectionState` in `src/app/api/routes/ws-attach.ts` calls `resetIdleTimer()` only in `onOpen` and `onMessage` (client→server traffic). `sendFrame()` never calls `resetIdleTimer()`, so any connection where the client sends nothing (autonomous steps, or an interactive step where the user hasn't typed recently) will time out after 30 s regardless of how much data the server is streaming outbound.
- Fix approach: Call `resetIdleTimer()` in `sendFrame()` at every successful send path (the two `return true` branches are consolidated into one, with `resetIdleTimer()` before them; the fallback `ws.send()` path gets the same call). The two early `return false` paths (negative status = connection closed; buffer overflow = we're actively closing) correctly do not reset the timer.
- Out-of-scope file note: The listed scope file is `web/src/lib/ws/attach-client.ts`, but the root timer lives in `src/app/api/routes/ws-attach.ts`. The reviewer explicitly identifies this as the preferred minimal fix location. A pure client-side keepalive would also require a server-side no-op frame type to avoid spurious `INVALID_FRAME` error banners, making it more invasive. The server-side fix in `sendFrame()` is the smallest correct change and is limited to adding two `resetIdleTimer()` calls and consolidating one return path.
