# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Done. `start --prompt <text|-|@file>` parses, resolves source, forwards `initialPrompt`
to `run.start` (RPC param already existed from task 02).

## Important Decisions

- `parseStartArgs` stores the RAW flag value in `StartArgs.initialPrompt` (`-`,
  `@path`, or inline). Source resolution (stdin/file/inline) happens in
  `commands/start.ts` via injectable `readStdin`/`readFile` deps — keeps cli.ts I/O-free.
- `--prompt` value validation differs from `--branch`: `-` IS a valid value (stdin
  sentinel). Rule: reject only `undefined` or a token that `startsWith("-") && !== "-"`.
  So `--prompt --branch` errors but `--prompt -` is accepted.
- `--prompt=` empty value → "--prompt requires a value" error.
- File-read failure surfaces as exit 1 before any `run.start` call (resolve before connect).

## Learnings

## Files / Surfaces

- `src/app/cli.ts` — `StartArgs.initialPrompt?`, `--prompt`/`--prompt=` parsing, `USAGE.start`.
- `src/app/commands/start.ts` — `resolvePrompt` helper, `readStdin`/`readFile` deps, forward in `run.start`.
- Tests: `src/app/cli.test.ts`, `src/app/commands/start.test.ts` (+13 tests).

## Errors / Corrections

## Ready for Next Run

Task 04 complete; verified `bun run typecheck` + `bun test` (1155 pass / 0 fail).
