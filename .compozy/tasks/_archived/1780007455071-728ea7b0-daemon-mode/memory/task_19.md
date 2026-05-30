# Task Memory: task_19.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Daemon integration test suite — 7 scenarios + harness + fake `RunnerAgentSessionFactory`, gated behind `NODE_ENV=test && WORKFLOW_RUNNER_FAKE_FACTORY=1`. All pass on a clean checkout (no `opencode` required) in <10s wall-time.

## Important Decisions

- The fixture session factory parses **only the first line** of `step.description` for `fake:*` markers; multi-line descriptions are fine but only the first line is matched. Unknown descriptions default to `fake:complete` so tests can carry context in description without changing semantics.
- `dispose()` resolves the outcome (rather than rejecting) so the Runner exits via the normal break path. The actual aborted/failed status is set by `RunManager.#launchRunner` based on `stopRequested`, which is already correct.
- `WORKFLOW_RUNNER_FAKE_OVERRIDE` env var forces every step in the daemon to follow the override marker. Used by the restart-discovery test to make the SAME workflow JSON (`fake:hang`) complete on retry without rewriting the file. Read once at factory construction time.
- Auto-spawn is **disabled** in the restart-discovery test via `connect({spawn: () => {}})`. Without this, a stale socket file from the SIGKILL'd first daemon makes `tryConnect` ECONNREFUSED, which triggers `autoSpawnDaemon`. The auto-spawn forks via `child_process.spawn` inheriting the bun-test parent env — which does NOT have `WORKFLOW_RUNNER_FAKE_FACTORY=1` — so the auto-spawned daemon races our Bun.spawn and wins the lock with the REAL AcpAgentSessionFactory.

## Learnings

- `Bun.subprocess.kill("SIGKILL")` does not run the daemon's shutdown handler, so the lockfile (PID) AND socket file are left on disk. Production tolerates this via `acquireLock`'s stale-PID check and `bindSocket`'s pre-bind unlink, but under heavy parallel test load PIDs get recycled in seconds and the stale-PID heuristic fails. The restart-discovery test models a user-recovery cleanup by `unlink`-ing both files explicitly between spawns.
- The default Bun test timeout is 5s; long multi-spawn integration scenarios must opt-out via `test(..., async () => {...}, NN_000)`. Inner `waitFor` timeouts have no effect once Bun's outer timeout fires.
- `harness.ts` uses a per-test `mkdtempSync(join(tmpdir(), "wfr-it-"))` so tests cannot collide on storage roots. `XDG_STATE_HOME=tempDir` + daemon entry resolving storageRoot to `${XDG_STATE_HOME}/workflow-runner` keeps client and daemon in sync without passing argv.
- The `parseStartArgs` non-TTY path (`!isTty()`) was load-bearing for the auto-spawn test — the test pipes stdout, which makes `start` auto-detach and print `${runId} ${slug}\n` so we can capture the id and verify completion via a separate client.

## Files / Surfaces

- `src/infra/daemon/test-helpers/fixture-session-factory.ts` (new) — marker-driven `RunnerAgentSessionFactory` + unit tests.
- `src/infra/daemon/test-helpers/fixture-session-factory.test.ts` (new).
- `src/infra/daemon/daemon.ts` — adds `resolveSessionFactory()` async helper; dynamic-imports the fixture factory only when both env vars are set so production builds don't pull in test code.
- `src/infra/daemon/__tests__/integration/harness.ts` (new) — `startDaemonHarness`, `waitFor`, `sleep`, `killDaemon`, `writeFakeWorkflow`.
- `src/infra/daemon/__tests__/integration/{lifecycle,concurrent-runs,attach-detach,restart-discovery,multi-attach,stop-semantics,auto-spawn}.test.ts` (new). Plus `harness.test.ts` as a sanity unit-style test.
- `package.json` — adds `test:integration` script.

## Errors / Corrections

- Initial restart-discovery test relied on `connect()` auto-spawn behavior, which silently forked a real-factory daemon under the wrong env and made retry fail with `status: "failed"` (because `opencode` wasn't available). Diagnosed by capturing the second daemon's stderr (`daemon already running with pid …`) and the run snapshot. Fix: clean the socket+lockfile after kill -9 AND pass `spawn: () => {}` to `connect`.
- Pre-existing flake `run-manager.test.ts: 100 concurrent startRun calls produce non-colliding ids` — slug entropy (200×200=40k) is birthday-paradox-prone for n=100 (~12% collision probability). Out of scope for task_19; not touched. Observed during full-suite runs in this task but unrelated.

## Ready for Next Run

Task complete. Diff is ready for manual review and commit; `auto-commit=false` honored.
