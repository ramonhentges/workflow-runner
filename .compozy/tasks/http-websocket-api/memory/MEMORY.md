# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

Tasks 01–14 complete. `src/app/api/schema.ts` is the single source-of-truth for HTTP/WS wire schemas. `RunManager.startRun(workflowPath, cwd)` now requires an explicit cwd; the JSON-RPC path and CLI send `process.cwd()`. `createApiApp(rm, port?)` is the Hono harness factory; `mapError(err)` is the shared error mapping helper. Routes are extracted to `src/app/api/routes/<name>.ts` and registered in `createApiApp` via `register<Name>Route(app, rm)`. `GET /runs` → `routes/runs.ts`; `GET /runs/:id` → `routes/run-detail.ts`; `POST /runs` → `routes/start-run.ts`; `POST /runs/:id/stop` → `routes/stop-run.ts`; `POST /runs/:id/retry-step` → `routes/retry-step.ts`; `GET /runs/:id/events` → `routes/run-events.ts`. Security middleware and `isOriginAllowed` predicate in `src/app/api/security.ts`.

## Shared Decisions

- **Schemas live in `src/app/api/schema.ts`**, not `src/domain/` — transport/wire shapes per ADR-003.
- **`RunEvent.event` is `z.unknown()`** — the TUI conformance test validates no payload drift, but the schema does not structurally validate the RunnerEvent union.
- **Plain strings for id/slug** in API schemas (no branded types) — public wire format, not domain internals.
- **`RunDetail` field set** is explicitly scoped: id, slug, workflowPath, status, currentStepId, visitedStepIds, startedAt, endedAt, attachedCount. No kickoffPrompts or endReason.
- **Installed versions**: hono@4.12.23, @hono/zod-openapi@1.4.0, zod@4.4.3.

## Shared Learnings

- **`upgradeWebSocket` from `hono/bun` requires a real `Bun.serve` server**: in unit tests via `app.request()`, `getBunServer(c)` fails/falls through. Test WS handler logic via exported `createPerConnectionState` directly; test pre-upgrade HTTP rejections via `app.request()`.
- **`let capturedVar: T | null = null` inside a callback closure**: TypeScript's CFA may narrow it to `null` at later use sites. Use an array (`T[]`) or object container (`{ current: T | null }`) instead to avoid the narrowing.
- **Bun's `ServerWebSocket.send()` returns a numeric status** (`>0`=sent, `0`=backpressured, `<0`=closed) but Hono's `WSContext.send()` returns void. Use `ws.raw` to access native Bun WS for backpressure detection.
- **`Bun.serve({ port: 0 })`** assigns an OS-chosen port; read it via `server.port ?? 0`.
- `Tui.onEvent()` is a public method callable directly in tests without attaching a TuiEventSource.
- `@opentui/core/testing` → `createTestRenderer` returns `{ renderer, renderOnce, captureCharFrame }`.
- Bun test files support `Bun.file(new URL("./relative", import.meta.url))` for fixture loading.
- **Boolean query params**: use `z.string().optional()` in the route schema and convert via `=== "true"` in the handler. `z.coerce.boolean()` coerces "false" → `true` (JS `Boolean("false")`) — avoid.
- **Integration tests needing a terminal run**: use `fake:complete` + `setTimeout(200)` wait. Using `fake:hang` + `manager.stop()` blocks for `STOP_TIMEOUT_MS = 5000ms`.
- **Mock subscriber sets**: `new Set(Array(n).fill({}))` always has size 1 (same reference). Use `Array.from({ length: n }, () => ({}))` for n unique objects.
- **@hono/zod-openapi v1.4.0 multi-response routes**: when declaring 200/404/409 in `createRoute`, the success branch MUST pass an explicit `200` status to `c.json({...}, 200)`. Without it, TypeScript infers the union `200|404|409` as the status, causing assignment failures.
- **OpenAPI path key format**: parameterized routes appear as `/runs/:id` (Hono syntax) in the `/openapi.json` spec, NOT `/runs/{id}` (OpenAPI standard). Assert against `:id` form in tests.
- **`mapError` + typed 409 error (AmbiguousErrorSchema)**: routes where 409 requires `{ candidates: string[] }` cannot use `mapError` with `status as 404 | 409` — TypeScript rejects `{ code, message }` as the 409 body. Pattern: handle RunManagerError from the RunManager call directly with an explicit status cast (e.g., 404 only when UNKNOWN_RUN is the only realistic post-get error). See `routes/stop-run.ts`.
- **Mutable closure for handler unit tests**: when testing a handler that reads status *after* calling a RunManager method (e.g., stop, retryStep), use a `let currentStatus` variable shared between the mock `get()` snapshot and `stop()`/`retryStep()` mutation. Pre-set terminal status does not exercise the post-call read path.
- **Event-log ownership pattern** (terminal vs running): mirror `run-attach.ts` — `const ownedEventLog = !active.eventLog ? await rm.openEventLog(runId).catch(() => null) : null; const eventLog = active.eventLog ?? ownedEventLog;`. Close `ownedEventLog` in `finally`; never close `active.eventLog`.
- **Real EventLog for behavioral unit tests**: for fromSeq/stepId filter tests, open a real `EventLog` in a temp dir, append entries (each `append` syncs to disk and populates the ring buffer), pass as `activeEventLog`. Ring fast-path in `readEventsSince` works without explicit flush. Use mock log only for truncation/FD-leak tests.
- **`async () => { counter++; }` in mocks**: the increment runs synchronously on function call (before Promise resolves). No `await Promise.resolve()` needed in close-count tests.
- **Testing Hono middleware with explicit `Host` headers**: use `new Request(url, { headers: { Host: "..." } })` — Bun preserves the explicit `Host` override. `app.request("/path")` expands to `http://localhost/path` (no port), so the URL-derived `Host` is `localhost` — not suitable for port-specific allowlist tests.

