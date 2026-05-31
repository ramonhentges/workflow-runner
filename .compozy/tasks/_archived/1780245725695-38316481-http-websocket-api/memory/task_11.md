# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Loopback security middleware (Host/Origin) + DNS-rebind test. Added `Host`-header allowlist middleware for all HTTP routes and a reusable `Origin`-allowlist predicate for WS upgrades, parameterized by port.

## Important Decisions

- **`createApiApp(rm, port?)` port is optional** — existing unit tests call `createApiApp(rm)` without port and send short-path requests (Hono defaults to `http://localhost` with no port). Making port optional preserves those tests without modification. When port is provided the middleware is applied; Task 13 will always pass the configured port.
- **Middleware placement first in `createApiApp`** — `app.use("/*", hostAllowlistMiddleware(port))` is registered before `app.doc()` and all routes so it runs first for every request.
- **`isOriginAllowed` exported separately** — Task 12 (WS attach) will import and call it on the `Upgrade` request's `Origin` header.

## Learnings

- `new Request(url, { headers: { Host: "evil.com" } })` in Bun correctly preserves the explicit `Host` header (does not override it from the URL). Tests that need to assert Host header behavior must use the `Request` object form, not the short-path string form of `app.request()`.
- Hono `app.request("/path")` expands to `http://localhost/path` (no port), so those requests would fail the port-specific allowlist. This is expected — unit tests for existing routes should not pass a port to `createApiApp`.
- `MiddlewareHandler` from `hono` types the middleware correctly; no need for explicit `Context`/`Next` imports.

## Files / Surfaces

- `src/app/api/security.ts` — new: `DEFAULT_API_PORT`, `allowedHosts`, `isOriginAllowed`, `hostAllowlistMiddleware`
- `src/app/api/app.ts` — modified: import `hostAllowlistMiddleware`, add `port?: number` param, apply middleware when port provided
- `src/app/api/security.test.ts` — new: 32 tests (unit + DNS-rebinding falsification + integration)

## Errors / Corrections

None.

## Ready for Next Run

Task 12 (WS attach): import `isOriginAllowed` from `./security.js` and call it with the `Origin` header from the WS upgrade request. Task 13 (listener): call `createApiApp(rm, configuredPort)` — this activates the security middleware.
