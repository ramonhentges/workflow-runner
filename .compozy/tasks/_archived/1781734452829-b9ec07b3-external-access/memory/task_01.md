# Task Memory: task_01.md

## Objective Snapshot
Add `bindHost` to `RunDaemonOptions`, implement `resolveBindHost()`, add `DEFAULT_BIND_HOST` constant.

## Important Decisions
- Env var name: `WORKFLOW_RUNNER_HOST` (per TechSpec, not `WORKFLOW_RUNNER_BIND_HOST` from PRD/ADR). TechSpec explicitly notes the `--flag` → `WORKFLOW_RUNNER_FLAG` naming pattern matches `--api-port` → `WORKFLOW_RUNNER_API_PORT`.

## Learnings
- `resolveBindHost` needs no port validation (unlike `resolveApiPort` which validates port range).
- Empty string env value is falsy, so falls through to default without special handling.

## Files / Surfaces
- `src/infra/daemon/daemon.ts` — added `DEFAULT_BIND_HOST`, `bindHost` on `RunDaemonOptions`, `resolveBindHost()`
- `src/infra/daemon/daemon.test.ts` — added `resolveBindHost` test block (6 tests)

## Errors / Corrections
- None

## Ready for Next Run
- Tests pass → update shared memory with env var name decision, then close task.
