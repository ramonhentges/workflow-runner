---
status: completed
title: WebSocket attach + send handler (lean frames, fromSeq resume, guardrails)
type: backend
complexity: high
dependencies:
  - task_01
  - task_03
  - task_11
---

# Task 12: WebSocket attach + send handler (lean frames, fromSeq resume, guardrails)

## Overview
Add the single run-scoped WebSocket endpoint that gives a UI the TUI-equivalent live view: it
replays the backlog on connect, tails live events, supports `fromSeq` resume after reconnect, and
accepts chat-style input for interactive steps — using the lean attach-scoped frame envelope. This
is the most lifecycle-sensitive task: it must reproduce the daemon's race-fixed gap-closing ordering
and apply the operational guardrails.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register `WS /runs/:id/attach` on the task-03 app via Bun's native WebSocket
  (`hono/bun` `createBunWebSocket`), guarded by the task-11 `Origin` allowlist on upgrade.
- On connect MUST send a `snapshot` frame, then a `backlog` frame (with `truncated`), then live
  `event`/`status` frames — reusing the backlog → register-subscriber → flush → gap-read ordering
  from `run-attach.ts` so no events are dropped or duplicated.
- MUST support `?fromSeq=N` resume mapping to `EventLog.readEventsSince(N)`; the `truncated` flag
  MUST surface on the `backlog` frame.
- MUST accept client `input` frames and route them to `RunManager.sendInput`; a non-interactive run
  MUST surface a non-fatal `error` frame (not a crash).
- MUST emit only the lean `AttachFrame`/`InputFrame` envelope (no `runId` in frames) per ADR-004.
- MUST apply guardrails: a per-connection idle timeout, a max-connections cap, and a bounded
  outbound buffer that closes the socket on overflow; subscriber detach + owned-event-log close MUST
  run on disconnect.
</requirements>

## Subtasks
- [x] 12.1 Wire `WS /runs/:id/attach` upgrade with the `Origin` allowlist and `:id` resolution.
- [x] 12.2 Implement the connect sequence: snapshot → backlog → subscribe → flush → gap-read → live tail.
- [x] 12.3 Implement `?fromSeq` resume and `truncated` surfacing.
- [x] 12.4 Handle client `input` frames via `RunManager.sendInput`, with a non-fatal error frame when not interactive.
- [x] 12.5 Apply idle timeout, max-connections cap, and bounded outbound buffer (close on overflow).
- [x] 12.6 Clean up on disconnect: detach subscriber, close any owned event-log handle.

## Implementation Details
Port the logic in `src/infra/daemon/handlers/run-attach.ts` to the WS transport, replacing
`ctx.notify` calls with lean frame sends. Reuse `RunManager.attachSubscriber`, `openEventLog`,
`EventLog.readEventsSince`/`flush`, and `currentStepBacklog`/`readBackwardForCurrentStep` exactly as
that handler does. See TechSpec "Implementation Design", ADR-004 (frames), and ADR-001 risk register
(re-verify `fromSeq` semantics against the WS lifecycle — do not assume the JSON-RPC fix transfers).

### Relevant Files
- `src/infra/daemon/handlers/run-attach.ts` — the race-fixed attach ordering to port.
- `src/infra/daemon/run-manager.ts` — `attachSubscriber`, `sendInput`, `openEventLog`.
- `src/infra/daemon/event-log.ts` — `readEventsSince`, `flush`, `currentStepBacklog`.
- `src/app/api/schema.ts` — `AttachFrame`/`InputFrame`/`RunEvent`.
- `src/app/commands/_tui-source.ts` — reference consumer for the fidelity differential test.

### Dependent Files
- `src/app/api/` app from task 03 — WS route registration.
- Task 13 (listener) — wires the Bun WebSocket handler into `Bun.serve`.
- Task 14 (shutdown) — drains these connections.

### Related ADRs
- [ADR-004: Lean, attach-scoped WebSocket frame envelope](../adrs/adr-004.md) — frame shapes + payload reuse.
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — guardrails + WS resume race re-verification.

## Deliverables
- `WS /runs/:id/attach` handler with backlog replay, live tail, `fromSeq` resume, and `sendInput`.
- Operational guardrails (idle timeout, max-connections, bounded outbound buffer).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for event-stream fidelity **(REQUIRED)**

## Tests
- Unit tests:
  - [x] On connect, frames arrive in order: one `snapshot`, one `backlog`, then `event`/`status`.
  - [x] An `input` frame on an interactive run calls `RunManager.sendInput`; on a non-interactive run it yields a non-fatal `error` frame.
  - [x] A WS upgrade with a foreign `Origin` is rejected; an unknown run id closes with an error.
  - [x] Outbound-buffer overflow closes the connection; idle connections close after the timeout.
- Integration tests:
  - [x] Event-stream fidelity (KPI): a WS client and a TUI subscriber on the same run observe identical `RunEvent` sequences (0 dropped/duplicated) across attach, `fromSeq` resume, and mid-flush reconnect.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A WS client is event-equivalent to the TUI on the same run across reconnect/resume.
- Guardrails bound resource use for stalled/abusive clients.
