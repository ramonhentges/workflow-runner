---
status: completed
title: RunManager — concurrent run lifecycle
type: infra
complexity: high
dependencies:
  - task_03
  - task_04
  - task_05
---

# Task 08: RunManager — concurrent run lifecycle

## Overview
Implement the daemon's central run-orchestration component: owns the set of active runs, spawns per-run `McpServer` and `Runner` instances, wires the `EventLog` as a `RunnerObserver`, manages subscribers (attached TUIs), and handles `startRun` / `retryStep` / `stop` / `sendInput` lifecycle. This is where the daemon's concurrency lives.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/run-manager.ts`.
- MUST expose the constructor `new RunManager(storageRoot: string, sessionFactory: RunnerAgentSessionFactory)`.
- MUST expose `discoverOnStartup(): Promise<void>` that calls `RunStore.discoverAndMarkOrphans()` and populates the in-memory registry with the *crashed* snapshots (no active `Runner` is started for them).
- MUST expose `startRun(workflowPath: string): Promise<{runId, slug}>` that loads the workflow, generates a non-colliding id and slug, creates a `Run`, persists initial `meta.json`, instantiates a fresh `McpServer`, instantiates a `Runner` with the existing `AcpAgentSessionFactory`, attaches an `EventLogObserver` writing to a new `EventLog`, supplies the `onStepBoundary` callback that persists `meta.json` between steps, and starts `runner.run()` in the background.
- MUST expose `list(): RunSnapshot[]` returning active + recently-terminal (within ~24 h) snapshots in `ps` order (active first, then terminal-state by recency).
- MUST expose `get(idOrPrefix: string): ActiveRun | undefined` resolving an unambiguous prefix via `parseIdentifier` from task 02.
- MUST expose `retryStep(runId: RunId): Promise<void>` valid only for crashed/failed/aborted runs; it re-instantiates a fresh `McpServer` and `Runner`, calls `runner.run(failedStepId)` with the persisted kickoff prompt seeded as `inboundMessage`, emits a `log` event with the "↻ retrying step-N — LLM output may differ" banner *before* the runner starts.
- MUST expose `stop(runId): Promise<void>` performing the graceful-then-forceful SIGTERM/SIGKILL via `Runner` and `AgentSession` dispose (5 s grace).
- MUST expose `sendInput(runId, message): Promise<void>` that queues the message for the run's current interactive step; rejects with `RUN_NOT_INTERACTIVE` error if the current step is autonomous.
- MUST expose `attachSubscriber(runId, sub: RunSubscriber): () => void` that adds the subscriber to the run's fan-out set; the subscriber's `onEvent` is called for every subsequent event. Returns a detach function.
- MUST expose `shutdown(): Promise<void>` that closes per-run MCP servers and event logs without killing in-flight `Runner` instances (per ADR-001, `shutdown` lets runs keep running until the process exits).
- MUST enforce a configurable run-limit (default 16); `startRun` past the limit rejects with `RUN_LIMIT_REACHED`.
- MUST never propagate a runner failure into `startRun`'s promise — `startRun` returns as soon as the run is registered; the runner's success/failure flows through `EventLog` and `meta.json` updates.
</requirements>

## Subtasks
- [x] 8.1 Implement the `ActiveRun` record type and the in-memory `Map<RunId, ActiveRun>` registry.
- [x] 8.2 Implement `discoverOnStartup` wiring to `RunStore.discoverAndMarkOrphans`.
- [x] 8.3 Implement `startRun` including id/slug collision retry, MCP-server spawn, Runner construction with `onStepBoundary`, and background `runner.run()` launch with proper error capture into `meta.json`.
- [x] 8.4 Implement `retryStep` with the visible banner emission and fresh MCP server / Runner construction.
- [x] 8.5 Implement `stop`, `sendInput`, `attachSubscriber`, `list`, `get` with the documented semantics.
- [x] 8.6 Implement `shutdown` closing MCP servers and event logs cleanly.
- [x] 8.7 Write unit tests with a fake `RunnerAgentSessionFactory` covering happy path, retry, stop, send, subscribe, concurrent runs, limit enforcement, and discoverOnStartup.

## Implementation Details
Create `src/infra/daemon/run-manager.ts`. Use the existing `McpServer.start()`, the existing `AcpAgentSessionFactory`, the new `Run`, `RunStore`, `EventLog`, and `Runner.onStepBoundary` from earlier tasks. The `EventLogObserver` is a small adapter implementing `RunnerObserver` that calls `eventLog.append(event, currentStepId)` and also fans out to attached subscribers. The retry banner is emitted *via the event log* (so it persists to disk and replays on attach) as a synthetic `{type: "log", message: "↻ retrying step-N — LLM output may differ from the previous attempt"}` event tagged with the failed step id.

### Relevant Files
- `src/domain/run.ts` (task 01) — `Run` aggregate.
- `src/domain/run-id.ts` (task 02) — id/slug generators, `parseIdentifier`.
- `src/domain/runner.ts` (task 03) — `Runner` with `onStepBoundary` support.
- `src/infra/daemon/run-store.ts` (task 04) — `RunStore.persist` / `load` / `discoverAndMarkOrphans`.
- `src/infra/daemon/event-log.ts` (task 05) — `EventLog` per active run.
- `src/infra/mcp/mcp-server.ts` — existing per-run MCP server.
- `src/infra/acp/agent-session.ts` — existing `AcpAgentSessionFactory`.
- `src/domain/workflow.ts` — `Workflow.load(path)` for resolving workflow JSON at `startRun` time.

### Dependent Files
- `src/infra/daemon/handlers/*` (tasks 09, 10) — every handler is a thin call into a `RunManager` method.
- `src/infra/daemon/daemon.ts` (task 11) — constructs the `RunManager` and calls `discoverOnStartup` at process start.

### Related ADRs
- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — defines the retry banner wording and the no-auto-resume rule.
- [ADR-003: One McpServer Instance Per Run](adrs/adr-003.md) — establishes per-run MCP server lifecycle owned by RunManager.
- [ADR-005: Code Layout — Domain Run + Infra Adapters + App CLI Dispatcher](adrs/adr-005.md) — places RunManager in `infra/daemon/`.

## Deliverables
- `src/infra/daemon/run-manager.ts` with the full lifecycle surface.
- Fake `RunnerAgentSessionFactory` exported from a test helper module for use by handler tests in tasks 09/10.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] `startRun` with a valid workflow returns a `{runId, slug}` with id of length 8 and slug matching `/[a-z]+-[a-z]+/`.
  - [ ] `startRun` immediately persists `meta.json` with `status: "running"`, `currentStepId: <entry>`.
  - [ ] `startRun` with a fake factory that completes the run produces `meta.json` with `status: "completed"` at the end.
  - [ ] `startRun` with a fake factory that throws on the second step produces `meta.json` with `status: "failed"` and `endReason` referencing the thrown error.
  - [ ] Two concurrent `startRun` calls produce distinct (non-colliding) ids and slugs.
  - [ ] When the id generator returns a colliding value, `startRun` retries until a fresh id is produced (use injectable rand source to force collision once).
  - [ ] `startRun` past the run limit (configured to 1 for the test) rejects with an error whose code is `RUN_LIMIT_REACHED`.
  - [ ] `list()` after starting 3 runs returns 3 entries; after one finishes, the finished entry comes after the two active ones.
  - [ ] `get("abc")` with two runs whose ids both start with "abc" throws / returns ambiguous (depending on chosen signature; document and test the chosen behavior).
  - [ ] `retryStep` on a run with status `crashed` re-spawns the fake factory, emits the retry-banner log event into the event log, transitions status to `running`.
  - [ ] `retryStep` on a run with status `running` rejects with `RUN_NOT_RETRY_ELIGIBLE`.
  - [ ] `sendInput` on a run currently in an interactive step calls `runner.provideInput()` on the active session.
  - [ ] `sendInput` on a run currently in an autonomous step rejects with `RUN_NOT_INTERACTIVE`.
  - [ ] `attachSubscriber` registers a subscriber that receives all subsequent runner events; the returned detach function removes the subscriber and prevents further deliveries.
  - [ ] `discoverOnStartup` seeded with two on-disk `running` runs leaves them as `crashed` and surfaces them in `list()` with no active `Runner` instances.
  - [ ] `stop` on a run with active subprocess sends SIGTERM (verified via the fake factory), waits 5 s grace, then dispose; status transitions to `aborted`.
  - [ ] `shutdown` closes all MCP servers (verified via a mock counter) without disposing the active runners.
- Integration tests:
  - [ ] Covered by task 19's "Concurrent runs" and "Daemon-restart discovery" scenarios end-to-end.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- Concurrent `startRun` calls produce non-colliding ids in a 100-run stress test.
- The retry-banner log appears in `events.jsonl` before any new banner from the retried step (verified by seq ordering in tests).
