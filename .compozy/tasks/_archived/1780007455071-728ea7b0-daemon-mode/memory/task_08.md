# Task Memory: task_08.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implemented RunManager (concurrent run lifecycle) and associated test helpers. All acceptance criteria met.

## Important Decisions

- `makeEventLogObserver` captures `[...record.subscribers]` at emit-time (before `await eventLog.append`) so late-attached subscribers never receive events that predate their attachment.
- After capture, re-checks `record.subscribers.has(sub)` before delivery to handle detach during the append await.
- `onStepBoundary` receives `nextInboundMessage` so RunManager can store the raw inbound message (not the built kickoff) in `kickoffPrompts` for exact retry reproduction.
- `Runner.stop()` / `Runner.stopRequested` getter added to domain so RunManager can signal abort and detect it in `#launchRunner`.
- `Run.fromSnapshot({...snap, status: "running", endedAt: null})` used in `retryStep` to reset terminal runs cleanly.
- Injectable `generateId`, `generateSlug`, `createMcpServer` options let tests force collisions and inject fake MCP servers without filesystem side effects.

## Learnings

- Collision retry test needed 3 slugs (not 2) because both the id collision and slug collision retries each consume a slug.
- Comparing branded `RunId` with `.toBe("string-literal")` fails TypeScript; use `asRunId("...")` in test assertions.
- `factory.createCallCount` assertions after `retryStep` must await `record.runPromise` first — runner creation is asynchronous.

## Files / Surfaces

- `src/domain/runner.ts` — added `stop()`, `stopRequested` getter, `startInboundMessage` param on `run()`, `nextInboundMessage` param on `onStepBoundary`/`notifyStepBoundary`
- `src/infra/daemon/run-manager.ts` — new file, full implementation
- `src/infra/daemon/test-helpers/fake-session-factory.ts` — new file, `FakeSession`, `FakeSessionFactory`, `ControllableSessionFactory`
- `src/infra/daemon/run-manager.test.ts` — new file, 21 tests (all passing)

## Status

Completed. 173/173 tests pass, typecheck clean, build clean.
