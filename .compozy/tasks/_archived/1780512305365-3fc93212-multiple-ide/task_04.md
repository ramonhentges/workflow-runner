---
status: completed
title: Claude Code IDE profile
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 4: Claude Code IDE profile

## Overview
Add a Claude Code profile so steps can declare `"ide": "claude-code"` and run on
Claude Code over ACP at full parity (persona/agent, model, interactive + autonomous,
handoff/finish). This task confirms and encodes how Claude Code's ACP surface maps to
the step's `agent` and `model` fields.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register a profile under the `ide` id used for Claude Code (e.g. `claude-code`) in the registry.
- The profile's `spawn` MUST invoke Claude Code's ACP entrypoint with the correct command/args/env (confirm the exact bridge invocation before implementing).
- `configureSession` MUST map `step.agent` (persona) and `step.model` onto Claude Code's ACP surface, and MUST throw a clear, step-named error when a requested persona/model is unsupported rather than silently ignoring it.
- The profile MUST support both interactive and autonomous modes and the handoff/finish flow with no profile-specific changes to the shared lifecycle.
- MUST NOT modify the shared `AgentSession` lifecycle or the runner/MCP contract.

</requirements>

## Subtasks
- [x] 4.1 Confirm Claude Code's ACP entrypoint (command/args/env) and persona/model selection mechanism.
- [x] 4.2 Add the Claude Code `spawn` spec to the registry.
- [x] 4.3 Implement `configureSession` for Claude Code's mode/model mapping.
- [x] 4.4 Define behavior when a requested persona/model is unsupported (clear step error).
- [x] 4.5 Add unit tests for registration and the mapping/error behavior.

## Implementation Details
Add the profile to `src/infra/acp/ide-profiles.ts` following the opencode profile's
shape from task_01. The differences are isolated to `spawn` and `configureSession`;
no other code changes. Where Claude Code's ACP surface differs from opencode's
`configOptions`/`setSessionMode` model, `configureSession` absorbs that. The exact
agent/model mapping is the PRD open question for Claude Code and must be settled here;
real behavior is verified in the manual E2E (task_07). See TechSpec "Integration Points"
and "Core Interfaces".

### Relevant Files
- `src/infra/acp/ide-profiles.ts` — registry to extend with the Claude Code profile.
- `src/infra/acp/ide-profile.ts` — the `IdeProfile`/`IdeSpawnSpec` contract to satisfy.
- `src/infra/acp/agent-session.ts` — consumes the profile (no change here; reference for the lifecycle contract).

### Dependent Files
- `src/infra/acp/ide-profiles.test.ts` — registry tests extended to cover the new id.

### Related ADRs
- [ADR-002: IdeProfile registry with a dispatching session factory](../adrs/adr-002.md) — per-profile `configureSession` owns the per-agent mapping.
- [ADR-001: Per-step IDE selection with unified full-parity step schema](../adrs/adr-001.md) — full parity; unsupported fields surface as clear errors.

## Deliverables
- A registered Claude Code profile (`spawn` + `configureSession`).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the profile's registration and mapping behavior **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `resolveIdeProfile("claude-code")` returns a profile whose `id` matches and whose `spawn.command` is the confirmed Claude Code entrypoint.
  - [x] `configureSession` issues the expected persona-selection call for a valid `step.agent` on a stub connection.
  - [x] `configureSession` issues the expected model-selection call for a valid `step.model` on a stub connection.
  - [x] `configureSession` throws a step-named error when `step.agent`/`step.model` is unsupported by Claude Code.
- Integration tests:
  - [x] A `Runner` run of a single autonomous `claude-code` step (with a stubbed/faked connection) reaches a `finish`/`handoff` outcome through the shared lifecycle unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A step with `"ide": "claude-code"` selects persona and model and runs in both modes.
- Unsupported persona/model produces a clear, step-named error (no silent divergence).
