# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Parameterized security middleware functions (allowedHosts, isOriginAllowed, hostAllowlistMiddleware) with bindHost parameter. Threaded bindHost from daemon runtime through createServerApp and createApiApp to middleware factories.

## Important Decisions

- `bindHost` added as a trailing optional parameter on `createApiApp` and `createServerApp` (not in `ApiAppOptions` bag), consistent with how `port` and `wsRegistry` are threaded as positional params.
- Empty set from `allowedHosts(port, "0.0.0.0")` means "accept all" — middleware checks `hosts.size === 0` to early-return instead of rejecting.

## Learnings

- Hono's `app.request()` derives the Host header from the URL, not from the `Host` header in the Request object's headers. The middleware correctly reads `c.req.header("Host")` which returns the effective Host from the request.

## Files / Surfaces

- `src/app/api/security.ts`: Updated `allowedHosts()`, `isOriginAllowed()`, `hostAllowlistMiddleware()`
- `src/app/api/app.ts`: Added `bindHost` param to `createApiApp()` and `createServerApp()`
- `src/infra/daemon/daemon.ts`: Passed `bindHost` to `createServerApp()` call in `runDaemon()`
- `src/app/api/security.test.ts`: Added 27 new tests for bindHost-aware behavior

## Errors / Corrections

- Initial middleware implementation for `0.0.0.0` returned empty set but didn't handle it in `hostAllowlistMiddleware` — empty set means "accept all", so added `hosts.size === 0` early return.

## Ready for Next Run

Task 04 complete. Next: any remaining tasks in the workflow.
