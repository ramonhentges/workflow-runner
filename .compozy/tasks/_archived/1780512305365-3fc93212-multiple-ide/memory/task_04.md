# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Add Claude Code profile to `ide-profiles.ts`. Register under `"claude-code"` id. Implement `configureSession` using same pattern as opencode. Add unit + integration tests.

## Important Decisions

- **Spawn**: `command: "claude"`, `args: ["--acp"]` — Claude Code ACP entrypoint flag form. To be confirmed in task_07 E2E.
- **configureSession**: Reuses `availableModeIds` + `setSessionMode` + `unstable_setSessionModel` pattern (identical to opencode). If Claude Code advertises modes, validates step.agent; otherwise skips validation and attempts the call.
- No env vars needed (unlike opencode which needs `OPENCODE_ENABLE_QUESTION_TOOL=1`).

## Learnings

- The pattern for new profiles is a direct copy of `opencodeProfile`'s `configureSession` shape — the only real difference between profiles is `spawn` and any special mode discovery mechanism.
- The `availableModeIds` utility already handles both `modes.availableModes` (standard ACP) and `configOptions` fallback, so claude-code inherits forward-compatibility for free.

## Files / Surfaces

- `src/infra/acp/ide-profiles.ts` — added `claudeCodeProfile` + registered in `PROFILES`
- `src/infra/acp/ide-profiles.test.ts` — 8 new tests (registry + configureSession coverage)
- `src/infra/acp/agent-session.test.ts` — 1 new dispatch integration test

## Errors / Corrections

None.

## Ready for Next Run

- task_05 (Codex CLI): same pattern, different spawn command. The `spawn.command` for Codex CLI needs confirmation before implementing.
- The exact Claude Code ACP entrypoint (`claude --acp`) is assumed; task_07 E2E will surface any mismatch.
