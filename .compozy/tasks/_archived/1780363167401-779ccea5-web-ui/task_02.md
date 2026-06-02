---
status: completed
title: "Backend: env-gated CORS + WS Origin allowlist extension"
type: backend
complexity: medium
dependencies: []
---

# Task 02: Backend: env-gated CORS + WS Origin allowlist extension

## Overview
Allow the web UI, served from its own origin, to reach the loopback daemon API by extending the daemon's security layer — gated entirely by the `WORKFLOW_RUNNER_UI_ORIGIN` environment variable. When the variable is unset, behavior is identical to today (default-closed). This unblocks all browser-based HTTP and WebSocket access.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `isOriginAllowed` MUST additionally accept the value of `WORKFLOW_RUNNER_UI_ORIGIN` (when set) for WS upgrades, in addition to the existing loopback origins.
- The HTTP API MUST emit CORS response headers (origin-reflected for the configured UI origin, credentials disabled) so cross-origin `fetch` and preflight (`OPTIONS`) succeed.
- When `WORKFLOW_RUNNER_UI_ORIGIN` is unset, the Origin allowlist and CORS behavior MUST be unchanged from current (no widening).
- The existing `Host`-header allowlist MUST remain unchanged.
- The loopback bind address MUST NOT change.

## Subtasks
- [x] 02.1 Read the configured UI origin from `WORKFLOW_RUNNER_UI_ORIGIN` and thread it into the origin check.
- [x] 02.2 Extend `isOriginAllowed` to accept the configured origin alongside the loopback origins.
- [x] 02.3 Add a CORS middleware (origin-reflected for the configured origin, handling preflight) and wire it in `app.ts`.
- [x] 02.4 Update the WS pre-upgrade Origin check in `routes/ws-attach.ts` to honor the configured origin.
- [x] 02.5 Cover allowed/blocked and set/unset env-var permutations with tests.

## Implementation Details
Implement per TechSpec "Integration Points" and ADR-004. Changes are confined to `src/app/api/security.ts` (origin check + CORS middleware factory), `src/app/api/app.ts` (wire the CORS middleware alongside the existing `hostAllowlistMiddleware`), and `src/app/api/routes/ws-attach.ts` (pre-upgrade Origin check). Follow the existing middleware patterns in `security.ts`.

### Relevant Files
- `src/app/api/security.ts` — houses `isOriginAllowed`, `allowedHosts`, `hostAllowlistMiddleware`; add origin branch + CORS middleware here.
- `src/app/api/app.ts` — registers middleware; wire CORS when a port is configured.
- `src/app/api/routes/ws-attach.ts` — pre-upgrade Origin allowlist check for WS upgrades.
- `src/app/api/security.test.ts` — existing security tests to extend.

### Dependent Files
- `src/infra/daemon/entry.ts` / daemon bootstrap — reads env; confirm the UI origin is available where the app is constructed (no behavioral change when unset).

### Related ADRs
- [ADR-004: Serve the web UI from its own origin; admit it via an env-gated allowlist + CORS](../adrs/adr-004.md) — The decision this task implements.

## Deliverables
- Extended `isOriginAllowed` honoring `WORKFLOW_RUNNER_UI_ORIGIN`.
- CORS middleware wired into the HTTP API, origin-reflected and preflight-aware.
- Updated WS pre-upgrade Origin check.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for cross-origin HTTP + WS upgrade **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `isOriginAllowed("http://localhost:5173", 4517)` returns false when env unset, true when `WORKFLOW_RUNNER_UI_ORIGIN=http://localhost:5173`.
  - [x] `isOriginAllowed("http://127.0.0.1:4517", 4517)` remains true regardless of env (loopback unchanged).
  - [x] `isOriginAllowed("http://evil.example", 4517)` returns false even when a different UI origin is configured.
  - [x] CORS middleware adds `Access-Control-Allow-Origin` only for the configured origin; absent when env unset.
- Integration tests:
  - [x] `OPTIONS /runs` preflight from the configured origin returns 2xx with CORS headers (via `app.request()`).
  - [x] WS upgrade to `/runs/:id/attach` with `Origin: <configured>` is accepted; with a non-allowed Origin is rejected (403).
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- A browser on the configured origin can call the HTTP API and open the attach WebSocket.
- With the env var unset, the daemon's security posture is identical to before this task.
