# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Wire `--host` flag through CLI parser (`src/app/cli.ts`) and daemon command (`src/app/commands/daemon.ts`). Implemented `--host` flag parsing in `parseDaemonArgs()` following `--storage-root` pattern (string, no validation), updated `USAGE.daemon`, forwarded `bindHost` to `runDaemonFn` in foreground mode, and set `WORKFLOW_RUNNER_HOST` env var for detached spawns.

## Important Decisions

- `--host` parsing follows the `--storage-root` pattern (string value, no validation in parser) as specified in the TechSpec, rather than `--api-port` pattern (which validates port range).
- Env var name is `WORKFLOW_RUNNER_HOST` to match `WORKFLOW_RUNNER_API_PORT` naming convention.

## Learnings

- TypeScript narrows `process.env` property accesses after `delete` statements, causing `expect().toBe()` to fail typecheck because the narrowed type (`undefined`) doesn't match the expected value's type. Workaround: use a helper function `readEnv(key)` to break the narrowing chain.

## Files / Surfaces

- `src/app/cli.ts` — `DaemonArgs` interface, `parseDaemonArgs()`, `USAGE.daemon`
- `src/app/commands/daemon.ts` — `DaemonDeps.runDaemon` type, `runForeground()`, `runStart()`
- `src/app/cli.test.ts` — 7 new tests for `--host` parsing
- `src/app/commands/daemon.test.ts` — 4 new tests for forwarding and env var

## Errors / Corrections

- Initial test for "empty argv produces undefined bindHost" used `"bindHost" in result.value` check, but `bindHost` is always present in the returned object (as `undefined`). Removed the `in` check — `toEqual` treats `undefined` properties as equivalent to missing.
- TypeScript `toBe` type issue after `delete process.env.*` — resolved with `readEnv()` helper function.

## Ready for Next Run

Task 02 complete. Task 03 (Update `Bun.serve()` and replace loopback assertion with warning) can start.
