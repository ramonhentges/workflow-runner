---
status: completed
title: Loopback security middleware (Host/Origin) + DNS-rebind test
type: backend
complexity: medium
dependencies:
  - task_03
---

# Task 11: Loopback security middleware (Host/Origin) + DNS-rebind test

## Overview
Add the non-negotiable loopback security baseline: a `Host`-header allowlist on HTTP and an
`Origin` allowlist on the WebSocket upgrade, plus a build-failing test that simulates a DNS-rebinding
attempt. This closes the confused-deputy / CSRF attack surface that a localhost no-auth API (which
can spawn agents in arbitrary directories) would otherwise expose.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST add Hono middleware enforcing a `Host`-header allowlist on all HTTP routes, rejecting
  anything not `127.0.0.1:<port>` / `localhost:<port>` with 403.
- MUST provide an `Origin`-allowlist check usable by the WS upgrade (task 12), accepting `null`
  (non-browser/curl) and `http://127.0.0.1:<port>` / `http://localhost:<port>`, rejecting others.
- The allowlist MUST be derived from the configured API port so it stays correct under port override.
- MUST include a DNS-rebinding falsification test: a request with `Host: evil.com` returns 403, and a
  WS upgrade with a foreign `Origin` is rejected. This test MUST fail the build if the control regresses.
- MUST NOT require authentication (localhost-only; this is the authorization baseline, not identity).
</requirements>

## Subtasks
- [x] 11.1 Implement `Host`-allowlist middleware and attach it to the task-03 app.
- [x] 11.2 Implement a reusable `Origin`-allowlist predicate for the WS upgrade.
- [x] 11.3 Parameterize both allowlists by the configured API port.
- [x] 11.4 Write the DNS-rebinding falsification test (HTTP Host + WS Origin).

## Implementation Details
New middleware in `src/app/api/`. The allowlist set is `{127.0.0.1:<port>, localhost:<port>}` for
`Host`, and the same plus `null` for `Origin`. See TechSpec "API Endpoints" (security note),
"Testing Approach → DNS-rebinding falsification", and ADR-001/ADR-005 security baseline. The bind
assertion (that the socket is bound to loopback) is a separate concern handled in task 13.

### Relevant Files
- `src/app/api/` app from task 03 — middleware attachment point.
- `src/app/api/schema.ts` — `DiscoveryFile`/port context if needed for the allowlist.

### Dependent Files
- Task 12 (WS attach) — uses the `Origin` predicate on upgrade.
- Task 13 (listener) — passes the configured port to the middleware factory.

### Related ADRs
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — locked loopback security baseline (F5).
- [ADR-002: V1 surface expansion](../adrs/adr-002.md) — spawn-path widens the blast radius this baseline contains.
- [ADR-005: In-process Hono listener](../adrs/adr-005.md) — port-derived allowlist.

## Deliverables
- `Host`-allowlist HTTP middleware + reusable `Origin`-allowlist predicate.
- DNS-rebinding falsification test (build-failing).
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for allowlist enforcement **(REQUIRED)**

## Tests
- Unit tests:
  - [x] A request with `Host: 127.0.0.1:<port>` or `localhost:<port>` passes; `Host: evil.com` returns 403.
  - [x] `Origin` predicate accepts `null` and the loopback origins; rejects `http://evil.com`.
  - [x] The allowlist tracks an overridden port (rejects the default port when overridden).
- Integration tests:
  - [x] End-to-end: `curl -H "Host: evil.com"` against a live app returns 403; a WS upgrade with a foreign Origin is rejected.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- DNS-rebinding falsification test passes and would fail the build if the control regressed.
- Loopback origins/hosts are accepted; all others are rejected.
