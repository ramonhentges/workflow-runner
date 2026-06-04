# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Add Gemini CLI IDE profile (`"ide": "gemini"`) to the PROFILES registry — COMPLETE.

## Important Decisions

- Gemini CLI ACP entrypoint: `gemini --acp` (provisional, following claude-code/codex convention; task_07 E2E must confirm).
- configureSession: identical pattern to claude-code and codex — standard ACP `setSessionMode` + `unstable_setSessionModel`.
- No env overrides needed (unlike opencode which needs `OPENCODE_ENABLE_QUESTION_TOOL`).

## Files / Surfaces

- `src/infra/acp/ide-profiles.ts` — `geminiProfile` added; registered under `"gemini"` in `PROFILES`.
- `src/infra/acp/ide-profiles.test.ts` — 9 new tests: registry entry, configureSession (valid mode/model, invalid agent error, invalid model error, no-modes passthrough, logging, setSessionMode wrap, model wrap).
- `src/infra/acp/agent-session.test.ts` — 3 new tests: gemini spawn dispatch, autonomous finish via FixtureSessionFactory, autonomous handoff via FixtureSessionFactory.

## Learnings

- Integration tests for new profiles belong in `agent-session.test.ts` (not `ide-profiles.test.ts`) to use `FixtureSessionFactory` + `Runner` + `IdeDispatchSessionFactory`.
- The spawn dispatch test pattern: `IdeDispatchSessionFactory(stubSpawn)` → `factory.create(...)` → catch error → assert `spawnCalls`.

## Ready for Next Run

- task_07 E2E must confirm actual Gemini CLI ACP entrypoint (`gemini --acp` is provisional).
- All 830 tests pass, tsc clean.
