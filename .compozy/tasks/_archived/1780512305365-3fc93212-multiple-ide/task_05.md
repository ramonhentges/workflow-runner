---
status: completed
title: Codex CLI IDE profile
type: backend
complexity: medium
dependencies:
  - task_01
  - task_02
---

# Task 5: Codex CLI IDE profile

## Overview
Add a Codex CLI profile so steps can declare `"ide": "codex"` and run on Codex over ACP
at full parity (persona/agent, model, interactive + autonomous, handoff/finish). This
task confirms and encodes how Codex's ACP surface maps to the step's `agent` and
`model` fields.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST register a profile under the `ide` id used for Codex (e.g. `codex`) in the registry.
- The profile's `spawn` MUST invoke Codex's ACP entrypoint with the correct command/args/env (confirm the exact invocation before implementing).
- `configureSession` MUST map `step.agent` (persona) and `step.model` onto Codex's ACP surface, and MUST throw a clear, step-named error when a requested persona/model is unsupported rather than silently ignoring it.
- The profile MUST support both interactive and autonomous modes and the handoff/finish flow with no profile-specific changes to the shared lifecycle.
- MUST NOT modify the shared `AgentSession` lifecycle or the runner/MCP contract.
</requirements>

## Subtasks
- [x] 5.1 Confirm Codex's ACP entrypoint (command/args/env) and persona/model selection mechanism.
- [x] 5.2 Add the Codex `spawn` spec to the registry.
- [x] 5.3 Implement `configureSession` for Codex's mode/model mapping.
- [x] 5.4 Define behavior when a requested persona/model is unsupported (clear step error).
- [x] 5.5 Add unit tests for registration and the mapping/error behavior.

## Implementation Details
Add the profile to `src/infra/acp/ide-profiles.ts` following the opencode profile's
shape from task_01. Only `spawn` and `configureSession` differ. Codex's persona/model
selection may not match opencode's `configOptions`/`setSessionMode` model;
`configureSession` absorbs the difference. The exact mapping is the PRD open question
for Codex and must be settled here; real behavior is verified in the manual E2E
(task_07). See TechSpec "Integration Points" and "Core Interfaces".

### Relevant Files
- `src/infra/acp/ide-profiles.ts` — registry to extend with the Codex profile.
- `src/infra/acp/ide-profile.ts` — the `IdeProfile`/`IdeSpawnSpec` contract to satisfy.
- `src/infra/acp/agent-session.ts` — consumes the profile (no change here; reference for the lifecycle contract).

### Dependent Files
- `src/infra/acp/ide-profiles.test.ts` — registry tests extended to cover the new id.

### Related ADRs
- [ADR-002: IdeProfile registry with a dispatching session factory](../adrs/adr-002.md) — per-profile `configureSession` owns the per-agent mapping.
- [ADR-001: Per-step IDE selection with unified full-parity step schema](../adrs/adr-001.md) — full parity; unsupported fields surface as clear errors.

## Deliverables
- A registered Codex profile (`spawn` + `configureSession`).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for the profile's registration and mapping behavior **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `resolveIdeProfile("codex")` returns a profile whose `id` matches and whose `spawn.command` is the confirmed Codex entrypoint.
  - [x] `configureSession` issues the expected persona-selection call for a valid `step.agent` on a stub connection.
  - [x] `configureSession` issues the expected model-selection call for a valid `step.model` on a stub connection.
  - [x] `configureSession` throws a step-named error when `step.agent`/`step.model` is unsupported by Codex.
- Integration tests:
  - [x] A `Runner` run of a single autonomous `codex` step (with a stubbed/faked connection) reaches a `finish`/`handoff` outcome through the shared lifecycle unchanged.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A step with `"ide": "codex"` selects persona and model and runs in both modes.
- Unsupported persona/model produces a clear, step-named error (no silent divergence).
