---
status: completed
title: Parameterize security middleware with `bindHost`
type: backend
complexity: medium
dependencies:
  - task_01
---

# Task 04: Parameterize security middleware with `bindHost`

## Overview

Update the security middleware functions (`allowedHosts()`, `isOriginAllowed()`, `hostAllowlistMiddleware()`) to accept an optional `bindHost` parameter so the `Host`-header allowlist and WebSocket origin check work correctly for non-loopback binds. Thread `bindHost` from the daemon runtime through `createServerApp` and `createApiApp` to the middleware factories.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- `allowedHosts(port)` MUST become `allowedHosts(port, bindHost?: string)` per TechSpec "Core Interfaces" section
- When `bindHost === "0.0.0.0"`, `allowedHosts()` MUST return an empty set (accept all `Host` values)
- When `bindHost` is a specific non-loopback IP (e.g., `192.168.1.100`), `allowedHosts()` MUST include that IP alongside `127.0.0.1:<port>` and `localhost:<port>`
- Default behavior (no `bindHost`) MUST remain the same as today: only `127.0.0.1:<port>` and `localhost:<port>`
- `isOriginAllowed(origin, port)` MUST become `isOriginAllowed(origin, port, bindHost?: string)` with the same logic
- `hostAllowlistMiddleware(port)` MUST become `hostAllowlistMiddleware(port, bindHost?: string)`
- `createApiApp` and `createServerApp` in `src/app/api/app.ts` MUST accept and thread `bindHost` to the middleware factories
- When `bindHost === "0.0.0.0"`, the DNS-rebinding falsification tests MUST still pass (empty allowlist effectively accepts all, but the SECURITY describe block tests should be reviewed)

</requirements>

## Subtasks

- [x] 04.1 Update `allowedHosts()` signature and logic to accept `bindHost`
- [x] 04.2 Update `isOriginAllowed()` signature and logic to accept `bindHost`
- [x] 04.3 Update `hostAllowlistMiddleware()` signature to accept and pass `bindHost`
- [x] 04.4 Update `createApiApp()` and `createServerApp()` to accept and thread `bindHost`
- [x] 04.5 Update the `runDaemon()` call site that creates `createServerApp` to pass the bind host
- [x] 04.6 Write tests for all new middleware behavior

## Implementation Details

See TechSpec "Core Interfaces" section for the exact signatures of `allowedHosts()` and the `isOriginAllowed()` changes. The middleware threading follows the existing pattern where `port` flows from `runDaemon()` → `createServerApp()` → `createApiApp()` → `hostAllowlistMiddleware()`.

### Relevant Files

- `src/app/api/security.ts` — Update `allowedHosts()`, `isOriginAllowed()`, `hostAllowlistMiddleware()` signatures and logic
- `src/app/api/app.ts` — Add `bindHost` parameter to `createApiApp()` and `createServerApp()`, thread to middleware
- `src/infra/daemon/daemon.ts` — Pass `bindHost` to `createServerApp()` at the call site

### Dependent Files

- `src/app/api/security.test.ts` — Add tests for new `bindHost`-aware middleware behavior; review DNS-rebinding falsification tests
- `src/infra/daemon/daemon.test.ts` — If daemon tests exercise the full app creation, they may need update

### Related ADRs

- [ADR-001: Configurable bind address for external access](../adrs/adr-001.md) — Security middleware update per ADR

## Deliverables

- Updated `allowedHosts()`, `isOriginAllowed()`, `hostAllowlistMiddleware()` with `bindHost` parameter
- Updated `createApiApp()` and `createServerApp()` with `bindHost` threading
- Updated `runDaemon()` call site passing resolved bind host
- Updated tests covering all bind-host middleware scenarios
- DNS-rebinding security tests adapted for `0.0.0.0` behavior

## Tests

- Unit tests:
  - [x] "allowedHosts(port) without bindHost returns loopback-only set (existing behavior)"
  - [x] "allowedHosts(port, '0.0.0.0') returns an empty set (accept all)"
  - [x] "allowedHosts(port, '192.168.1.100') includes that IP plus loopbacks"
  - [x] "allowedHosts(port, '192.168.1.100') excludes non-loopback, non-matching IPs"
  - [x] "isOriginAllowed(origin, port, '0.0.0.0') accepts any origin"
  - [x] "isOriginAllowed(origin, port, '192.168.1.100') accepts that origin and loopbacks"
  - [x] "hostAllowlistMiddleware(port, '0.0.0.0') accepts any Host header"
  - [x] "hostAllowlistMiddleware(port, '192.168.1.100') accepts that Host and loopbacks"
  - [x] "hostAllowlistMiddleware(port, '192.168.1.100') rejects unrelated Host headers"
- Integration tests:
  - [x] "createApiApp with bindHost='0.0.0.0' accepts request with foreign Host"
  - [x] "createApiApp with bindHost='192.168.1.100' accepts request with that IP as Host"
  - [x] "createApiApp with bindHost='192.168.1.100' rejects request with foreign Host"
- Test coverage target: >=80%
- All tests must pass

## Success Criteria

- All tests passing
- Test coverage >=80%
- Default behavior (no bindHost) unchanged — loopback-only allowlist
- `0.0.0.0` bind disables Host allowlist (accept all)
- Specific LAN IP adds that IP to the allowlist alongside loopback
- Existing DNS-rebinding security tests continue to pass for loopback bind
