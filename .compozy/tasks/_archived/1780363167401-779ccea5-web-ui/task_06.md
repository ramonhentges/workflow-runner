---
status: completed
title: "Web: WS attach client + view-model reducer"
type: frontend
complexity: high
dependencies:
    - task_05
---

# Task 06: Web: WS attach client + view-model reducer

## Overview
Implement the WebSocket client that powers the live run view: it opens `/runs/:id/attach`, parses the daemon's lean `AttachFrame`s, and reduces the snapshot/backlog/event/status/error stream into a single view model (transcript, steps, status, interactive flag, summary). The reducer is a pure, well-tested function; the socket wrapper handles connection lifecycle and `input` frames.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- The client MUST open the attach WebSocket against the configured base URL and validate inbound frames with the zod validators from task_05.
- A pure reducer MUST fold `snapshot`, `backlog`, `event`, `status`, and `error` frames into a `RunViewModel` (see TechSpec "Core Interfaces").
- Consecutive `stream` chunks sharing the same `(stepId, kind)` MUST be coalesced into one transcript message block; `banner` events MUST start step sections and populate the ordered `steps` list; `interactive` events MUST toggle `interactiveEnabled`; `summary` MUST populate the summary field.
- The client MUST expose `subscribe(onModel)`, `sendInput(message)` (emitting `{type:"input",message}`), and `close()`.
- The client MUST NOT attempt automatic reconnect/resume (out of scope for the MVP); a socket close ends the session and is surfaced to subscribers.

## Subtasks
- [x] 06.1 Implement the pure frame→`RunViewModel` reducer with stream coalescing and step derivation.
- [x] 06.2 Implement the socket wrapper (open, parse+validate frames, dispatch to reducer, notify subscribers).
- [x] 06.3 Implement `sendInput` and `close`, and surface socket-close/error to subscribers.
- [x] 06.4 Provide a React hook wrapping the client for the run view (task_10).
- [x] 06.5 Cover reducer transitions and socket lifecycle with a fake WebSocket.

## Implementation Details
Implement under `web/src/lib/ws/` per TechSpec "Core Interfaces" (`RunViewModel`, `AttachClient`) and ADR-005. Reuse the wire/event types and zod validators from task_05. Keep the reducer free of I/O so it can be unit-tested directly; the socket wrapper is the only stateful piece. A fake `WebSocket` (from the task_04 test harness) drives frame sequences in tests.

### Relevant Files
- `web/src/lib/ws/attach-client.ts` — socket wrapper + `openAttach` (new).
- `web/src/lib/ws/reducer.ts` — pure frame reducer (new).
- `web/src/lib/ws/use-attach.ts` — React hook wrapper (new).
- `web/src/lib/api/types.ts` — `AttachFrame`/`RunnerEvent` types (from task_05).

### Dependent Files
- `web/src/features/run-view/*` (task_10) — consumes the hook + view model.

### Related ADRs
- [ADR-005: Frontend data architecture](../adrs/adr-005.md) — Dedicated WS client + reduced view model; no reconnect in MVP.

## Deliverables
- Pure reducer producing `RunViewModel` from frames.
- Socket wrapper with `subscribe`/`sendInput`/`close` and a React hook.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests driving a fake socket through a frame sequence **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A `snapshot` frame then two `event` frames with `stream` chunks of the same `(stepId,"output")` coalesce into one transcript message containing both chunks in order.
  - [x] A `banner` event adds a step to `steps` and marks it active; a later `banner` marks the previous inactive and the new one active.
  - [x] An `interactive {enabled:true}` event sets `interactiveEnabled=true`; `{enabled:false}` clears it.
  - [x] A `status` frame updates `status`; a `summary` event populates `summary`.
  - [x] An `error` frame populates `error` without discarding existing transcript.
  - [x] `backlog` entries are folded in seq order before subsequent live `event` frames.
- Integration tests:
  - [x] Driving the fake socket through `snapshot → backlog → event(stream) → status` yields the expected final `RunViewModel`; `sendInput("hi")` emits a `{type:"input",message:"hi"}` frame; `close()` stops further dispatch.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The reducer deterministically builds the transcript/steps/status/summary from any valid frame sequence.
- The client cleanly opens, sends input, and closes without leaking listeners.
