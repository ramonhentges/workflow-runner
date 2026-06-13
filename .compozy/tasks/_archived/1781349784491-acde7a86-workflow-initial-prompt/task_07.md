---
status: completed
title: TUI — surface initialPrompt in the attached run view
type: frontend
complexity: low
dependencies:
  - task_01
---

# Task 7: TUI — surface initialPrompt in the attached run view

## Overview
Show the prompt a run was started with in the terminal UI when a user attaches to a
run, so the CLI experience matches the web run view. The prompt arrives on the
`run.attach` initial snapshot and is rendered as the opening entry in the
transcript/chat area — reading like the user's first message — rather than crammed
into the short isolation header.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST render the run's `initialPrompt` in the TUI transcript/chat area as the
  opening entry when it is present on the attach snapshot.
- MUST render nothing extra when `initialPrompt` is absent, leaving the TUI visually
  unchanged from today.
- MUST wire the prompt from the `run.attach` `initialSnapshot` into the TUI in the
  attach loop, mirroring how isolation info is passed via `setIsolation`.
- MUST keep the existing isolation header behavior unchanged.
</requirements>

## Subtasks
- [x] 7.1 Add a TUI method to display the initial prompt as the opening transcript/chat entry.
- [x] 7.2 Render the prompt only when present; no-op when absent.
- [x] 7.3 Pass `initialSnapshot.initialPrompt` into the TUI from the attach loop.
- [x] 7.4 Add TUI tests for present/absent rendering.

## Implementation Details
See TechSpec "Monitoring and Observability" (TUI reads the same snapshot) and
ADR-003. `run.attach` already returns the full `RunSnapshot` as `initialSnapshot`
(consumed in `_attach-loop.ts`, which calls `tui.setIsolation(initialSnapshot)`).
Add an analogous call that hands the prompt to a new TUI render method. The snapshot
gains `initialPrompt` from task 01; this task does not need the daemon/HTTP/CLI
chain. Do not duplicate TUI rendering code from the TechSpec.

### Relevant Files
- `src/infra/tui/tui.ts` — add a method to render the initial prompt in the transcript/chat area; reference `setIsolation`/header as the pattern.
- `src/app/commands/_attach-loop.ts` — pass `initialSnapshot.initialPrompt` into the new TUI method alongside the existing `setIsolation` call.

### Dependent Files
- `src/domain/run.ts` — source of `RunSnapshot.initialPrompt` (task 01).
- `src/infra/daemon/protocol.ts` — `run.attach` result already carries `RunSnapshot`; no change needed.

### Related ADRs
- [ADR-003: Dedicated initialPrompt field on the run snapshot](../adrs/adr-003.md) — the field surfaced here.

## Deliverables
- A TUI render path that shows the initial prompt as the opening transcript entry when present.
- Attach-loop wiring from `initialSnapshot.initialPrompt` to the TUI.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the attach flow rendering the prompt **(REQUIRED)**

## Tests
- Unit tests:
  - [x] The TUI renders the prompt text as the opening transcript entry when given an `initialPrompt`.
  - [x] The TUI renders no prompt entry when `initialPrompt` is absent (frame unchanged from today).
  - [x] The isolation header still renders branch/worktree for an isolated snapshot.
- Integration tests:
  - [x] Attaching to a run whose `initialSnapshot` carries `initialPrompt` shows the prompt in the TUI (via the attach loop wiring).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- An attached run shows its initial prompt in the TUI when it had one, and is unchanged otherwise.
- Isolation header behavior is preserved.
