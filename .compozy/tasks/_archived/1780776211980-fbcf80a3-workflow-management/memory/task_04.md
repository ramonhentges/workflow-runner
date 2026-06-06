# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Completed. `src/infra/acp/ide-catalog.ts` and `src/infra/acp/ide-catalog.test.ts` delivered.

## Important Decisions

- `resolveIdeProfile(ide)` is called BEFORE the try/catch so `UnknownIdeError` propagates naturally — no subprocess is ever spawned for unknown ides.
- For agent extraction: use `modes.availableModes` (full `{ id, name }`) when present; fall back to `availableModeIds(result)` (ids only, `name = id`) for opencode-style configOptions.
- `kill()` returning `false` (not throwing) must be handled in `disposeProcess` — means process is already gone; resolve immediately. The original `AgentSession.dispose()` only handles throws, but the probe's dispose needs this because injected test processes may not emit "exit" on `kill()`.
- `probePromise.catch(() => {})` added to suppress unhandled rejection when the timeout wins the race and the probe later rejects.
- Default timeout: 10000ms. Timeout cleared in `finally` to prevent firing after function returns.

## Learnings

- `SessionMode.id` and `ModelInfo.modelId` are both plain `string` (not branded types).
- `ModelInfo` has `modelId: string` (not `id`), and `name: string`.
- ACP JSON-RPC method names: `initialize` → `"initialize"`, `newSession` → `"session/new"` (from `schema.AGENT_METHODS`).
- Stub ACP process for tests: use `PassThrough` streams for stdin/stdout; parse ndjson lines from stdin, write ndjson responses to stdout. `setImmediate(() => emit("spawn"))` to simulate async spawn.
- The original `agent-session.test.ts`'s `makeErrorProcess` has `kill = () => false` and never emits "exit" — this is sufficient for AgentSession tests but breaks the probe's more thorough disposal. Fixed by checking `kill()` return value in `disposeProcess`.

## Files / Surfaces

- New: `src/infra/acp/ide-catalog.ts` — `probeIdeCatalog`, `IdeCatalog`, `IdeCatalogEntry`
- New: `src/infra/acp/ide-catalog.test.ts` — 11 tests (unit + integration)

## Errors / Corrections

- Initial test run: "returns reachable:false with a reason when spawnFn emits an error" timed out. Root cause: `makeErrorProcess` has `kill = () => false` and never emits "exit", so `disposeProcess` hung waiting. Fixed by adding `if (!killed) { resolve(); return; }` check in `disposeProcess`.

## Ready for Next Run

task_05 (GET /ide/{ide}/catalog route) can proceed. It wraps `probeIdeCatalog` directly. Key handoff: `probeIdeCatalog` throws `UnknownIdeError` for unknown ides → route must catch and return 400; `reachable:false` is a normal 200 response.
