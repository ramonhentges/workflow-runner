---
status: completed
title: Gemini CLI IDE profile
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 6: Gemini CLI IDE profile

## Overview
Add a Gemini CLI profile so steps can declare `"ide": "gemini"` and run on Gemini over
ACP at full parity (persona/agent, model, interactive + autonomous, handoff/finish).
Gemini CLI is the reference ACP implementation, so its surface is the closest to
standard ACP; this task confirms and encodes its mapping to the step's `agent`/`model`.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register a profile under the `ide` id used for Gemini (e.g. `gemini`) in the registry.
- The profile's `spawn` MUST invoke Gemini CLI's ACP entrypoint with the correct command/args/env (confirm the exact invocation before implementing).
- `configureSession` MUST map `step.agent` (persona) and `step.model` onto Gemini's ACP surface, and MUST throw a clear, step-named error when a requested persona/model is unsupported rather than silently ignoring it.
- The profile MUST support both interactive and autonomous modes and the handoff/finish flow with no profile-specific changes to the shared lifecycle.
- MUST NOT modify the shared `AgentSession` lifecycle or the runner/MCP contract.
</requirements>

## Subtasks
- [ ] 6.1 Confirm Gemini CLI's ACP entrypoint (command/args/env) and persona/model selection mechanism.
- [ ] 6.2 Add the Gemini `spawn` spec to the registry.
- [ ] 6.3 Implement `configureSession` for Gemini's mode/model mapping (likely standard ACP `modes`).
- [ ] 6.4 Define behavior when a requested persona/model is unsupported (clear step error).
- [ ] 6.5 Add unit tests for registration and the mapping/error behavior.

## Implementation Details
Add the profile to `src/infra/acp/ide-profiles.ts` following the opencode profile's
shape from task_01. As the reference ACP implementation, Gemini likely advertises modes
via the standard `modes.availableModes` field that `availableModeIds` already reads, so
`configureSession` may use `setSessionMode`/model selection directly. Only `spawn` and
`configureSession` differ from other profiles. Real behavior is verified in the manual
E2E (task_07). See TechSpec "Integration Points" and "Core Interfaces".

### Relevant Files
- `src/infra/acp/ide-profiles.ts` — registry to extend with the Gemini profile.
- `src/infra/acp/ide-profile.ts` — the `IdeProfile`/`IdeSpawnSpec` contract to satisfy.
- `src/infra/acp/agent-session.ts` — consumes the profile (no change here; reference for the lifecycle contract).

### Dependent Files
- `src/infra/acp/ide-profiles.test.ts` — registry tests extended to cover the new id.

### Related ADRs
- [ADR-002: IdeProfile registry with a dispatching session factory](../adrs/adr-002.md) — per-profile `configureSession` owns the per-agent mapping.
- [ADR-001: Per-step IDE selection with unified full-parity step schema](../adrs/adr-001.md) — full parity; unsupported fields surface as clear errors.

## Deliverables
- A registered Gemini profile (`spawn` + `configureSession`).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the profile's registration and mapping behavior **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `resolveIdeProfile("gemini")` returns a profile whose `id` matches and whose `spawn.command` is the confirmed Gemini entrypoint.
  - [ ] `configureSession` issues the expected mode-selection call for a valid `step.agent` on a stub connection (standard ACP `setSessionMode`).
  - [ ] `configureSession` issues the expected model-selection call for a valid `step.model` on a stub connection.
  - [ ] `configureSession` throws a step-named error when `step.agent`/`step.model` is unsupported by Gemini.
- Integration tests:
  - [ ] A `Runner` run of a single autonomous `gemini` step (with a stubbed/faked connection) reaches a `finish`/`handoff` outcome through the shared lifecycle unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A step with `"ide": "gemini"` selects persona and model and runs in both modes.
- Unsupported persona/model produces a clear, step-named error (no silent divergence).
