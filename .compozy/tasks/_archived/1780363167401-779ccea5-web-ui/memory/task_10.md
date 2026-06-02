# Task Memory: task_10.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Build the focused live run view: container + transcript + step-progress + input box + stop/retry controls + summary panel. Delivered as `web/src/features/run-view/`.

## Important Decisions

- `RunView` receives a `runId` prop (not from router params) — task_11 handles routing and passes it.
- `RunControls` uses `useMutation` (TanStack Query) for stopRun/retryStep; invalidates `['runs']` query on success.
- Summary panel conditioned on `isTerminal && summary !== null` — "running" status never shows summary even if summary is set.
- Socket closed notice (`vm.closed`) and server error notice (`vm.error`) are both always shown as non-crashing banners, independent of each other.
- `scrollIntoView` must be mocked in tests with `window.HTMLElement.prototype.scrollIntoView = vi.fn()` in `beforeAll`; jsdom does not implement it.

## Learnings

- RTL integration tests for `RunView` need `QueryClientProvider` (for mutations in `RunControls`) + fake WebSocket stub.
- `vi.stubGlobal('WebSocket', FakeWebSocket)` + `vi.unstubAllGlobals()` in `beforeEach/afterEach` pattern works for RunView integration tests.
- `FakeWebSocket` needs static `OPEN=1`/`CLOSED=3` constants matching the real WebSocket, since `attach-client.ts` checks `ws.readyState === WebSocket.OPEN`.
- `act()` from `@testing-library/react` wrapping `ws.receive()` calls flushes React state updates synchronously.
- "Not implemented: Window's scrollTo() method" jsdom warnings are from TanStack Router (pre-existing), not from this task.

## Files / Surfaces

- `web/src/features/run-view/RunView.tsx` — container
- `web/src/features/run-view/Transcript.tsx` — transcript with auto-scroll
- `web/src/features/run-view/StepProgress.tsx` — step breadcrumb
- `web/src/features/run-view/InputBox.tsx` — gated interactive input
- `web/src/features/run-view/RunControls.tsx` — stop/retry + summary panel
- `web/src/features/run-view/RunView.test.tsx` — all tests (unit + integration)

## Errors / Corrections

None.

## Ready for Next Run

- task_11 (routing + app shell) can now mount `/runs/$runId` rendering `<RunView runId={params.runId} />`.
- The `router.tsx` placeholder `RunViewPlaceholder` at `/runs/$runId` should be replaced with `RunView`.
