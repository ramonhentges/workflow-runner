# Task Memory: task_11.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Wire AppShell + TanStack Router routes (/, /start, /runs/$runId, not-found). Tests: unit (runId param, close() on unmount, not-found) + integration (full loop + CwdSwitcher persistence).

## Important Decisions

- AppShell is the rootRoute component; notFoundComponent set on rootRoute (renders inside Outlet area when no child matches).
- RunPage function reads params via `runRoute.useParams()` — hoisted function declaration so no TDZ issue.
- FakeWebSocket stubbed globally in routing.test.tsx beforeEach; unstubbed in afterEach.
- useCwdStore reset with setState({ cwds: [], activeCwdId: null }) in beforeEach.
- No active cwd → RunsTable shows no-cwd-state without calling GET /runs (safe shortcut for tests).

## Learnings

- useAttach already calls client.close() on useEffect cleanup; WebSocket.readyState === CLOSED after unmount confirms this.
- TanStack Router v1 Link className + activeProps.className are concatenated (merged), not replaced.

## Files / Surfaces

- web/src/app/AppShell.tsx (new)
- web/src/router.tsx (updated)
- web/src/__tests__/App.test.tsx (updated - remove placeholder assertions)
- web/src/__tests__/routing.test.tsx (new)

## Errors / Corrections

## Ready for Next Run

DONE. All subtasks complete, 180 tests pass, coverage 98.92%/92.22%/100%/99.2%. Diff ready for manual review — no auto-commit.
