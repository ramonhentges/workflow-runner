# TechSpec: Multiple IDE Support (Per-Step Agent Selection)

## Executive Summary

The runner already passes the full `step` to `RunnerAgentSessionFactory.create()`, and
the ACP session lifecycle in `AgentSession.start` (initialize → newSession with the
workflow MCP server → kickoff → interactive/autonomous outcome race → dispose) is
already agent-agnostic. The only opencode-specific logic is the spawn command/env and
the mode/model selection. This change extracts those differences into an `IdeProfile`
(spawn descriptor + a `configureSession` hook), registers one profile per supported
agent in a static table, and replaces the single hardcoded factory with a dispatching
factory that selects a profile by `step.ide`. Supported agents: opencode, Claude Code,
Codex CLI, Gemini CLI, each at full parity (persona/agent, model, interactive +
autonomous, handoff/finish).

The primary trade-off: composition via a profile table keeps the shared lifecycle
single-sourced and makes adding an agent a one-entry change, but it concentrates each
agent's ACP quirks in a per-agent `configureSession` that must track that agent's
bridge as it evolves. We accept that over duplicating the lifecycle per agent
(see ADR-002). `ide` becomes required; an unrecognized or unavailable agent fails at
the step via the runner's existing failure path, preserving earlier steps' work.

## System Architecture

### Component Overview

- **`IdeProfile`** (new, `src/infra/acp/ide-profile.ts`) — value describing one agent:
  a `spawn` descriptor (command, args, env additions) and a `configureSession`
  function that maps `step.agent`/`step.model` onto that agent's ACP surface. Pure
  description + one async hook; no lifecycle logic.
- **Profile registry** (new, `src/infra/acp/ide-profiles.ts`) — static `Map<string, IdeProfile>`
  with the four supported agents. `resolveIdeProfile(ide)` returns the profile or
  throws `UnknownIdeError`.
- **`AgentSession`** (modified, `src/infra/acp/agent-session.ts`) — `start()` becomes
  profile-driven: spawns from `profile.spawn`, runs the shared ACP lifecycle, and calls
  `profile.configureSession(...)` in place of the inline opencode mode/model code.
- **`IdeDispatchSessionFactory`** (modified — the generalized `AcpAgentSessionFactory`)
  — implements `RunnerAgentSessionFactory`; in `create(args)` it resolves the profile
  from `args.step.ide` and delegates to `AgentSession.start(args, profile)`.
- **Unchanged**: `Runner`, the MCP server (`handoff`/`finish` + step-token guard),
  `RunManager`, `daemon.ts` wiring (still constructs one factory in
  `resolveSessionFactory()`), the TUI/event log, and `FixtureSessionFactory`.

Data flow: `Runner.run` → `factory.create({step,...})` → `resolveIdeProfile(step.ide)`
→ `AgentSession.start(args, profile)` → spawn → ACP init/newSession (MCP server wired
as today) → `profile.configureSession` → kickoff → outcome → dispose. The
handoff/finish contract and step-token header are identical regardless of profile.

## Implementation Design

### Core Interfaces

```typescript
// src/infra/acp/ide-profile.ts
import type { ClientSideConnection, NewSessionResponse } from "@agentclientprotocol/sdk";
import type { Step } from "../../domain/workflow.js";
import type { SessionId } from "../../domain/ids.js";

export interface IdeSpawnSpec {
  command: string;             // e.g. "opencode"
  args: string[];              // e.g. ["acp"]
  env?: Record<string, string>; // merged over process.env at spawn
}

export interface IdeProfile {
  readonly id: string;         // matches Step.ide, e.g. "opencode"
  readonly spawn: IdeSpawnSpec;
  // Owns persona/agent + model selection for this agent. Throws on an
  // unsupported/invalid value so the step fails with a clear, named error.
  configureSession(args: {
    connection: ClientSideConnection;
    sessionId: SessionId;
    session: NewSessionResponse;
    step: Step;
    log: (msg: string, color?: string) => void;
  }): Promise<void>;
}

export class UnknownIdeError extends Error {}
```

### Data Models

No new persisted models. `Step` already carries `ide`, `agent`, `model`, `mode`,
`description`, `edges`. The only schema change is in `validateStep`
(`src/domain/workflow.ts`): `ide` becomes **required** (non-empty string), mirroring
the existing checks for `agent`/`model`, with error `Step '<id>': missing or empty 'ide'`.
Profiles and the registry are in-memory constructs, not stored or serialized.