## Shared Learnings (task 14 additions)

- **`WsConnectionRegistry` pattern**: `createWsConnectionRegistry()` in `ws-attach.ts` returns `{ register, unregister, drain }`. Created in `runDaemon`, passed as optional 3rd arg to `createApiApp(rm, port, wsRegistry)`, forwarded to `registerWsAttachRoute(app, rm, port, registry)`. Backward-compatible (existing tests don't pass it).
- **Bun WS close code in integration tests**: `server.stop(true)` may send close code 1000 even when `ws.close(1001)` was sent first (depends on close-handshake timing). Integration tests should accept any valid code (>=1000), not assert specifically 1001.
- **`makeShutdown` shutdown order**: wsDrain → apiServer.stop(true) → listener.stop(true) → runManager.shutdown() → remove socket/lockfile/daemon.json. `wsDrain` is optional in `ShutdownDeps`; zero-client path returns 0 immediately with no grace-period wait.

## Shared Learnings (task 13 additions)

- **Daemon startup ordering**: API server (`Bun.serve`) and `daemon.json` must be written BEFORE `bindSocket` creates the UDS socket. The socket is the readiness signal; any consumer seeing it must be able to read `daemon.json` without a race.
- **`ReturnType<typeof Bun.serve>`** is the correct variable type for a Bun server — `import type { Server }` requires a generic argument that is non-trivial to satisfy.
- **Integration harness uses `WORKFLOW_RUNNER_API_PORT=0`** by default so parallel integration tests each get OS-assigned API ports with no conflicts.
- **`Bun.serve` deferred fetch**: To pass the actual bound port (including when port=0) to `createApiApp`, create a `let appFetch` container, call `Bun.serve` with `(req, srv) => appFetch(req, srv)`, then update `appFetch` to `app.fetch` after the bind. Safe because JS is single-threaded.

## Open Risks

- `RunEvent.event` is unvalidated (`z.unknown()`). If the RunnerEvent union ever adds required fields, the conformance test will catch render drift but schema validation won't catch structural issues early.

## Handoffs

- Tasks 04–14: import request/response/frame schemas from `src/app/api/schema.ts`.
- Tasks 05–13: use `createApiApp(rm)` from `src/app/api/app.ts` to get the `OpenAPIHono` instance; register routes via `app.openapi(route, handler)` with `rm` in the closure. Extract each route to `src/app/api/routes/<name>.ts` and register in `createApiApp` via `register<Name>Route(app, rm)` — see `health.ts` as the pattern.
- Tasks 04–13: catch errors and call `mapError(err)` from `src/app/api/error-map.ts` — returns `{status, code, message}`.
- Task 07 (`POST /runs`): call `RunManager.startRun(workflowPath, cwd)` — both args required; HTTP body provides `cwd` (no ambient shell).
- **Task 13 (listener)**: call `createApiApp(rm, configuredPort)` — the port argument activates the `Host`-allowlist middleware. Pass `websocket` from `src/app/api/routes/ws-attach.ts` to `Bun.serve`. The `Bun.serve` second argument (Server) is what enables `getBunServer(c)` inside `upgradeWebSocket`.
- Integration tests in `__tests__/integration/` pass `cwd: h.storageRoot` on `run.start` calls.
- The `__fixtures__/events.jsonl` fixture covers all 6 RunnerEvent types; extend it if new types are added to the domain.
- **`createPerConnectionState`** in `src/app/api/routes/ws-attach.ts` is exported for direct unit testing of WS handler logic without a real Bun.serve server.
- **`websocket`** from `src/app/api/routes/ws-attach.ts` (re-exported from `hono/bun`) must be passed to `Bun.serve({ websocket })` in Task 13 for WS upgrade to function.
