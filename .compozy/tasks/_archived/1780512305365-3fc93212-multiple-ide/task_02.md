---
status: completed
title: Profile-driven AgentSession + dispatching factory
type: refactor
complexity: high
dependencies:
  - task_01
---

# Task 2: Profile-driven AgentSession + dispatching factory

## Overview
Generalize the ACP session so it is driven by an `IdeProfile` instead of hardcoding
opencode, and turn the single `AcpAgentSessionFactory` into a dispatcher that selects a
profile by `step.ide`. This is the core integration that makes per-step IDE selection
actually take effect while leaving the runner, MCP contract, and TUI untouched.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `AgentSession.start` MUST accept a resolved `IdeProfile` and spawn the subprocess from `profile.spawn` (command, args, merged env) instead of the hardcoded `opencode acp`.
- `AgentSession.start` MUST call `profile.configureSession(...)` in place of the inline mode-validation and mode/model-selection code.
- The shared lifecycle (ACP `initialize`, `newSession` with the workflow MCP server + step-token header, kickoff prompt, interactive/autonomous outcome race, `dispose`) MUST remain behaviorally unchanged.
- `AcpAgentSessionFactory` MUST become a dispatching `RunnerAgentSessionFactory` that resolves the profile from `args.step.ide` via `resolveIdeProfile` and delegates to `AgentSession.start`.
- An unrecognized `ide` MUST surface as a step `failure` outcome naming the step and the offending `ide` value (reusing the runner's existing error-to-failure path).
- `daemon.ts:resolveSessionFactory` MUST continue to return a single factory (now the dispatcher); the `FixtureSessionFactory` path MUST be unaffected.
</requirements>

## Subtasks
- [x] 2.1 Parameterize `AgentSession.start` with an `IdeProfile` and spawn from its spec.
- [x] 2.2 Replace inline opencode mode/model logic with a `profile.configureSession` call.
- [x] 2.3 Convert the factory into a dispatcher that resolves by `step.ide`.
- [x] 2.4 Ensure unknown-`ide` resolution becomes a clear step failure via the runner.
- [x] 2.5 Update `daemon.ts` wiring/imports for the generalized factory.
- [x] 2.6 Add tests covering dispatch-by-ide, unknown-ide failure, and preserved opencode behavior.

## Implementation Details
Modify `src/infra/acp/agent-session.ts`: `AgentSession.start(args, profile)` spawns
`profile.spawn`, runs the existing lifecycle, and calls `profile.configureSession`
where the opencode-specific block used to be. Generalize `AcpAgentSessionFactory`
(same file) so `create(args)` does `resolveIdeProfile(args.step.ide)` then
`AgentSession.start(args, profile)`; a thrown `UnknownIdeError` propagates and the
runner's existing `catch` (`src/domain/runner.ts` ~244–252) records the failure naming
the step. Update `src/infra/daemon/daemon.ts` (`resolveSessionFactory`, ~579–588) to
construct/import the generalized factory. Keep the outcome-race and `dispose()` logic
byte-for-byte where possible. See TechSpec "System Architecture" and "Core Interfaces".

### Relevant Files
- `src/infra/acp/agent-session.ts` — `AgentSession.start` and the factory to refactor.
- `src/infra/acp/ide-profiles.ts` — `resolveIdeProfile` and profiles (from task_01).
- `src/domain/runner.ts` — existing error-to-`failure` path that turns thrown errors into named step failures.
- `src/infra/daemon/daemon.ts` — `resolveSessionFactory` construction point.

### Dependent Files
- `src/infra/daemon/run-manager.ts` — passes the factory to every `Runner`; unchanged but exercised.
- `src/infra/daemon/test-helpers/fixture-session-factory.ts` — alternate factory; must stay compatible with the port.

### Related ADRs
- [ADR-002: IdeProfile registry with a dispatching session factory](../adrs/adr-002.md) — mandates one generalized `AgentSession` + dispatching factory.
- [ADR-001: Per-step IDE selection with unified full-parity step schema](../adrs/adr-001.md) — fail-at-the-step behavior for bad `ide`.

## Deliverables
- Refactored `AgentSession.start` accepting an `IdeProfile`.
- Dispatching `RunnerAgentSessionFactory` resolving by `step.ide`.
- Updated `daemon.ts` wiring.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for dispatch and unknown-ide failure **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Factory `create` with `step.ide = "opencode"` spawns using the opencode profile's command/args (assert via injected/stubbed spawn).
  - [x] Factory `create` with an unregistered `step.ide` throws `UnknownIdeError` naming the value.
  - [x] A step whose `ide` is unknown produces a `RunSummary.failure` naming the step and `ide` value when run through `Runner` with the dispatching factory.
- Integration tests:
  - [x] An opencode workflow run via the existing fixture/daemon path completes with no behavioral change — all 790 pre-existing tests continue to pass.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Per-step `ide` selection drives which profile/subprocess is used.
- No regression in opencode runs, the MCP handoff/finish contract, or `dispose` semantics.
