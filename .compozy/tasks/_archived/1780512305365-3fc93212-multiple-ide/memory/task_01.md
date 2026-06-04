# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Introduce `IdeProfile`/`IdeSpawnSpec`/`UnknownIdeError` types in `ide-profile.ts`, plus a static registry and opencode profile in `ide-profiles.ts`. Relocate `availableModeIds` from `agent-session.ts` into `ide-profiles.ts`. Add unit + integration tests. Do NOT modify `agent-session.ts` — wiring happens in task_02.

## Important Decisions

- `availableModeIds` is duplicated (kept in `agent-session.ts`, also added to `ide-profiles.ts`) until task_02 does the wiring.
- `PROFILES` map exported from `ide-profiles.ts` to allow integration test to enumerate entries.
- `UnknownIdeError` message format: `Unknown IDE: '${ide}'` — contains the unknown ide value as required.
- Error messages in `configureSession` preserved verbatim from `agent-session.ts` lines ~267-293.

## Learnings

- `agent-session.ts` has `availableModeIds` at lines ~73-87 and mode/model selection at ~266-293.
- `Step` type already has `ide: string` field (currently not validated as required — that's task_03).
- `NewSessionResponse` from `@agentclientprotocol/sdk` has optional `modes?.availableModes` and `configOptions`.
- Tests use `as unknown as NewSessionResponse` for mock objects.

## Files / Surfaces

- Created: `src/infra/acp/ide-profile.ts`
- Created: `src/infra/acp/ide-profiles.ts`
- Created: `src/infra/acp/ide-profiles.test.ts`
- NOT modified: `src/infra/acp/agent-session.ts`

## Errors / Corrections

## Ready for Next Run

task_02 will: modify `agent-session.ts` to consume profiles (profile-driven spawn + configureSession), remove duplicate `availableModeIds` from `agent-session.ts`, generalize `AcpAgentSessionFactory` to dispatch by `step.ide`.
