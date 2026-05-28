---
status: completed
title: JSON-RPC handlers — lifecycle
type: infra
complexity: medium
dependencies:
  - task_07
  - task_08
---

# Task 09: JSON-RPC handlers — lifecycle

## Overview
Implement the four lifecycle JSON-RPC method handlers — `run.start`, `run.stop`, `run.retryStep`, `run.ps` — as thin glue from RPC params to `RunManager` methods. Each handler is one file under `src/infra/daemon/handlers/` for grep-ability.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/handlers/run-start.ts`, `run-stop.ts`, `run-retry-step.ts`, `run-ps.ts`.
- Each handler MUST export a factory function `createRunStartHandler(rm: RunManager): RpcHandler<"run.start">` (etc.) returning a handler that calls the matching `RunManager` method.
- Each handler MUST map domain errors to the corresponding `RpcErrorCode` JSON-RPC error envelope:
  - `WORKFLOW_INVALID` for workflow load failures in `run.start`.
  - `RUN_LIMIT_REACHED` for over-limit `run.start`.
  - `UNKNOWN_RUN` for unresolvable run ids in `run.stop` / `run.retryStep`.
  - `AMBIGUOUS_PREFIX` (with `data.candidates`) for ambiguous id/slug prefixes.
  - `RUN_NOT_RETRY_ELIGIBLE` for `run.retryStep` on a non-eligible run.
- `run.ps` MUST return `{runs: RunListEntry[]}` derived from `RunManager.list()` mapped to the `RunListEntry` shape (snapshot fields plus `attachedCount`).
- Each handler MUST be testable in isolation by passing a mock `RunManager`.
</requirements>

## Subtasks
- [x] 9.1 Implement `run-start.ts` mapping `{workflowPath}` → `RunManager.startRun` with error envelope mapping.
- [x] 9.2 Implement `run-stop.ts` resolving the id prefix and calling `RunManager.stop`.
- [x] 9.3 Implement `run-retry-step.ts` resolving the prefix, calling `RunManager.retryStep`, returning `{resumedStepId}`.
- [x] 9.4 Implement `run-ps.ts` calling `RunManager.list` and shaping into `RunListEntry[]`.
- [x] 9.5 Add a shared helper for prefix resolution + ambiguity envelope (avoid duplicating across handlers); place in `src/infra/daemon/handlers/_resolve-run.ts`.
- [x] 9.6 Write unit tests for each handler using a mock RunManager.

## Implementation Details
Create the four handler files plus the shared `_resolve-run.ts` helper. Each handler is a factory function rather than a free function so the `RunManager` reference can be injected for testing. The dispatcher (task 11) registers all four with the JSON-RPC server. The factory pattern lets task 19 swap in a test `RunManager` for end-to-end integration tests. Error mapping: catch the typed errors `RunManager` throws (e.g., a `RunLimitReachedError`) and convert to JSON-RPC errors with the correct `RpcErrorCode`. The mapping table is small enough to live inline in each handler.

### Relevant Files
- `src/infra/daemon/protocol.ts` (task 06) — `RpcMethods`, `RpcErrorCode`, `RunListEntry`.
- `src/infra/daemon/rpc/server.ts` (task 07) — `RpcHandler`, `RpcContext` types.
- `src/infra/daemon/run-manager.ts` (task 08) — the methods these handlers call.
- `src/domain/run-id.ts` (task 02) — `parseIdentifier` for prefix resolution (used inside `_resolve-run.ts`).

### Dependent Files
- `src/infra/daemon/daemon.ts` (task 11) — calls each handler factory and registers with the RPC server.

### Related ADRs
- [ADR-004: JSON-RPC 2.0 over NDJSON for the Daemon Protocol](adrs/adr-004.md) — method names, error code shape.
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — `ps` row shape and ATTACHED marker semantics.

## Deliverables
- Four handler files plus the shared `_resolve-run.ts` helper.
- Each handler is type-checked against its `RpcMethods` entry.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `run.start({workflowPath: "/tmp/wf.json"})` with a mock RunManager that returns `{runId:"abc12345", slug:"brave-otter"}` resolves with `{runId:"abc12345", slug:"brave-otter"}`.
  - [x] `run.start` with a mock RunManager throwing `WorkflowInvalidError("malformed")` rejects with a JSON-RPC error of code `WORKFLOW_INVALID` and message containing `"malformed"`.
  - [x] `run.start` with a mock RunManager throwing `RunLimitReachedError` rejects with code `RUN_LIMIT_REACHED`.
  - [x] `run.stop({runId:"abc"})` with a single matching run calls `rm.stop("abc12345")` and resolves with `{finalStatus:"aborted"}`.
  - [x] `run.stop({runId:"a"})` with two ambiguous candidates rejects with code `AMBIGUOUS_PREFIX` and `error.data.candidates` containing both ids.
  - [x] `run.stop({runId:"zzzz"})` with no matches rejects with code `UNKNOWN_RUN`.
  - [x] `run.retryStep` on an eligible run resolves with `{resumedStepId}`.
  - [x] `run.retryStep` on a `running` run rejects with code `RUN_NOT_RETRY_ELIGIBLE`.
  - [x] `run.ps` with three active runs returns `{runs: [3 entries]}`; each entry has the expected fields (`id, slug, workflowPath, status, currentStepId, startedAt, attachedCount`).
  - [x] `run.ps` sorts active runs before terminal-state runs (verified by ordering the returned list).
  - [x] `_resolve-run.ts` returns the canonical run when given an exact id, an exact slug, or an unambiguous prefix; throws typed errors for ambiguity and not-found.
- Integration tests:
  - [ ] Covered by task 19 end-to-end against a real RunManager and RPC server.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Each handler file stays under 60 LOC (thin glue, not logic).
- No prefix-resolution logic is duplicated across handlers (centralized in `_resolve-run.ts`).
