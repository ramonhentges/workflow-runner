---
provider: manual
pr:
round: 2
round_created_at: 2026-06-01T13:24:34Z
status: resolved
file: web/src/features/run-view/RunView.tsx
line: 37
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Input box stays enabled after the socket closes and silently drops messages

## Review Comment

`RunView` gates the chat input solely on `vm.interactiveEnabled`:

```tsx
<InputBox enabled={vm.interactiveEnabled} onSend={sendInput} />
```

`interactiveEnabled` is only ever toggled by `interactive` runner events
(`reducer.ts:123-124`). It is **not** reset when the live stream ends. Two
realistic paths leave the input enabled after the run is no longer reachable:

1. **Socket close.** `attach-client.ts` `close`/`close`-listener set
   `{ ...model, closed: true }` but leave `interactiveEnabled` untouched
   (`attach-client.ts:44-47, 70-73`). After a daemon shutdown, idle timeout, or
   navigation race, `RunView` renders the "Connection closed." notice
   (`RunView.tsx:25-33`) *and* a still-enabled input box.
2. **Terminal status without a trailing `interactive:false`.** If the run
   reaches a terminal `status` frame while the last interactive event was
   `enabled:true`, the box stays enabled.

When the user then types and submits, `InputBox` clears its value
(`InputBox.tsx:17-18`) and calls `onSend`, but `attach-client.sendInput`
no-ops because `ws.readyState !== WebSocket.OPEN`
(`attach-client.ts:63-67`). The message disappears with no error, no retry, and
no indication it was never delivered — the user believes they sent input to the
run.

Suggested fix: derive the enabled state from run liveness, not just the
interactive flag, e.g.

```tsx
<InputBox
  enabled={vm.interactiveEnabled && !vm.closed && vm.status === 'running'}
  onSend={sendInput}
/>
```

Optionally, have `sendInput` surface a failure (return a boolean or set an
error on the view model) when the socket is not open, so a dropped send is
visible rather than silent. The PRD calls out "error surfacing for failed
actions ... without losing the view," which a silently-dropped message
violates.

## Triage

- Decision: `valid`
- Notes: Confirmed. The `close` handler in `attach-client.ts:43-47` sets `closed: true` but never resets `interactiveEnabled`. The `status` frame reducer (`reducer.ts:49-51`) similarly does not reset `interactiveEnabled` on terminal status. Both paths leave the `InputBox` enabled while `sendInput` silently no-ops because `ws.readyState !== WebSocket.OPEN`. Root cause is in `RunView.tsx:37`: enabled state is derived from only `vm.interactiveEnabled` instead of the conjunction of interactivity, socket liveness, and run status. Fix: change the `enabled` prop to `vm.interactiveEnabled && !vm.closed && vm.status === 'running'`.
