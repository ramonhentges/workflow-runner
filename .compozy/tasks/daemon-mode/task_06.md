---
status: completed
title: Daemon protocol shared types
type: infra
complexity: low
dependencies:
  - task_01
  - task_05
---

# Task 06: Daemon protocol shared types

## Overview
Declare the shared TypeScript types for the JSON-RPC method names, parameters, results, notifications, and error codes used between the daemon (server) and the CLI client. This single source of truth is what catches client/server divergence at compile time.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/protocol.ts`.
- MUST export a `RpcMethods` interface mapping each of the eight method names to a `{params, result}` shape (see TechSpec → "API Endpoints" table for the surface).
- MUST export an `RpcNotification` discriminated union for the three server-pushed notification kinds (`event.run.event`, `event.run.statusChanged`, `event.run.writerSlot`).
- MUST export the `RpcErrorCode` enum/const-object with the six error codes (`UNKNOWN_RUN`, `WORKFLOW_INVALID`, `RUN_NOT_INTERACTIVE`, `RUN_NOT_RETRY_ELIGIBLE`, `AMBIGUOUS_PREFIX`, `RUN_LIMIT_REACHED`, `DAEMON_SHUTTING_DOWN`) with their integer values from the TechSpec.
- MUST export a `RunListEntry` type representing a single row in the `run.ps` result.
- MUST export a `DoctorReport` type with one field per subsystem reported by `daemon.doctor` (see TechSpec → "Monitoring and Observability").
- MUST NOT import anything from `src/infra/client/` or `src/app/` (sibling-infra and pure-domain imports only).
- MUST be the single import source for protocol types in both daemon handlers and the client (no duplicated type declarations elsewhere).
</requirements>

## Subtasks
- [x] 6.1 Declare `RpcMethods` with one entry per JSON-RPC method, params/result types referencing `RunSnapshot` / `EventLogEntry` / `RunId` / `RunSlug` from existing modules.
- [x] 6.2 Declare `RpcNotification` discriminated union for the three notification kinds.
- [x] 6.3 Declare `RpcErrorCode` const object plus a derived `RpcErrorName` string-union type.
- [x] 6.4 Declare `RunListEntry` and `DoctorReport` types.
- [x] 6.5 Add a tiny type-only smoke test (a TypeScript file that exercises the types via dummy assignments) to ensure shapes compile correctly under strict mode.

## Implementation Details
Create `src/infra/daemon/protocol.ts`. Re-export `RunSnapshot`, `RunStatus`, `RunId`, `RunSlug`, and `EventLogEntry` from this module so downstream consumers have a single import path for "protocol surface." The error codes are integers; using a `const`-object plus `as const` and a derived type keeps both numeric and name accessible. There is intentionally no runtime parsing or validation in this file — those live with the dispatcher in task 07. This task is types-only.

### Relevant Files
- `src/domain/run.ts` (task 01) — provides `RunSnapshot`, `RunStatus`, `RunId`, `RunSlug`.
- `src/infra/daemon/event-log.ts` (task 05) — provides `EventLogEntry`.
- `src/domain/runner.ts` — provides `RunnerEvent` referenced inside notifications.

### Dependent Files
- `src/infra/daemon/rpc/server.ts` (task 07) — imports `RpcMethods`/`RpcNotification`/`RpcErrorCode` to dispatch and validate.
- `src/infra/daemon/handlers/*` (tasks 09, 10) — each handler's signature is derived from `RpcMethods[<method-name>]`.
- `src/infra/client/client.ts` (task 12) — uses the same types to type-check requests and responses.

### Related ADRs
- [ADR-004: JSON-RPC 2.0 over NDJSON for the Daemon Protocol](adrs/adr-004.md) — establishes method namespace, error code shape, and notification-vs-response distinction.

## Deliverables
- `src/infra/daemon/protocol.ts` with all shared types.
- Type re-exports (`RunSnapshot` etc.) so consumers have one import path.
- Type-only smoke test asserting compile-time correctness **(REQUIRED)**

## Tests
- Unit tests:
  - [x] Type-only test: a `.ts` file that constructs literal values for each `RpcMethods` entry's `params` and `result`, then asserts assignment to the indexed type via `satisfies`. Compile failure = test failure.
  - [x] Type-only test: construct each `RpcNotification` variant and assert via `satisfies RpcNotification`.
  - [x] Type-only test: each error code's numeric value matches the TechSpec table (`expect(RpcErrorCode.UNKNOWN_RUN).toBe(-32000)`, etc.).
  - [x] Runtime test: enumerate `RpcErrorCode` keys; assert no duplicate integer values.
- Integration tests:
  - [x] None — this task is types-only.
- Test coverage target: >=80% (mostly type assertions; minimal runtime code)
- All tests must pass

## Success Criteria
- All tests passing
- `bun run typecheck` passes with no errors.
- No runtime logic in this file beyond the const error-code object.
- Both `src/infra/daemon/` and `src/infra/client/` import shared types from this file (verified by grep).