### API Endpoints

None. This change adds no JSON-RPC methods, HTTP routes, or CLI subcommands. The
workflow JSON contract is unchanged except that `ide` is now mandatory and must be one
of the registered agent ids.

## Integration Points

External agent CLIs invoked over ACP as subprocesses (operator prerequisites, not
installed by this project):

| Agent | Profile `spawn` (indicative; confirmed during build) | Notes |
|-------|------------------------------------------------------|-------|
| opencode | `opencode acp`, env `OPENCODE_ENABLE_QUESTION_TOOL=1` | Existing behavior; mode via `configOptions`, model via `unstable_setSessionModel`. |
| Claude Code | Claude ACP bridge entrypoint | `configureSession` maps `step.agent`/`step.model` to its ACP surface; exact calls confirmed in build. |
| Codex CLI | Codex ACP entrypoint | Same approach; persona/model mapping confirmed in build. |
| Gemini CLI | Gemini ACP entrypoint (reference ACP impl) | Same approach. |

Authentication is whatever each agent CLI already uses in the environment; the runner
performs none. Error handling: a spawn failure, missing binary, or
`configureSession` rejection propagates out of `AgentSession.start`, and the runner's
existing `catch` turns it into a `failure` outcome naming the step (PRD: fail-at-the-step).

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/infra/acp/ide-profile.ts` | new | `IdeProfile`/`IdeSpawnSpec`/`UnknownIdeError` types. Low risk. | Create file. |
| `src/infra/acp/ide-profiles.ts` | new | Registry + `resolveIdeProfile`; four profiles incl. extracted opencode logic (`availableModeIds`). Medium risk (per-agent ACP correctness). | Create file; move `availableModeIds`. |
| `src/infra/acp/agent-session.ts` | modified | `start()` parameterized by profile; spawn + mode/model code replaced by profile calls. Medium risk (core lifecycle). | Refactor; preserve outcome-race + dispose behavior. |
| `AcpAgentSessionFactory` → dispatcher | modified | Resolves profile by `step.ide`, delegates to `AgentSession.start`. Low risk. | Generalize factory. |
| `src/domain/workflow.ts` | modified | `ide` required in `validateStep`. Low risk; existing fixtures already set it. | Add validation + test. |
| `daemon.ts:resolveSessionFactory` | modified (minimal) | Still returns one factory (now the dispatcher). Low risk. | Update construction/import. |
| `workflows/who-is.json`, docs/CLAUDE.md | modified | Document required `ide` + supported set; example may demo multiple agents. Low risk. | Update docs/fixtures. |
| `FixtureSessionFactory`, runner/daemon tests | unaffected | Implements the same port; bypasses profiles. None. | No change. |

## Testing Approach

### Unit Tests

- **Registry/dispatch** (`ide-profiles.test.ts`): each supported id resolves to a
  profile whose `id` matches; `resolveIdeProfile` on an unknown id throws
  `UnknownIdeError`; the dispatching factory surfaces that as a step failure naming the
  step and `ide` value (assert via the runner's failure outcome with `FixtureSessionFactory`-style harness or a stub profile).
- **Schema** (`workflow.test.ts`): a step missing/empty `ide` is rejected with the
  expected message; a step with `ide` set still loads. Update existing fixtures that
  rely on omitted `ide`.
- **Pure mapping helpers**: `availableModeIds` keeps its existing tests after moving
  into the opencode profile; cover its `configOptions`/standard-modes branches.
- Mock boundary: no real subprocess is spawned in unit tests; profiles are exercised
  via their pure parts and via stub `connection` objects where `configureSession` is
  tested directly.

### Integration Tests

- No new in-process ACP harness (per decision). Real four-agent behavior is covered by
  the **manual E2E procedure** in `README.md`, extended to: run a workflow whose steps
  span all four agents including at least one cross-agent handoff, and confirm an
  unavailable-agent step fails at that step with a named error while earlier steps'
  artifacts persist. Existing fixture-backed daemon/runner integration tests continue
  to run unchanged.

## Development Sequencing

### Build Order

1. **`IdeProfile`/`IdeSpawnSpec`/`UnknownIdeError` types** (`ide-profile.ts`) — no
   dependencies.
2. **Refactor `AgentSession.start` to be profile-driven** — depends on step 1. Extract
   the inline opencode spawn + mode/model logic behind the profile parameter; keep the
   ACP init/newSession/kickoff/outcome-race/dispose unchanged. Verify opencode still
   works by temporarily passing an opencode profile.
3. **opencode profile + registry + `resolveIdeProfile`** (`ide-profiles.ts`) — depends
   on steps 1–2. Move `availableModeIds` here; register opencode first.
4. **Dispatching factory** — depends on step 3. Generalize `AcpAgentSessionFactory` to
   resolve by `step.ide`; update `daemon.ts:resolveSessionFactory` import/construction.
5. **Require `ide` in `validateStep`** — depends on step 3 (so the supported set
   exists); update fixtures/tests. Independent of step 4 but sequenced after for a
   coherent test pass.
6. **Claude Code, Codex, Gemini profiles** — depends on steps 1–4. Add each profile's
   `spawn` + `configureSession`; confirm each agent's persona/model ACP mapping during
   this step.
7. **Unit tests** (registry/dispatch, schema, mapping) — depends on steps 3–6.
8. **Docs + example + manual E2E** — depends on steps 4–6. Update `workflows/who-is.json`,
   the workflow-format docs, and the README E2E procedure; run the four-agent E2E.

### Technical Dependencies

- opencode, Claude Code, Codex CLI, and Gemini CLI installed, authenticated, and ACP-
  reachable in the E2E environment.
- The ACP entrypoint/bridge invocation for Claude Code, Codex, and Gemini must be
  confirmed (resolves PRD Open Questions on per-agent selection surfaces) before steps
  6 and 8 can complete.

## Monitoring and Observability

No metrics system exists; observability is the existing event log / TUI. Ensure the
per-step banner/log makes the active agent visible: include `step.ide` in the
`Starting step` status or an early log line, and keep the existing `Session created` /
`Mode set` / `Model set` log lines (now emitted from within `configureSession`).
Unknown/unavailable-agent failures must log the step id and the offending `ide` value.

## Technical Considerations

### Key Decisions

- **Decision**: `IdeProfile` table + dispatching factory; one generalized
  `AgentSession`; per-profile `configureSession`; hardcoded spawn specs.
  - **Rationale**: The ACP lifecycle is already agent-agnostic; only spawn + mode/model
    differ, which is naturally expressed as data + one hook.
  - **Trade-offs**: Per-agent ACP quirks concentrate in `configureSession` and must
    track each bridge; we accept that over lifecycle duplication.
  - **Alternatives rejected**: one factory per IDE (duplicates lifecycle); subclassing
    (inheritance coupling). See ADR-002.
- **Decision**: `ide` required at load; unknown/unavailable resolved at the step.
  - **Rationale**: Self-documenting workflows; reuse of the runner's existing
    fail-at-the-step path; matches PRD answers.
  - **Trade-offs**: Existing workflows must set `ide` (they already do).

### Known Risks

- **Non-opencode agents may not expose persona/model the way the step fields assume**
  (medium likelihood). Mitigation: `configureSession` owns the mapping and rejects
  unsupported values with a clear step error; mappings validated in the E2E pass.
  Needs confirmation during steps 6/8.
- **Hardcoded spawn commands break if binaries/entrypoints differ per environment**
  (low/medium). Mitigation: document prerequisites; env-var/config overrides are a
  deliberate future increment.
- **Refactor of `AgentSession.start` could regress the interactive/autonomous outcome
  race or dispose semantics** (low). Mitigation: keep that logic byte-for-byte where
  possible; rely on existing fixture-backed runner/daemon tests plus an opencode E2E
  smoke before adding other agents.

## Architecture Decision Records

- [ADR-001: Per-step IDE selection with unified full-parity step schema](adrs/adr-001.md)
  — Required per-step `ide` across four agents at full parity, fail-at-the-step,
  behind the existing session-factory boundary (from PRD).
- [ADR-002: IdeProfile registry with a dispatching session factory](adrs/adr-002.md)
  — Per-IDE differences captured as `IdeProfile` (spawn + `configureSession`) in a
  static registry; a dispatching factory selects by `step.ide`; one generalized
  `AgentSession`.
