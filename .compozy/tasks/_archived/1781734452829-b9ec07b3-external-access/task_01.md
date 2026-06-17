---
status: completed
title: Add `bindHost` to `RunDaemonOptions` and implement `resolveBindHost()`
type: backend
complexity: low
dependencies: []
---

# Task 01: Add `bindHost` to `RunDaemonOptions` and implement `resolveBindHost()`

## Overview

Add a `bindHost` field to the `RunDaemonOptions` interface and implement `resolveBindHost()`, a pure function that resolves the bind address from explicit option → env var (`WORKFLOW_RUNNER_HOST`) → default (`127.0.0.1`). This is the foundational building block that all subsequent tasks depend on.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `RunDaemonOptions` in `src/infra/daemon/daemon.ts` MUST gain a `bindHost?: string` field with a JSDoc comment matching the existing `apiPort` pattern
- `resolveBindHost()` MUST accept `(opts: RunDaemonOptions, env?: NodeJS.ProcessEnv)` and return a `string`
- Precedence MUST be: `opts.bindHost` > `env.WORKFLOW_RUNNER_HOST` > `DEFAULT_BIND_HOST` ("127.0.0.1")
- `DEFAULT_BIND_HOST` MUST be exported as a named constant, analogous to `DEFAULT_API_PORT` in `security.ts`
- The function MUST be exported for unit testing, matching the `resolveApiPort` export pattern
- No other file changes are required — this task is confined to `src/infra/daemon/daemon.ts`
</requirements>

## Subtasks

- [x] 01.1 Add `DEFAULT_BIND_HOST` constant alongside the imports section
- [x] 01.2 Add `bindHost?: string` to `RunDaemonOptions` interface with JSDoc
- [x] 01.3 Implement `resolveBindHost()` following the exact pattern of `resolveApiPort()`
- [x] 01.4 Write unit tests for `resolveBindHost()` covering all precedence rules

## Implementation Details

See TechSpec "Core Interfaces" section for the exact function signature. The implementation mirrors `resolveApiPort()` at `src/infra/daemon/daemon.ts:53-64` exactly, substituting `bindHost`/`WORKFLOW_RUNNER_HOST`/`DEFAULT_BIND_HOST` for `apiPort`/`WORKFLOW_RUNNER_API_PORT`/`DEFAULT_API_PORT`. No port validation is needed (bind host is a string, not a number).

### Relevant Files

- `src/infra/daemon/daemon.ts` — Add `DEFAULT_BIND_HOST`, extend `RunDaemonOptions`, implement `resolveBindHost()`

### Dependent Files

- `src/infra/daemon/daemon.ts` — The only file changed; no other files depend on this task yet
- `src/infra/daemon/daemon.test.ts` — New test block for `resolveBindHost()`

### Related ADRs

- [ADR-001: Configurable bind address for external access](../adrs/adr-001.md) — Selected the minimal approach; this task implements the core interface and resolution function

## Deliverables

- `DEFAULT_BIND_HOST` exported constant in `src/infra/daemon/daemon.ts`
- `bindHost` field on `RunDaemonOptions`
- `resolveBindHost()` exported function
- Unit tests for `resolveBindHost()` covering all precedence cases
- No regressions in existing tests

## Tests

- Unit tests:
  - [ ] "returns the explicit `opts.bindHost` when provided, ignoring env" — mirrors `resolveApiPort` opt-overrides-env test
  - [ ] "returns the `WORKFLOW_RUNNER_HOST` env value when no opt is given"
  - [ ] "falls back to `DEFAULT_BIND_HOST` when neither opt nor env is set"
  - [ ] "ignores an empty-string env value and falls back to default"
  - [ ] "accepts `0.0.0.0` as a valid bind host"
  - [ ] "accepts an IPv6 address like `::` as a valid bind host"
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- `resolveBindHost()` correctly implements flag > env > default precedence
- Existing `resolveApiPort` and `assertLoopbackBind` tests continue to pass
