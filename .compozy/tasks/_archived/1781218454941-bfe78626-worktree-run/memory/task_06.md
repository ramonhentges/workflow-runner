# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
CLI entry point for worktree isolation: `start --branch <name>` flag wired to `run.start`; `ps` renders branch/worktree for isolated runs. Complete.

## Important Decisions
- `parseStartArgs` converted from for-of to index-based while loop to consume `--branch <value>`. Supports both `--branch <name>` and `--branch=<name>` forms; rejects missing value (undefined OR next token starting with `-`) → error `"--branch requires a value"`.
- `branch` is optional on `StartArgs` and only set when provided, so the no-`--branch` parsed shape is byte-identical to before (existing equality tests unaffected).
- `start.ts` forwards branch via conditional spread `...(branch !== undefined ? { branch } : {})` so omitting `--branch` sends no `branch` key.
- `formatStartError` maps `NOT_A_GIT_REPO` → `"not a git repository: <msg>"` and `WORKTREE_CONFLICT` → `"worktree conflict: <msg>"`. RPC throws before any stdout write, so "start nothing" holds for free.
- `ps` isolation rendering: a **continuation line** under the row (`  ↳ branch <b>  worktree <path>`), NOT a new column. This keeps non-isolated rows and column widths byte-identical (requirement: don't disrupt existing columns). `formatIsolationLine` returns null for non-isolated runs.

## Learnings
- `RunListEntry` already carried optional `worktreePath`/`branch` (task_04) and `RpcErrorCode.NOT_A_GIT_REPO`/`WORKTREE_CONFLICT` already existed (protocol.ts) — task_06 only consumes them at the CLI edge.
- Command-level integration test = `createMockClient` recording: `mock.calls.find(c => c.method === "run.start").params` asserts `branch: "b"` forwarded.

## Files / Surfaces
- `src/app/cli.ts` — `StartArgs.branch?`, `parseStartArgs` loop, `USAGE.start`.
- `src/app/commands/start.ts` — forward `branch`, extend `formatStartError`.
- `src/infra/client/format.ts` — `formatPsTable` + new `formatIsolationLine`.
- Tests: `cli.test.ts`, `start.test.ts`, `format.test.ts`.

## Errors / Corrections
- None.

## Ready for Next Run
- task_07 (web start form + run detail) is the remaining entry point per techspec build order; HTTP contract already in place (task_05). CLI side done.
