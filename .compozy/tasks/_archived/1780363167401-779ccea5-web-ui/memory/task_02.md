# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Extend daemon security layer: env-gated CORS + WS Origin allowlist via `WORKFLOW_RUNNER_UI_ORIGIN`. Default-closed when env var is unset.

## Important Decisions

- `isOriginAllowed` reads `process.env.WORKFLOW_RUNNER_UI_ORIGIN` internally (not passed as a parameter). Keeps the 2-arg call signature unchanged everywhere — ws-attach.ts required no code change.
- `corsMiddleware(uiOrigin: string)` takes the origin as a parameter (pure factory). `app.ts` reads the env var and calls the factory, so the middleware itself stays testable without env var manipulation.
- CORS preflight returns 204 (standard). Non-preflight responses: creates a new `Response(c.res.body, c.res)` before setting headers to avoid frozen-headers issue. Pattern matches Hono's own cors middleware.
- WS pre-upgrade check: no code change to `ws-attach.ts` needed — `isOriginAllowed` now covers the env var implicitly.

## Learnings

- Hono `c.res.headers.set()` requires re-wrapping: `c.res = new Response(c.res.body, c.res)` before mutation. Otherwise headers may be frozen on the original Response object.
- `corsMiddleware` must be registered AFTER `hostAllowlistMiddleware` in `app.ts` to ensure Host check fires first.

## Files / Surfaces

- `src/app/api/security.ts` — added env branch to `isOriginAllowed`; added `corsMiddleware` export.
- `src/app/api/app.ts` — imported `corsMiddleware`; wired it when `WORKFLOW_RUNNER_UI_ORIGIN` is set.
- `src/app/api/security.test.ts` — added 14 new tests across 3 describe blocks (env-var gating, corsMiddleware unit, CORS integration).
- `src/app/api/routes/ws-attach.ts` — unchanged.

## Errors / Corrections

None.

## Ready for Next Run

Task complete. 742 tests pass, 0 fail. Typecheck clean. All 8 spec test scenarios covered.
