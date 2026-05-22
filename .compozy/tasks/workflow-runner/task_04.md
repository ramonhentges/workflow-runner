---
status: completed
title: Workflow orchestration runner
type: backend
complexity: high
dependencies:
    - task_02
    - task_03
---

# Task 4: Workflow orchestration runner

## Overview
This task builds the engine that advances a workflow step by step: for each step it spawns a fresh `opencode acp` subprocess and session, binds the step's persona and model, runs it in interactive or autonomous mode, and reacts to the `handoff`/`finish` outcome. It also detects the three failure modes and produces the end-of-run summary.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create `src/runner.ts` exporting `runWorkflow(opts)`, `RunOptions`, `RunSummary`, and `RunnerUi` per the TechSpec "Core Interfaces" and "Data Models" sections.
- For each step `runWorkflow` MUST: arm the MCP server via `beginStep`, spawn a fresh `opencode acp` subprocess, build a `ClientSideConnection` with a fresh `AcpClient`, `initialize`, and `newSession` declaring the MCP server URL.
- MUST verify `agentCapabilities.mcpCapabilities.http` at `initialize` and abort with a clear message if it is absent.
- MUST validate `step.agent` against the session's `availableModes`, then call `setSessionMode(step.agent)` and `unstable_setSessionModel(step.model)`; a missing mode or failed model set is a step failure.
- MUST send a kickoff prompt composed of the step `description` plus, when present, the inbound handoff message; interactive steps then accept user turns, autonomous steps run only the kickoff turn.
- MUST tear down the session and subprocess on each outcome, calling `connection.cancel()` before teardown when a turn is still running.
- MUST treat as a `failure` outcome (halt-and-report): an undeclared handoff target, a subprocess that exits unexpectedly, and an autonomous step whose kickoff turn completes with no `handoff`/`finish`.
- MUST return a `RunSummary` listing visited steps in order, the finish message, total duration, and any failure.

## Subtasks
- [ ] 4.1 Define `RunOptions`, `RunSummary`, and `RunnerUi`; implement the `runWorkflow` step loop starting from `startStepId`.
- [ ] 4.2 Implement per-step session setup: spawn subprocess, `initialize` with the HTTP-capability check, `newSession` with the MCP server URL.
- [ ] 4.3 Bind the step: validate `step.agent` against `availableModes`, `setSessionMode`, `unstable_setSessionModel`.
- [ ] 4.4 Compose and send the kickoff prompt; drive interactive turns via `RunnerUi` input vs. the single autonomous turn.
- [ ] 4.5 Await the step outcome, cancel any in-flight turn, and tear down the session and subprocess.
- [ ] 4.6 Implement the three failure detections and build the `RunSummary`; emit banners and status through `RunnerUi`.
- [ ] 4.7 Write unit tests for summary formatting and the failure-classification logic.

## Implementation Details
Create `src/runner.ts` and its test file. Reuse `src/client.ts` (`AcpClient`) unchanged — instantiate a fresh `AcpClient` per step. The subprocess spawn, `ndJsonStream` wiring, `ClientSideConnection`, and session-update handling follow the existing pattern in `src/index.ts`; reference TechSpec "System Architecture" data-flow steps 3-8 and ADR-001/ADR-003 rather than duplicating code. `RunnerUi` is the callback surface so this module performs no rendering itself — Task 5 supplies the TUI-backed implementation. Keep summary formatting and failure classification as pure functions so they are unit-testable without a live ACP connection.

### Relevant Files
- `src/index.ts` — current single-session client; the source pattern for subprocess spawn, stream wiring, and `handleSessionUpdate`.
- `src/client.ts` — `AcpClient` and `ClientHandlers`; reused as-is, one fresh instance per step.
- `src/workflow.ts` — `Workflow`/`Step` types (Task 2).
- `src/mcp.ts` — `WorkflowMcpServer`, `StepOutcome`, `StepContext` (Task 3).
- `node_modules/@agentclientprotocol/sdk` — `ClientSideConnection`, `newSession`, `setSessionMode`, `unstable_setSessionModel`, `initialize`, `cancel`.

### Dependent Files
- `src/index.ts` — rewritten in Task 5; calls `runWorkflow` and implements `RunnerUi`.

### Related ADRs
- [ADR-001: Step-sequenced TUI runner as the workflow execution model](adrs/adr-001.md) — fresh session per step, halt-and-report, end-of-run summary.
- [ADR-003: Step `agent` maps to an ACP session mode; `mode` is runner-side control](adrs/adr-003.md) — the `setSessionMode`/`setSessionModel` binding and the interactive/autonomous turn handling.
- [ADR-002: In-process HTTP MCP server for the handoff and finish tools](adrs/adr-002.md) — how the runner receives outcomes via `beginStep`.

## Deliverables
- `src/runner.ts` exporting `runWorkflow`, `RunOptions`, `RunSummary`, and `RunnerUi`.
- A test file covering summary formatting and failure classification.
- Unit tests with 80%+ coverage of the pure logic in `src/runner.ts` **(REQUIRED)**.
- Integration coverage of the per-step lifecycle is exercised by the Task 5 manual E2E procedure **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Summary formatting: a `RunSummary` with `visited: ["step-1","step-3"]` renders a summary text listing both ids in order plus the finish message and duration.
  - [ ] Summary formatting: a `RunSummary` with a `failure` renders the failing step id and reason instead of a finish message.
  - [ ] Failure classification: an undeclared handoff target produces a `failure` outcome naming the step and target.
  - [ ] Failure classification: an autonomous kickoff turn completing with no outcome produces a `failure` naming the step.
  - [ ] Failure classification: a subprocess `exit` event produces a `failure` naming the step and exit code.
- Integration tests:
  - [ ] Per-step session setup (spawn → initialize → newSession → setSessionMode/setSessionModel → kickoff) is verified end-to-end through the Task 5 manual E2E run of `workflows/who-is.json`.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80% for the pure logic in `src/runner.ts`
- `runWorkflow` advances steps on `handoff`, ends on `finish`, and halts-and-reports on each of the three failure modes
- `bun run typecheck` exits 0
