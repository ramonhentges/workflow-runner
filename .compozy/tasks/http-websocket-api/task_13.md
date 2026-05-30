---
status: completed
title: Listener mount + bind assertion + discovery file + no-regression test
type: backend
complexity: high
dependencies:
    - task_03
    - task_11
    - task_12
---

# Task 13: Listener mount + bind assertion + discovery file + no-regression test

## Overview
Mount the assembled Hono app (routes + security middleware + WS handler) on `Bun.serve` inside the
daemon, bound to IPv4 loopback at a fixed default port (overridable), assert the bind is not public,
and publish the live port to a discovery file so a future UI can find it. Includes the no-regression
test proving the new listener does not starve the existing UDS JSON-RPC surface.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST mount the task-03 app (with task-11 middleware and the task-12 WS handler) on `Bun.serve`
  bound to `hostname: "127.0.0.1"` inside `runDaemon`, alongside the existing `bindSocket`.
- MUST default to port 4517, overridable by a daemon flag and/or `WORKFLOW_RUNNER_API_PORT` env.
- MUST assert after listen that the bound address is `127.0.0.1` (not `::`/`0.0.0.0`); a non-loopback
  bind MUST abort daemon startup with a clear message.
- MUST write a `DiscoveryFile` (`{ pid, apiPort, socket }`) to `daemon.json` in the storage root with
  `0600` permissions on successful bind.
- MUST pass the configured port to the task-11 allowlist factory.
- MUST NOT change the existing UDS bind/serve behavior.
</requirements>

## Subtasks
- [x] 13.1 Add API-port resolution (default 4517, flag + env override) and the loopback bind.
- [x] 13.2 Mount the Hono app + WS handler on `Bun.serve` within `runDaemon` alongside `bindSocket`.
- [x] 13.3 Add the post-listen loopback bind assertion that aborts startup on a public bind.
- [x] 13.4 Write the `daemon.json` discovery file (0600) on bind; pass the port to the allowlist.
- [x] 13.5 Add the no-regression test (N idle WS connections vs UDS latency/RSS).

## Implementation Details
Extend `runDaemon` in `src/infra/daemon/daemon.ts`: after `discoverOnStartup()` and the UDS
`bindSocket`, start the `Bun.serve` listener with the app's fetch handler and the Bun websocket
config from task 12. Reuse `RunStore.resolveStorageRoot()`/the existing storage-root for the
discovery file path, mirroring how the socket/lockfile are placed. See TechSpec "System Architecture",
"Monitoring" (`api.started`, `api.bindRejected`), and ADR-005.

### Relevant Files
- `src/infra/daemon/daemon.ts` — `runDaemon`, `bindSocket`, storage-root/socket/lockfile placement.
- `src/app/api/` app + WS handler (tasks 03/11/12) — what gets mounted.
- `src/app/api/schema.ts` — `DiscoveryFile` shape.
- `src/app/cli.ts` / `src/app/commands/daemon.ts` — daemon flag parsing for `--api-port`.

### Dependent Files
- `src/infra/client/spawn.ts` / `client.ts` — future consumers may read `daemon.json` (not required here).
- Task 14 (shutdown) — extends the shutdown path to stop this listener and remove `daemon.json`.

### Related ADRs
- [ADR-005: In-process Hono listener at a fixed loopback port with a discovery file](../adrs/adr-005.md) — the full mount/bind/discovery decision.
- [ADR-001: V1 scope and architectural shape](../adrs/adr-001.md) — bind assertion + no-regression KPI.

## Deliverables
- `Bun.serve` listener mounted in `runDaemon` (loopback, default 4517, overridable).
- Post-listen bind assertion + `daemon.json` discovery file (0600).
- No-regression latency/RSS test.
- Unit tests with 80%+ coverage **(REQUIRED)**
- Integration tests for bind/discovery + no-regression **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Port resolution prefers the flag, then env, then the 4517 default.
  - [x] The bind assertion aborts startup when the bound address is not `127.0.0.1`.
  - [x] On bind, `daemon.json` is written with `{ pid, apiPort, socket }` and `0600` permissions.
- Integration tests:
  - [x] With N=20 idle WS connections open (within MAX_WS_CONNECTIONS=50), UDS p95 latency < 5 ms and RSS delta < 25 MB.
  - [x] After daemon start, a client reading `daemon.json` connects to the live API port.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- The API serves on loopback at the discovered port; a public bind is impossible.
- The existing UDS JSON-RPC surface shows no meaningful latency/footprint regression.
