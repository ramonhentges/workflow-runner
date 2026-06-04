# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

- task_01 completed: `ide-profile.ts` and `ide-profiles.ts` created under `src/infra/acp/`.
- task_02 completed: `AgentSession.start` is profile-driven; `IdeDispatchSessionFactory` replaces `AcpAgentSessionFactory`; `daemon.ts` updated.
- task_03 completed: `validateStep` in `src/domain/workflow.ts` now requires a non-empty `ide`; `ide: s.ide` set directly; 6 new tests added.
- task_04 completed: `"claude-code"` profile added to `PROFILES` in `ide-profiles.ts`; spawn: `claude --acp`; 9 new tests added.
- `availableModeIds` exists only in `ide-profiles.ts`. The copy that was in `agent-session.ts` was removed in task_02.
- `PROFILES` map is exported from `ide-profiles.ts` as `ReadonlyMap<string, IdeProfile>`.
- `IdeDispatchSessionFactory` accepts an optional `spawnFn` constructor parameter for test injection.

## Shared Decisions

- `PROFILES` is exported (not private) to allow integration tests to enumerate entries without separate test-only helpers.
- `configureSession` error messages are verbatim from the original `agent-session.ts` mode/model block to preserve existing behavior.
- `AgentSessionFactory` interface removed (was only used internally by `AcpAgentSessionFactory`; new factory implements `RunnerAgentSessionFactory` directly).

## Shared Learnings

- `NewSessionResponse` type requires `as unknown as` cast in tests — its full shape isn't easily constructible from test code.
- `String(new UnknownIdeError("msg"))` gives `"Error: msg"` (not `"UnknownIdeError: msg"`) — test assertions should check for the ide value, not the class name in the reason string.
- All existing 790 tests pass after task_02 changes (5 new tests added).

## Open Risks

- (none remaining from task_01–03)

## Handoffs

- task_05 completed: `"codex"` profile added to `PROFILES` in `ide-profiles.ts`; spawn: `codex --acp` (provisional — task_07 E2E must confirm; Codex CLI v0.130.0 has no native `acp` command); 9 new tests added.
- task_06 completed: `"gemini"` profile added to `PROFILES` in `ide-profiles.ts`; spawn: `gemini --acp` (provisional — task_07 E2E must confirm); 12 new tests added (9 in `ide-profiles.test.ts`, 3 in `agent-session.test.ts`).
- task_07: E2E docs/fixtures update. Must confirm actual ACP entrypoints for codex (`codex --acp`) and gemini (`gemini --acp`) before finalizing spawn specs.
- `runner.test.ts` and `run-manager.test.ts` use `ide: "vscode"` which is unregistered but non-empty — passes `validateStep`, fails only at the step if executed. No action needed until task_07.

## Codex CLI ACP Status

- Codex CLI v0.130.0 (`@openai/codex`) does NOT have a native `acp` subcommand or ACP feature flag.
- Its programmatic interface uses a custom "app-server" protocol over stdio, not ACP.
- Provisional spawn: `codex --acp` (following the `claude --acp` convention). Task_07 E2E must confirm the actual entrypoint.

## Gemini CLI ACP Status

- Gemini CLI described as "reference ACP implementation" — most likely uses standard ACP `modes.availableModes` for agent selection.
- Provisional spawn: `gemini --acp` (following the `claude --acp` convention). Task_07 E2E must confirm the actual entrypoint.
