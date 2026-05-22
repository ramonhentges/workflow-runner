---
status: completed
title: CLI entry, TUI, and integration
type: frontend
complexity: high
dependencies:
    - task_01
    - task_02
    - task_03
    - task_04
---

# Task 5: CLI entry, TUI, and integration

## Overview
This task rewrites `src/index.ts` into the workflow runner's entry point: it parses the CLI arguments, builds the persistent TUI, implements the `RunnerUi` callbacks (step banners, log, input show/hide, summary), and wires the MCP server and orchestration runner together into one observable run.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST parse a required `<workflow.json>` path argument and an optional `--start <step-id>` flag; an invalid or missing config MUST halt before any subprocess starts.
- The entry step MUST default to the first step in the config, overridden by `--start` when given.
- MUST construct one persistent TUI for the whole run, reusing the existing OpenTUI layout (header/status, scrollable log, input bar).
- MUST implement `RunnerUi`: `banner` renders a step banner (id, agent, model, mode); `setInteractive` shows the input field for interactive steps and hides it for autonomous steps; `summary` renders the end-of-run summary and keeps the TUI open.
- MUST create the in-process MCP server once via `createWorkflowMcpServer`, pass it into `runWorkflow`, and `close()` it during cleanup.
- MUST route TUI input to the active interactive step's turn and ignore input while a step is autonomous.
- MUST exit with status `0` on `finish` and a non-zero status on any failure, after the summary is shown.

## Subtasks
- [ ] 5.1 Implement CLI parsing for the workflow path and `--start`, with validation and clear errors.
- [ ] 5.2 Build the persistent TUI layout, adapting the existing OpenTUI header/log/input structure.
- [ ] 5.3 Implement the `RunnerUi` callbacks: banner, log, status, input show/hide, summary.
- [ ] 5.4 Create the MCP server, call `runWorkflow`, and manage process lifecycle and cleanup (server `close`, subprocess kill, renderer destroy).
- [ ] 5.5 Wire interactive input routing and set the process exit code from the `RunSummary`.
- [ ] 5.6 Run and document the manual end-to-end procedure against `workflows/who-is.json`.

## Implementation Details
Rewrite `src/index.ts`. The existing file already contains the OpenTUI layout, streaming session-update rendering, permission handling, and file read/write handlers — reuse those building blocks; the change is from a single hard-coded session to a `RunnerUi`-driven multi-step run. CLI argument `argv[2]` becomes the workflow path (previously the cwd); the session cwd is `process.cwd()`. Reference TechSpec "System Architecture" and "Monitoring and Observability"; do not reimplement orchestration — delegate to `runWorkflow` from Task 4. The integration tests for this task are the documented manual E2E procedure, since the TUI + ACP + MCP flow is not unit-testable.

### Relevant Files
- `src/index.ts` — the file rewritten by this task; current single-session client and OpenTUI layout to adapt.
- `src/runner.ts` — `runWorkflow`, `RunOptions`, `RunSummary`, `RunnerUi` (Task 4).
- `src/mcp.ts` — `createWorkflowMcpServer` (Task 3).
- `src/workflow.ts` — `loadWorkflow` and the `--start` resolution (Task 2).
- `src/client.ts` — `AcpClient`; still used per step inside `runWorkflow`.
- `workflows/who-is.json` — the fixture for the manual E2E procedure.

### Dependent Files
- `package.json` — the `dev` script (`bun src/index.ts`) now expects a workflow path argument; usage in docs/README should reflect `bun src/index.ts workflows/who-is.json`.

### Related ADRs
- [ADR-001: Step-sequenced TUI runner as the workflow execution model](adrs/adr-001.md) — one persistent TUI, step banners, summary stays open.
- [ADR-003: Step `agent` maps to an ACP session mode; `mode` is runner-side control](adrs/adr-003.md) — `mode` drives input-field visibility here.

## Deliverables
- Rewritten `src/index.ts`: CLI parsing, persistent TUI, `RunnerUi` implementation, MCP + runner wiring, exit codes.
- A documented, repeatable manual E2E procedure (in the task notes or a short README section).
- Unit tests with 80%+ coverage for any extracted pure helpers (CLI arg parsing, entry-step resolution) **(REQUIRED)**.
- Integration test: the manual E2E procedure executed successfully against `workflows/who-is.json` **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] CLI parsing: no path argument produces a clear "missing workflow file" error and a non-zero exit.
  - [ ] CLI parsing: `--start step-2` resolves the entry step to `step-2`; `--start step-9` (absent) produces a clear error.
  - [ ] Entry-step resolution: with no `--start`, the entry step is the first step in the config.
- Integration tests:
  - [ ] `bun src/index.ts workflows/who-is.json`: `step-1` shows the input field, routes via user intent, and `./agent.txt` is written; the chosen autonomous step hides the input, streams thinking, writes its file, and finishes; the summary lists visited steps and the TUI stays open.
  - [ ] `bun src/index.ts workflows/who-is.json --start step-2` begins the run at `step-2`.
  - [ ] An invalid config path halts before any `opencode acp` subprocess is spawned, with a clear error and non-zero exit.
  - [ ] A config whose step `agent` is not in `availableModes` halts at that step with a clear message.
- Test coverage target: >=80% (applies to the extracted pure helpers; the TUI/ACP/MCP flow is covered by the manual E2E procedure)
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80% for the extracted pure helpers
- `workflows/who-is.json` runs end-to-end through an interactive and an autonomous step with a correct summary
- Process exits `0` on `finish` and non-zero on failure
- `bun run typecheck` exits 0
