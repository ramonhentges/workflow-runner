# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Add Codex CLI profile to `ide-profiles.ts`. Register under `"codex"` id. Implement `configureSession` using same pattern as `claudeCodeProfile`. Add unit + integration tests.

## Important Decisions

- **Spawn**: `command: "codex"`, `args: ["--acp"]` — provisional, following the `claude --acp` convention. Codex CLI v0.130.0 does NOT have a native `acp` subcommand or ACP feature flag. The `--acp` flag convention is assumed; task_07 E2E will confirm or surface the mismatch.
- **configureSession**: Identical to `claudeCodeProfile` — uses `availableModeIds` + `setSessionMode` + `unstable_setSessionModel`. If Codex ACP advertises modes, validates step.agent; otherwise skips validation and attempts the call.
- **No env vars needed** (unlike opencode which needs `OPENCODE_ENABLE_QUESTION_TOOL=1`).
- Codex CLI investigated: v0.130.0, has `app-server`, `remote-control`, `exec-server` but no `acp` subcommand and no ACP feature flag.

## Learnings

- Codex CLI v0.130.0 uses its own "app-server" protocol over stdio, NOT standard ACP. Task_07 E2E must verify the actual ACP entrypoint.
- The `availableModeIds` utility already handles both standard ACP modes and configOptions fallback, so codex inherits forward-compatibility if/when its ACP bridge exposes modes.

## Files / Surfaces

- `src/infra/acp/ide-profiles.ts` — added `codexProfile` + registered in `PROFILES`
- `src/infra/acp/ide-profiles.test.ts` — 8 new tests (registry + configureSession coverage)
- `src/infra/acp/agent-session.test.ts` — 1 new dispatch integration test

## Errors / Corrections

None.

## Ready for Next Run

- task_06 (Gemini CLI): same pattern, different spawn command. Must confirm `gemini` ACP entrypoint before implementing.
- The provisional `codex --acp` spawn must be validated in task_07 E2E; if the command differs, only `ide-profiles.ts` needs updating.
