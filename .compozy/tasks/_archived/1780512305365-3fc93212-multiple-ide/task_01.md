---
status: completed
title: IdeProfile contract, registry & opencode profile
type: backend
complexity: medium
dependencies: []
---

# Task 1: IdeProfile contract, registry & opencode profile

## Overview
Introduce the `IdeProfile` abstraction that captures everything that differs per coding
agent (spawn descriptor + a `configureSession` hook), a static registry that maps a
step's `ide` value to its profile, and the opencode profile built by extracting today's
inline opencode-specific logic. This is the foundation every other IDE builds on.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST define `IdeProfile`, `IdeSpawnSpec`, and `UnknownIdeError` matching the TechSpec "Core Interfaces" section.
- MUST provide a static registry plus `resolveIdeProfile(ide)` that returns the profile for a known id and throws `UnknownIdeError` (naming the value) for an unknown id.
- MUST register an `opencode` profile whose `spawn` is `opencode acp` with env `OPENCODE_ENABLE_QUESTION_TOOL=1`.
- The opencode profile's `configureSession` MUST reproduce current behavior: validate `step.agent` against the session's available mode ids and throw a clear, step-named error when invalid; set the session mode to `step.agent`; set the session model to `step.model`.
- MUST move the existing `availableModeIds` helper into the opencode profile module and keep its `configOptions`/standard-`modes` fallback behavior.
- MUST NOT add a new package or directory; new files live under `src/infra/acp/`.
</requirements>

## Subtasks
- [x] 1.1 Define the `IdeProfile`/`IdeSpawnSpec`/`UnknownIdeError` types in a new `ide-profile.ts`.
- [x] 1.2 Create the registry module with the supported-id map and `resolveIdeProfile`.
- [x] 1.3 Implement the opencode profile (spawn spec + `configureSession`), relocating `availableModeIds`.
- [x] 1.4 Preserve the existing mode-validation and mode/model-selection error messages.
- [x] 1.5 Add unit tests for registry resolution, unknown-id failure, and the mode/model mapping.

## Implementation Details
Create `src/infra/acp/ide-profile.ts` (types) and `src/infra/acp/ide-profiles.ts`
(registry + opencode profile). The opencode `configureSession` takes the ACP
`connection`, `sessionId`, the `newSession` result, the `step`, and a `log` callback —
see the TechSpec "Core Interfaces" section for the exact signature. The mode-validation,
`setSessionMode`, and `unstable_setSessionModel` calls currently inline in
`agent-session.ts` (`AgentSession.start`) move here verbatim, as does `availableModeIds`.
This task only defines and unit-tests these constructs; wiring them into the session
lifecycle is task_02.

### Relevant Files
- `src/infra/acp/agent-session.ts` — source of the opencode logic to extract (`availableModeIds`, lines ~73–87; mode/model selection ~266–293).
- `src/domain/workflow.ts` — `Step` type consumed by `configureSession`.
- `src/domain/ids.ts` — `SessionId` brand used in the interface.

### Dependent Files
- `src/infra/acp/agent-session.ts` — will consume profiles in task_02 (not modified here beyond what task_02 does).

### Related ADRs
- [ADR-002: IdeProfile registry with a dispatching session factory](../adrs/adr-002.md) — defines this exact abstraction and the per-profile `configureSession` decision.

## Deliverables
- `src/infra/acp/ide-profile.ts` with `IdeProfile`, `IdeSpawnSpec`, `UnknownIdeError`.
- `src/infra/acp/ide-profiles.ts` with the registry, `resolveIdeProfile`, and the opencode profile (incl. relocated `availableModeIds`).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for registry resolution and opencode `configureSession` behavior **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `resolveIdeProfile("opencode")` returns a profile whose `id` is `"opencode"`.
  - [x] `resolveIdeProfile("nonsense")` throws `UnknownIdeError` whose message contains `"nonsense"`.
  - [x] `availableModeIds` returns ids from standard `modes.availableModes` when present.
  - [x] `availableModeIds` falls back to the `configOptions` "mode" select (flattening groups) when `modes` is absent.
  - [x] opencode `configureSession` throws a step-named error when `step.agent` is not in the available mode ids.
  - [x] opencode `configureSession` calls `setSessionMode` with `step.agent` and the model setter with `step.model` on a stub connection for a valid mode.
- Integration tests:
  - [x] Registry exposes exactly the supported ids registered so far and each entry's `spawn.command` is non-empty.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Opencode behavior (mode validation, mode/model selection) is reproducible purely through its profile.
- `resolveIdeProfile` cleanly distinguishes known vs unknown ids.
