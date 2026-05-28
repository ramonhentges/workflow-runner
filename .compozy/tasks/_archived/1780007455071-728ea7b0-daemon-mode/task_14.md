---
status: completed
title: TUI refactor to TuiEventSource
type: refactor
complexity: high
dependencies:
  - task_06
---

# Task 14: TUI refactor to TuiEventSource

## Overview
Refactor the existing `Tui` so it depends on an abstract `TuiEventSource` instead of a concrete `Runner` instance. Add the `/detach` slash command. Change Ctrl-C semantics from "kill the entire app" to "kill the TUI only, with a 'run still alive — attach to return' banner." After this task, the TUI can be hosted equally by a local Runner (legacy tests) or by a UDS subscription (daemon-mode).

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST modify `src/infra/tui/tui.ts` in place: the current `attach(runner: Runner)` becomes `attachSource(source: TuiEventSource)`, where `TuiEventSource` is the interface defined in TechSpec → "Core Interfaces".
- MUST add an in-TUI `/detach` slash command that calls `source.detach()` (cleanly closes the subscription) and exits the TUI process, printing the "run still alive — `attach` to return" line.
- MUST change Ctrl-C handling: instead of triggering `onQuit`, it kills the TUI only, printing the same "run still alive — `attach` to return" line, and exits with code 0.
- MUST preserve existing `/quit` and `/exit` semantics: these mean "kill the TUI only" with the same exit banner (no distinction from Ctrl-C in V1).
- MUST keep the existing render behavior for all `RunnerEvent` kinds (banner, log, stream, interactive, status, summary) unchanged.
- MUST handle a `source` whose `subscribe` callback delivers events in non-chronological order initially (backlog replay can deliver historical events out-of-order relative to live events); the TUI must render in arrival order without crashing.
- MUST update `src/infra/tui/tui.ts` and `src/app/main.ts` so the existing foreground tests in this code path still compile (they will be removed in task 20).
</requirements>

## Subtasks
- [x] 14.1 Extract the `TuiEventSource` interface to a small types-only file (e.g., `src/infra/tui/event-source.ts`) so both TUI and infra/client can import it without a TUI dependency.
- [x] 14.2 Add the `attachSource(source: TuiEventSource)` method and refactor input handling to call `source.sendInput()` instead of `runner.provideInput()`.
- [x] 14.3 Implement the `/detach` slash command in `handleInput`.
- [x] 14.4 Change Ctrl-C behavior to "kill TUI only with banner".
- [x] 14.5 Update or add a thin in-memory `TuiEventSource` test helper that wraps an existing `Runner` so existing foreground tests still pass during the refactor window.
- [x] 14.6 Write unit tests covering `/detach`, the new Ctrl-C semantics, the in-arrival-order rendering, and the input flow over `source.sendInput`.

## Implementation Details
Modify `src/infra/tui/tui.ts`. The current `attach(runner: Runner)` at line 143 needs to become `attachSource(source: TuiEventSource)`. The current Ctrl-C handler at line 156 currently calls `this.#hooks.onQuit?.()`; change it to print the "run still alive — attach to return" banner via `process.stderr.write` (after the renderer is destroyed so the message reaches the terminal cleanly) and exit. The input handler at line 211 calls `runner.provideInput(...)`; refactor to call `source.sendInput(...)` from the captured `source` closure. The `/quit` and `/exit` short-circuits in `handleInput` stay the same (they already mean "kill the TUI"); just route them through the same banner-print path.

### Relevant Files
- `src/infra/tui/tui.ts` — the file being refactored; current `attach()` is at line 143, Ctrl-C handler at line 156, input handler at line 211, `/quit` handling around line 217.
- `src/domain/runner.ts` — `RunnerEvent` type the TUI renders; `RunnerObserver` interface that the legacy `attach(runner)` implemented.
- `src/infra/daemon/protocol.ts` (task 06) — references the event types streamed over the subscription (the TUI doesn't import this directly; the client/source adapter does).

### Dependent Files
- `src/app/main.ts` (current) and `src/app/commands/attach.ts` (task 16) — both create `Tui` instances; both will need to construct a `TuiEventSource` to attach.
- `src/infra/client/client.ts` (task 12) — the daemon-attach `TuiEventSource` implementation will live near here or in a thin adapter that wraps `client.subscribe`.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — locks in `/detach` slash command, Ctrl-C kills TUI only, the "run still alive" banner phrasing.

## Deliverables
- Refactored `src/infra/tui/tui.ts` with `attachSource(source)` replacing `attach(runner)`.
- New `src/infra/tui/event-source.ts` types file.
- Updated `src/app/main.ts` to wire whatever event source is appropriate during the refactor window.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `attachSource(source)` registers a subscription via `source.subscribe(...)`; the returned subscription is torn down by the returned detach function.
  - [x] Typing `/detach` calls `source.detach()` exactly once and triggers TUI shutdown with the "run still alive" banner.
  - [x] Ctrl-C key event triggers TUI shutdown with the same "run still alive" banner (does NOT call `source.detach()` — Ctrl-C means the user wants out of the TUI but the run continues without an explicit detach RPC; document this distinction).
  - [x] Typing `/quit` triggers TUI shutdown with the "run still alive" banner.
  - [x] User typing a normal message calls `source.sendInput(text)` exactly once with the trimmed text.
  - [x] A backlog burst followed by a live event: deliver 50 events synchronously via the subscribe callback; assert all 50 are rendered without crashes; assert the input field still accepts focus after the burst.
  - [x] Rendering of each event type (`banner`, `log`, `stream`, `interactive`, `status`, `summary`) produces the same output bytes as before the refactor (snapshot-style test against a canned input sequence).
  - [x] Attaching twice without detaching first throws an error (preserves the existing constraint from the legacy `attach(runner)`).
- Integration tests:
  - [ ] Covered by task 19 ("Attach/detach" scenario) running the real TUI against a real daemon.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Existing `runner.test.ts` and `mcp-server.test.ts` tests still pass with no modifications.
- The refactor introduces no new dependency on `infra/client/` or `infra/daemon/` inside `src/infra/tui/`.
