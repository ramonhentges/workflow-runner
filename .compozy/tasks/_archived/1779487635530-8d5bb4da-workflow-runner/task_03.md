---
status: completed
title: In-process HTTP MCP server (handoff + finish)
type: backend
complexity: high
dependencies:
    - task_01
    - task_02
---

# Task 3: In-process HTTP MCP server (handoff + finish)

## Overview
Each step's agent controls the workflow's path by calling two tools — `handoff` and `finish`. This task builds the in-process HTTP MCP server that hosts those tools, so a tool call resolves the runner's orchestration loop directly with no separate process or IPC channel.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create `src/mcp.ts` exporting `createWorkflowMcpServer()` and the `WorkflowMcpServer` interface from the TechSpec "Core Interfaces" section.
- MUST declare the `StepOutcome` and `StepContext` control types in `src/mcp.ts` so the module dependency graph stays one-directional (`workflow.ts` → `mcp.ts` → `runner.ts`); the TechSpec lists these under `runner.ts`, but co-locating them with their producer avoids a circular import.
- The server MUST listen on `127.0.0.1` on an ephemeral port and expose its URL as `http://127.0.0.1:<port>/mcp` before any session is created.
- MUST expose a `handoff` tool whose `next_step` is constrained to the current step's `edges[].next_step` values, with each edge `intent` surfaced in the tool/parameter description; `handoff` MUST be omitted when the current step has no edges.
- MUST expose a `finish` tool accepting `{ message }`, always available regardless of edges.
- `beginStep(step, resolve)` MUST arm the tools for the given step and register the outcome resolver; a `handoff` to an undeclared target MUST resolve a `failure` outcome.
- MUST export the pure edge-validation function used by the `handoff` handler so it is unit-testable without starting a server.
- `close()` MUST shut the HTTP server down cleanly.

## Subtasks
- [ ] 3.1 Declare `StepOutcome`, `StepContext`, and `WorkflowMcpServer` types in `src/mcp.ts`.
- [ ] 3.2 Stand up an `@modelcontextprotocol/sdk` Streamable HTTP server bound to an ephemeral `127.0.0.1` port and expose its URL.
- [ ] 3.3 Register the `handoff` and `finish` tools with per-step dynamic schemas derived from the armed step's edges.
- [ ] 3.4 Implement `beginStep` to set the current step and outcome resolver, and the handlers to resolve `handoff`/`finish`/`failure` outcomes.
- [ ] 3.5 Extract a pure `resolveHandoffTarget`/edge-validation function and implement `close()`.
- [ ] 3.6 Write unit tests for the edge-validation function.

## Implementation Details
Create `src/mcp.ts` and its test file. Use the `@modelcontextprotocol/sdk` Streamable HTTP transport (added in Task 1). Steps run strictly one at a time, so a single shared server with handlers that close over a mutable "current step" is sufficient — see TechSpec "API Endpoints" and ADR-002 "Implementation Notes". `beginStep` is called by Task 4's runner before each `newSession`; the tool list is regenerated per session because each step opens a new session. The `handoff` handler validates `next_step` against the current step's edges via the extracted pure function and resolves `{ kind: "handoff" }` on success or `{ kind: "failure" }` on an undeclared target; `finish` resolves `{ kind: "finish", message }`.

### Relevant Files
- `package.json` — must already declare `@modelcontextprotocol/sdk` (Task 1).
- `src/workflow.ts` — source of the `Step` and `Edge` types (Task 2).
- `workflows/who-is.json` — `step-1` (two edges) and `step-2`/`step-3` (no edges) exercise both the with-edges and edges-less tool shapes.

### Dependent Files
- `src/runner.ts` — created in Task 4; calls `createWorkflowMcpServer`, `beginStep`, and `close`, and imports `StepOutcome`/`StepContext`.
- `src/index.ts` — rewritten in Task 5; constructs the server once per run and passes its URL into `newSession`.

### Related ADRs
- [ADR-002: In-process HTTP MCP server for the handoff and finish tools](adrs/adr-002.md) — directly implemented by this task.
- [ADR-001: Step-sequenced TUI runner as the workflow execution model](adrs/adr-001.md) — establishes the one-step-at-a-time execution this server assumes.

## Deliverables
- `src/mcp.ts` exporting `createWorkflowMcpServer`, `WorkflowMcpServer`, `StepOutcome`, `StepContext`, and the pure edge-validation function.
- A test file covering the edge-validation function.
- Unit tests with 80%+ coverage of the pure logic in `src/mcp.ts` **(REQUIRED)**.
- Integration test confirming the server starts, lists tools for an armed step, and resolves an outcome **(REQUIRED)**.

## Tests
- Unit tests:
  - [ ] Edge validation: a `next_step` listed in the armed step's edges resolves to that edge.
  - [ ] Edge validation: a `next_step` absent from the armed step's edges is rejected.
  - [ ] Edge validation: any `next_step` against a step with no edges is rejected.
- Integration tests:
  - [ ] `createWorkflowMcpServer()` returns a `url` matching `http://127.0.0.1:<port>/mcp`.
  - [ ] After `beginStep` on a step with two edges, an MCP `tools/list` returns both `handoff` and `finish`, with `handoff`'s `next_step` enum equal to the two edge targets.
  - [ ] After `beginStep` on an edges-less step, `tools/list` returns only `finish`.
  - [ ] Calling `handoff` with a declared target resolves the registered resolver with `{ kind: "handoff" }`; calling it with an undeclared target resolves `{ kind: "failure" }`.
  - [ ] Calling `finish` resolves the resolver with `{ kind: "finish", message }`; `close()` releases the port.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80% for the pure logic in `src/mcp.ts`
- The server arms per-step tools correctly and resolves handoff/finish/failure outcomes
- `bun run typecheck` exits 0
