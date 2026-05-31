# Task Memory: task_13.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Mount the assembled Hono app on `Bun.serve` (127.0.0.1, default 4517), add bind assertion, write
`daemon.json` discovery file (0600), add no-regression test. All done and verified.

## Important Decisions

- **API server binds BEFORE the UDS socket**: Ordering was swapped so that `daemon.json` is written
  before the socket file appears. This guarantees that any process seeing the socket can also read
  the discovery file without a TOCTOU race.
- **Deferred fetch container**: `appFetch` variable is set to a placeholder, then `Bun.serve` is
  called, then `createApiApp(rm, actualPort)` is called with the real bound port, then `appFetch`
  is updated. Safe because JS is single-threaded — no request is dispatched before the assignment.
- **Integration harness uses `WORKFLOW_RUNNER_API_PORT=0`**: Added as a default env var in
  `startDaemonHarness` so parallel tests each get an OS-assigned port with no conflicts.

## Learnings

- `Bun.serve()` `server.hostname` and `server.port` are typed as `T | undefined` — use `?? ""` and
  `?? 0` defensively.
- `import type { Server } from "bun"` requires a generic type argument; use
  `ReturnType<typeof Bun.serve>` for the variable type instead.
- The integration test timing race: harness sees socket → `daemon.json` may not exist yet. Fixed by
  writing `daemon.json` before `bindSocket`.

## Files / Surfaces

- `src/app/cli.ts` — `DaemonArgs` now has `apiPort?: number`; `parseDaemonArgs` handles `--api-port N / --api-port=N`; `USAGE.daemon` updated.
- `src/app/commands/daemon.ts` — passes `parsed.value.apiPort` to `defaultRunDaemon`.
- `src/infra/daemon/daemon.ts` — added `resolveApiPort`, `assertLoopbackBind`, `writeDiscoveryFile` (all exported); updated `ShutdownDeps`/`makeShutdown` with `apiServer?`/`discoveryFilePath?`; updated `runDaemon` to mount API server before UDS socket.
- `src/infra/daemon/__tests__/integration/harness.ts` — `Harness` now includes `discoveryFilePath`; default env adds `WORKFLOW_RUNNER_API_PORT: "0"`; added `waitForDiscoveryFile` helper.
- `src/infra/daemon/daemon.test.ts` — added unit tests for `resolveApiPort`, `assertLoopbackBind`, `writeDiscoveryFile`, and `makeShutdown` with api/discovery extensions.
- `src/infra/daemon/__tests__/integration/api-listener.test.ts` — new: bind/discovery + no-regression integration tests.

## Errors / Corrections

- First attempt had UDS socket before API server → TOCTOU race in tests. Fixed by swapping order.
- `Server as BunServer` from bun requires a type arg → use `ReturnType<typeof Bun.serve>`.
- `server.hostname`/`server.port` are `string | undefined` / `number | undefined` → add `?? ""` / `?? 0`.

## Ready for Next Run

Task 13 complete. Task 14 (shutdown drain) extends `makeShutdown` to drain WS clients before stopping the API server — the `apiServer` field in `ShutdownDeps` is already wired for this.
