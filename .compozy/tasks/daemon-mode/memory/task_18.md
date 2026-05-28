# Task Memory: task_18.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Refactor `src/app/cli.ts` and `src/app/commands/*.ts` so every subcommand consumes a per-subcommand argv parser from `cli.ts` instead of an inline `parseArgs`. Rewrite `cli.test.ts` for the new parser surface. No behavior change.

## Important Decisions

- Reused the `ParseResult<T>` discriminated union already present in `cli.ts` (`{ok:true,help:true} | {ok:true,value:T} | {ok:false,error:string}`); all eight parsers + the `USAGE` map were already in place when this task began.
- Command files print `USAGE.<sub>` on parse error and on `--help`. Help goes to stdout + exit 0; errors go to stderr + exit 1. This matches the pattern already used by `start.ts` / `stop.ts` / `retry-step.ts` from task_15 — kept it consistent across all 8 commands.
- Added `stdout` to `AttachDeps`, `SendDeps`, `DaemonDeps` so the `--help` path can write to a test-supplied stream without falling through to the real `process.stdout`.

## Learnings

- The 8 per-subcommand parsers (`parseStartArgs`, `parseStopArgs`, `parseRetryStepArgs`, `parsePsArgs`, `parseAttachArgs`, `parseSendArgs`, `parseDoctorArgs`, `parseDaemonArgs`) and the `USAGE` map already lived in `src/app/cli.ts`. The legacy `parseCliArgs` and `resolveEntryStep` had also been removed before this task ran (likely in task_17). The only work left was migrating five commands and rewriting `cli.test.ts`.
- Existing command tests assert error substrings (`--bogus`, `extra`, `Usage:`, etc.). The new parsers' error strings still satisfy those substring checks because the command also prints `USAGE.<sub>` on the next line, which starts with `Usage:`.
- `bun test` coverage for `src/app/cli.ts` after the rewrite: 100% functions, 99.23% lines.

## Files / Surfaces

- `src/app/cli.ts` — already complete from a prior task; not modified this run.
- `src/app/cli.test.ts` — fully rewritten; one `describe` per parser + an `argv non-mutation` describe.
- `src/app/commands/attach.ts` — replaced inline `parseArgs` with `parseAttachArgs` + USAGE handling; added `stdout` dep.
- `src/app/commands/ps.ts` — replaced inline `parseArgs` with `parsePsArgs` + USAGE handling.
- `src/app/commands/send.ts` — replaced inline `parseArgs` with `parseSendArgs` + USAGE handling; added `stdout` dep; renamed `parsed.runIdInput`/`parsed.message` to local `runIdInput`/`inlineMessage` with `fromStdin`.
- `src/app/commands/doctor.ts` — replaced inline `argv.length > 0` check with `parseDoctorArgs` + USAGE handling.
- `src/app/commands/daemon.ts` — replaced inline `argv.length > 0` check with `parseDaemonArgs` + USAGE handling; added `stdout` dep.

## Errors / Corrections

- None.

## Ready for Next Run

- Task 19 (integration tests) will exercise these parsers end-to-end via the CLI entry. The per-subcommand `USAGE` map is the canonical source of usage strings — integration tests should assert against it rather than hardcoding usage strings.
