---
status: completed
title: probeIdeCatalog ACP discovery probe
type: backend
complexity: medium
dependencies: []
---

# Task 4: probeIdeCatalog ACP discovery probe

## Overview
Implement the infra-layer probe that spawns a selected IDE over ACP, reads its
available agents and models from a single `newSession` response, and disposes the
subprocess — returning a graceful result that never throws for an unreachable
IDE. This is the engine behind the catalog endpoint (task_05) and the editor's
agent/model suggestions.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add `src/infra/acp/ide-catalog.ts` exporting `probeIdeCatalog(ide, cwd, opts?)` returning `{ reachable, agents: {id,name}[], models: {id,name}[], reason? }` (see TechSpec "Core Interfaces").
- MUST resolve the IDE via `resolveIdeProfile`; an unknown IDE MUST surface distinctly (throw `UnknownIdeError`) so the route can return 400, separate from `reachable:false`.
- MUST read agents via the existing `availableModeIds` logic and models via `newSession().models?.availableModels`, mapping each to `{ id, name }`.
- MUST enforce a hard timeout (default ~10s, overridable via `opts.timeoutMs`) and resolve to `reachable:false` with a `reason` on any spawn error, timeout, auth failure, or malformed response.
- MUST dispose the subprocess (SIGTERM→SIGKILL) in all paths, reusing the disposal approach from `AgentSession`, and MUST accept an injectable `spawnFn` for testing.
- MUST NOT register MCP servers, send a kickoff prompt, or require HTTP MCP capability (discovery is lighter than a run session).
</requirements>

## Subtasks
- [x] 4.1 Spawn the profile command and establish an ACP `ClientSideConnection`.
- [x] 4.2 `initialize` then `newSession({ cwd, mcpServers: [] })`; extract agents and models.
- [x] 4.3 Wrap the probe in a timeout and a try/finally that always disposes the subprocess.
- [x] 4.4 Map all failure modes to a graceful `reachable:false` result; rethrow only `UnknownIdeError`.
- [x] 4.5 Test reachable, unreachable (spawn error), timeout, and unknown-ide paths with an injected spawn/stub agent.

## Implementation Details
Reuse the spawn + `ndJsonStream` + `ClientSideConnection` setup from
`agent-session.ts`, but strip it to discovery: no `tools`, no step token, no
prompt. A minimal `AcpClient` (handlers can be near-empty) satisfies the
connection. `availableModeIds` is already exported from `ide-profiles.ts`. For
the stub-agent test, follow the fake-ACP-process approach in
`agent-session.test.ts`. See TechSpec "Integration Points" and ADR-005.

### Relevant Files
- `src/infra/acp/agent-session.ts` — spawn/connect/init/newSession/dispose patterns to adapt.
- `src/infra/acp/ide-profiles.ts` — `resolveIdeProfile`, `availableModeIds`, profile spawn specs.
- `src/infra/acp/ide-profile.ts` — `IdeProfile`, `UnknownIdeError`.
- `src/infra/acp/acp-client.ts` — minimal client handler shape.
- `src/infra/acp/agent-session.test.ts` — stub ACP agent test harness pattern.

### Dependent Files
- `src/app/api/routes/ide-catalog.ts` (task_05) — wraps this probe.

### Related ADRs
- [ADR-005: Live IDE catalog discovery via a lightweight ACP probe, graceful by design](../adrs/adr-005.md) — the probe's contract and failure semantics.
- [ADR-002: Live per-IDE discovery of agents and models, with manual override](../adrs/adr-002.md) — no caching, manual fallback.

## Deliverables
- `ide-catalog.ts` exporting `probeIdeCatalog` and its result types.
- Hard timeout + guaranteed subprocess disposal.
- Unit tests with 80%+ coverage **(REQUIRED)**.
- Integration tests against a stub ACP agent process **(REQUIRED)**.

## Tests
- Unit tests:
  - [x] Stub agent advertising two modes and two models → `reachable:true` with mapped `{id,name}` entries.
  - [x] Injected `spawnFn` that errors on spawn → `reachable:false` with a `reason`, no throw.
  - [x] Stub agent that never responds → timeout fires → `reachable:false`; subprocess is killed.
  - [x] Unknown ide id → throws `UnknownIdeError` (not a `reachable:false` result).
  - [x] opencode-style `configOptions` mode advertisement is read via `availableModeIds`.
- Integration tests:
  - [x] End-to-end against a stub ndjson ACP process: initialize → newSession → agents+models returned → process disposed.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No leaked subprocesses after any code path (success, failure, timeout)
- Never throws except for `UnknownIdeError`
