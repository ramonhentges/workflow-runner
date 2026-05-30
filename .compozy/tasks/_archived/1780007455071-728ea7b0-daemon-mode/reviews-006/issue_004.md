---
provider: manual
pr:
round: 6
round_created_at: 2026-05-28T16:56:48Z
status: resolved
file: src/app/commands/_attach-loop.ts
line: 37
severity: medium
author: claude-code
provider_ref:
---

# Issue 004: Early-event buffer drop-oldest discards events not in backlog

## Review Comment

`attachLoop` caps the pre-RPC early-event buffer at 5000 with FIFO
eviction (`_attach-loop.ts:37-44`):

```ts
if (earlyEvents.length >= EARLY_EVENT_BUFFER_LIMIT) {
  earlyEvents.shift();
  console.warn(`early-event buffer reached limit (${EARLY_EVENT_BUFFER_LIMIT}), dropping oldest entry`);
}
earlyEvents.push(n.params);
```

The intent is to bound memory while still capturing events delivered in
the same TCP segment as the `run.attach` response. But the events the
buffer captures arrive **after** the daemon snapshotted `backlog` and
**after** the gap-read in `run-attach.ts:83`. They are the events that
exist *only* in the early buffer. Dropping the oldest entries from this
buffer therefore drops events that are not in `backlog`, not in
`earlyEvents` (post-drop), and not in the future live stream (the early
subscription is still the only listener until `_tui-source.ts.subscribe`
runs).

When `_tui-source.ts:50-56` replays `earlyEvents` and dedupes against
`backlogSeqs`, the dropped events are simply absent from the TUI. The
TUI shows a hole between the backlog tail and the first surviving early
event.

Secondary problem: `console.warn` writes to stderr, which is the same
terminal the TUI is about to take over. In the typical case the buffer
overflows before `tui.attachSource(source)` runs (because that's the
synchronous point that drains it), so the warning is harmless. But
`@opentui/core` typically captures stderr too — once the TUI is up, any
late warning corrupts the rendered frame.

Fix: when the cap is hit, drop newest instead of oldest, and surface
the loss in a way that lets the TUI render an explicit gap marker
(e.g., push a synthetic `{ type: "log", message: "… dropped N early
events …" }` after replay). Dropping newest is safe because the live
subscription registered in `_tui-source.ts:64-76` will deliver any
event whose append completes after the drop, while the older buffered
events are the ones the client actually depends on for continuity.

If keeping drop-oldest, at minimum:
- Route the warning through a logger/buffer that the TUI surfaces in
  the next paint, not `console.warn`.
- Increase the cap meaningfully, since 5000 is small for stream-heavy
  workflows.

## Triage

- Decision: `valid`
- Notes:

### Root cause

`earlyEvents.shift()` (FIFO eviction) discards the **oldest** buffered events when the cap is reached. These oldest events are the ones that bridge the gap between the daemon's backlog snapshot (returned by `run.attach`) and the live subscription registered in `createTuiEventSource`. Dropping them creates a permanent hole in the TUI: the events exist only in the early buffer, are not in `backlog`, and are not in the live stream (which starts after the early subscription ends). The TUI renders events from seq N (backlog tail) then jumps to seq N+5001+ (first surviving early event), silently skipping whatever fell in between.

The secondary `console.warn` issue is also valid: writing to stderr before or during TUI init can corrupt the rendered frame if `@opentui/core` has captured that fd.

### Fix applied

**`src/app/commands/_attach-loop.ts`** (primary, in-scope file):
- Changed from drop-oldest (`shift()`) to drop-newest (`return` without pushing) when the buffer is full. The oldest events, which provide continuity from the backlog, are preserved. Any events dropped with this strategy are genuinely lost (the live subscription only delivers future events), so their count is tracked in `droppedEarlyEvents`.
- Removed `console.warn`; the lost-event count is forwarded to `createTuiEventSource` instead.

**`src/app/commands/_tui-source.ts`** (minimal companion change, outside primary scope but necessary for a complete fix — touched only to add one parameter and one conditional observer call):
- Added `droppedEarlyEvents?: number` parameter to `createTuiEventSource`.
- After replaying early events, if `droppedEarlyEvents > 0`, emits a synthetic `{ type: "log", message: "...", color: "yellow" }` event so the TUI can render an explicit gap marker instead of the bug silently producing a hole.

### Tests added

Two new cases in `src/app/commands/_tui-source.test.ts`:
1. Verifies that `droppedEarlyEvents > 0` causes a gap-marker log event to be emitted after early-event replay.
2. Verifies that `droppedEarlyEvents === 0` produces no extra event.

### Verification

- `bun run typecheck`: clean
- `bun test`: 447 pass, 1 skip, 0 fail (39 files)
