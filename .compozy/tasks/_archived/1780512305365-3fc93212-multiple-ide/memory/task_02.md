# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Generalize `AgentSession.start` to accept an `IdeProfile`, remove the hardcoded opencode spawn and inline mode/model logic, and turn `AcpAgentSessionFactory` into `IdeDispatchSessionFactory` which resolves profiles by `step.ide`.

## Important Decisions

- `AgentSession.start` gets a third optional `spawnFn` parameter (defaults to `spawn`) to enable testing without real subprocess spawning.
- `IdeDispatchSessionFactory` accepts an optional `spawnFn` constructor arg, passes it to `AgentSession.start`.
- `AgentSessionFactory` interface removed (becomes dead code after rename).
- `availableModeIds` removed from `agent-session.ts` (already in `ide-profiles.ts` from task_01).
- `NewSessionResponse`, `SessionConfigSelectOption`, `SessionConfigSelectGroup` imports removed from `agent-session.ts` (only needed by the removed `availableModeIds`).

## Learnings

- `RunnerAgentSessionArgs` and `AgentSessionArgs` are structurally identical — structural typing allows the factory to satisfy `RunnerAgentSessionFactory`.
- The runner's `catch` at ~line 244 converts any thrown error (including `UnknownIdeError`) into `failure = { failedStep: step.id, reason: String(err) }`.
- For the runner integration test, need `Workflow.fromJson` with valid step shape including `ide` field (currently optional in workflow.ts — task_03 makes it required).

## Files / Surfaces

- `src/infra/acp/agent-session.ts` — modified
- `src/infra/daemon/daemon.ts` — updated import
- `src/infra/acp/agent-session.test.ts` — new test file

## Errors / Corrections

## Ready for Next Run
