---
status: completed
title: Daemon integration test suite
type: test
complexity: high
dependencies:
  - task_11
  - task_12
  - task_14
---

# Task 19: Daemon integration test suite

## Overview
Implement the seven end-to-end integration scenarios from the TechSpec: lifecycle, concurrent runs, attach/detach, daemon-restart discovery, multi-attach (Phase 2 stub), `stop` semantics, and auto-spawn. Each scenario spawns the real daemon over a temp Unix socket with a fake agent factory injected, exercising every layer end-to-end without requiring the real `opencode` binary.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/infra/daemon/__tests__/integration/` with one file per scenario (`lifecycle.test.ts`, `concurrent-runs.test.ts`, `attach-detach.test.ts`, `restart-discovery.test.ts`, `multi-attach.test.ts`, `stop-semantics.test.ts`, `auto-spawn.test.ts`).
- MUST provide a shared `harness.ts` helper in `src/infra/daemon/__tests__/integration/` that:
  - Creates a per-test temp directory via `Bun.tempdir`/`mkdtempSync`.
  - Spawns the daemon process (`runDaemon` invoked in a child Bun process via `Bun.spawn`).
  - Injects a fake `RunnerAgentSessionFactory` via env var (e.g., `WORKFLOW_RUNNER_FAKE_FACTORY=1` honored by daemon entry when `NODE_ENV === "test"`).
  - Returns a connected `DaemonClient` and a `cleanup()` function that SIGTERMs the daemon and removes the temp dir.
- MUST register the fake factory at daemon startup gated on `NODE_ENV === "test"` so production behavior is unaffected. The fake factory's behavior is controlled via per-test workflow JSON files referencing fake step descriptions that the factory interprets (e.g., `"fake:complete"`, `"fake:fail"`, `"fake:hang-for-attach"`).
- MUST clean up sockets, processes, and temp dirs in `afterEach` even on test failure (use try/finally pattern).
- MUST cover the seven scenarios as documented below; multi-attach test is allowed to be marked `.skip` with a TODO referencing Phase 2.
</requirements>

## Subtasks
- [x] 19.1 Build the `harness.ts` helper with daemon spawn, fake-factory injection, client connect, and cleanup.
- [x] 19.2 Build the fake `RunnerAgentSessionFactory` with deterministic behavior driven by step `description` markers.
- [x] 19.3 Wire the fake factory into `src/infra/daemon/daemon.ts` behind the `NODE_ENV === "test"` gate.
- [x] 19.4 Implement each of the seven scenario files.
- [x] 19.5 Add a CI-friendly script to `package.json` that runs only the integration tests (`bun test src/infra/daemon/__tests__/integration/`).

## Implementation Details
Create the integration test infrastructure under `src/infra/daemon/__tests__/integration/`. The harness uses `Bun.spawn(['bun', 'src/index.ts', 'daemon'], {env: {...process.env, XDG_STATE_HOME: tempDir, NODE_ENV: 'test', WORKFLOW_RUNNER_FAKE_FACTORY: '1'}})`. The fake factory parses the step `description` for marker prefixes:
- `fake:complete` → resolves outcome `{kind: "finish", message: "fake complete"}` after 50 ms.
- `fake:handoff <step-id>` → resolves outcome `{kind: "handoff", nextStep: <step-id>, message: "fake handoff"}`.
- `fake:fail <reason>` → resolves outcome `{kind: "failure", failedStep: <current>, reason: <reason>}`.
- `fake:hang` → never resolves (used for attach/stop tests).
- `fake:interactive` → an interactive step that resolves only when a user message arrives via `sendUserInput`.

Test workflow JSON files live alongside the test files (e.g., `fixtures/fake-complete.json`). Each test deserves <150 LOC; resist the temptation to test multiple things per scenario file.

### Relevant Files
- `src/infra/daemon/daemon.ts` (task 11) — spawned by the harness; modified to honor the fake-factory env var in test mode.
- `src/infra/daemon/run-manager.ts` (task 08) — receives the fake factory.
- `src/infra/client/client.ts` (task 12) — used by the harness.
- `src/infra/tui/tui.ts` (task 14) — used by the attach-detach scenario.
- `src/domain/runner.ts` — defines `RunnerAgentSessionFactory` interface the fake implements.

### Dependent Files
- `package.json` — add the integration-tests-only script.
- `src/infra/daemon/daemon.ts` — gated fake-factory wiring.

### Related ADRs
- [ADR-001: V1 Scope for Daemon Mode](adrs/adr-001.md) — defines the daemon-restart discovery scenario.
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — defines the auto-spawn scenario behavior.
- [ADR-006: Attach Replay via Per-Run Ring Buffer + Disk Fallback](adrs/adr-006.md) — defines the attach replay behavior the attach scenario verifies.

## Deliverables
- Seven scenario test files plus the `harness.ts` helper.
- The fake `RunnerAgentSessionFactory` implementation.
- The gated wiring in `daemon.ts`.
- New `bun test:integration` script in `package.json`.
- All integration tests pass on a clean checkout **(REQUIRED)**

## Tests
- Unit tests:
  - [ ] Fake factory: each marker (`fake:complete`, `fake:handoff`, `fake:fail`, `fake:hang`, `fake:interactive`) produces the expected outcome in isolation.
  - [ ] Harness: spawning the daemon and connecting the client succeeds; cleanup terminates the process and removes the temp dir.
- Integration tests:
  - [ ] **Lifecycle**: `start` a workflow with `fake:complete` → daemon emits banner + completion events → run reaches `completed` → `meta.json` on disk has `status: "completed"` → `ps` shows the run.
  - [ ] **Concurrent runs**: `start` 3 workflows in parallel → all reach `completed` → final `ps` lists 3 completed runs with distinct ids.
  - [ ] **Attach/detach**: `start` a workflow with `fake:hang` step → `attach` from a mock TUI subscriber → receive the banner backlog → `detach` → daemon log shows no further events for that subscriber.
  - [ ] **Daemon-restart discovery**: `start` a workflow with `fake:hang` → `kill -9` the daemon process → restart the daemon via the harness → `ps` shows the run as `crashed` → `retryStep` it with a fake factory that completes → run reaches `completed`.
  - [ ] **Multi-attach (Phase 2)**: marked `.skip` with a TODO referencing F8 and ADR-002.
  - [ ] **Stop semantics**: `start` a workflow with `fake:hang` → `stop` it → status reaches `aborted` within 5 s → `meta.json` shows `status: "aborted"`.
  - [ ] **Auto-spawn**: without a running daemon, invoke `start workflow.json` via the CLI entry point (using `Bun.spawn`) → daemon is auto-spawned → workflow runs → exit code 0.
- Test coverage target: integration tests verify end-to-end behavior, not LOC coverage; >=80% LOC coverage is achieved by the unit tests in tasks 01-18.
- All tests must pass

## Success Criteria
- All seven scenarios pass on a clean repo via `bun test src/infra/daemon/__tests__/integration/`.
- No leaked sockets, processes, or temp dirs after `bun test` exits (verified manually).
- Tests do not require the real `opencode` binary on the test runner.
- Tests take less than 30 s total wall time on a typical dev machine.
