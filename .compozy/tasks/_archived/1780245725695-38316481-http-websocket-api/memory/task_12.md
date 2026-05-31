# Task Memory: task_12.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

COMPLETED. Implemented `WS /runs/:id/attach` handler with all required functionality.

## Important Decisions

- **`upgradeWebSocket` from `hono/bun`** (direct import) used instead of `createBunWebSocket()` — both are equivalent; direct singletons are simpler.
- **`activeConnections`** closure inside `registerWsAttachRoute` (per-registration scope), not module-level; avoids test interference.
- **Backpressure detection**: `ws.raw.send()` (Bun's native, returns numeric status) when available; falls back to `ws.send()` (void) for mocks.
- **`createPerConnectionState`**: exported for direct unit testing without real Bun.serve. This is the key testability boundary.
- **Pre-upgrade middleware** handles: Origin allowlist, max-connections, run resolution — all as HTTP responses before WS upgrade.
- **`activeConnections` increment** happens in the `upgradeWebSocket` factory (synchronous during upgrade), decrement in `cleanup()`.
- **TypeScript CFA issue with `let sub: T | null = null`** in callback closures: used array container `T[]` instead.

## Files / Surfaces

- `src/app/api/routes/ws-attach.ts` — NEW: WS route handler, createPerConnectionState, guardrails
- `src/app/api/routes/ws-attach.test.ts` — NEW: 28 unit tests
- `src/app/api/routes/ws-attach.integration.test.ts` — NEW: 5 integration tests with real Bun.serve
- `src/app/api/app.ts` — MODIFIED: imports + calls `registerWsAttachRoute`

## Verification Evidence

- `bun run typecheck`: 0 errors
- `bun test`: 673 pass, 1 skip, 0 fail (674 total across 52 files)
- WS-specific: 33 pass (28 unit + 5 integration)

## Ready for Next Run

Task 13 needs `websocket` from `src/app/api/routes/ws-attach.ts` and `createApiApp(rm, port)` from `app.ts`. The `websocket` singleton (from `hono/bun`) must be passed to `Bun.serve({ websocket })` for WS upgrade to function. Task 13 sets up the actual Bun.serve mount, bind assertion, and discovery file.
