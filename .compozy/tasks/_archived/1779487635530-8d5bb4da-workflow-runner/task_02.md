---
status: completed
title: Workflow config types and loader
type: backend
complexity: medium
dependencies: []
---

# Task 2: Workflow config types and loader

## Overview
The runner is driven by a workflow JSON config such as `workflows/who-is.json`. This task creates the typed model of that config and a loader that parses and fully validates a workflow file, failing fast with a clear error before any agent subprocess is started.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST create `src/workflow.ts` exporting the `Workflow`, `Step`, and `Edge` types defined in the TechSpec "Core Interfaces" section.
- MUST export an async `loadWorkflow(path)` that reads, JSON-parses, and validates a workflow file.
- MUST export a `WorkflowConfigError` whose message names the offending step and field.
- Validation MUST reject: malformed JSON; an empty or missing `steps` array; any step missing a non-empty `id`, `agent`, or `model`; any step whose `mode` is not exactly `interactive` or `autonomous`; duplicate step `id`s; any `edge.next_step` that does not reference an existing step `id`.
- `loadWorkflow` MUST resolve the valid `workflows/who-is.json` config without error.
- The loader MUST NOT spawn processes, open sessions, or perform any side effect beyond reading the given file.

## Subtasks
- [x] 2.1 Define the `Edge`, `Step`, and `Workflow` interfaces in `src/workflow.ts`.
- [x] 2.2 Define the `WorkflowConfigError` error type carrying the offending step/field.
- [x] 2.3 Implement `loadWorkflow(path)`: read file, parse JSON, run all validation rules.
- [x] 2.4 Implement validation covering structural, per-step, uniqueness, and edge-reference rules.
- [x] 2.5 Write `src/workflow.test.ts` covering the valid config and every rejection case.

## Implementation Details
Create `src/workflow.ts` and `src/workflow.test.ts`. The module is pure logic with no dependency on ACP, MCP, or the TUI. Use the interface shapes and the full validation rule list from the TechSpec "Core Interfaces" and "Data Models" sections — reference them rather than reinventing the field set. The config shape mirrors `workflows/who-is.json` exactly (`id`, `name`, `description`, `version`, `steps[]`; each step has `id`, `agent`, `description`, `mode`, `ide`, `model`, `edges[]`).

### Relevant Files
- `workflows/who-is.json` — the canonical valid config; the loader must accept it and tests use its shape as a fixture.
- `src/index.ts` — existing module; shows project TypeScript style (strict, NodeNext, explicit types).
- `tsconfig.json` — strict mode is on; the loader must compile with no implicit `any`.

### Dependent Files
- `src/mcp.ts` — created in Task 3; imports `Step` and `Edge`.
- `src/runner.ts` — created in Task 4; imports `Workflow` and `Step`, and calls `loadWorkflow` indirectly via Task 5.
- `src/index.ts` — rewritten in Task 5; calls `loadWorkflow` and resolves the `--start` step.

### Related ADRs
- [ADR-001: Step-sequenced TUI runner as the workflow execution model](adrs/adr-001.md) — the step/edge model this config encodes.

## Deliverables
- `src/workflow.ts` exporting `Workflow`, `Step`, `Edge`, `WorkflowConfigError`, and `loadWorkflow`.
- `src/workflow.test.ts` with the unit tests below.
- Unit tests with 80%+ coverage of `src/workflow.ts` **(REQUIRED)**.
- Integration test confirming `workflows/who-is.json` loads successfully **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Valid config: a `who-is.json`-shaped object loads and returns a `Workflow` with 3 steps.
  - [x] Malformed JSON: a file with a trailing comma throws `WorkflowConfigError`.
  - [x] Empty steps: `steps: []` throws `WorkflowConfigError` naming `steps`.
  - [x] Missing field: a step with no `agent` throws `WorkflowConfigError` naming that step id and `agent`.
  - [x] Invalid mode: a step with `mode: "auto"` throws `WorkflowConfigError` naming that step id and `mode`.
  - [x] Duplicate ids: two steps with `id: "step-1"` throws `WorkflowConfigError` naming the duplicate.
  - [x] Dangling edge: an `edge.next_step` of `step-9` with no such step throws `WorkflowConfigError` naming the edge.
- Integration tests:
  - [x] `loadWorkflow("workflows/who-is.json")` resolves and the result deep-equals the on-disk config.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80% for `src/workflow.ts`
- `loadWorkflow` accepts `workflows/who-is.json` and rejects every documented invalid case with a field-naming error
- `bun run typecheck` exits 0
