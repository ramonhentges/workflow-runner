# Task Memory: task_01.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Done. Added `ToolCallStatus`/`ToolCallView` types, `tool_call` `RunnerEvent`
variant, and `RunnerSessionSink.toolCall` wired to emit from `Runner.run()`.

## Important Decisions
- `toolCall` added only to `RunnerSessionSink` (domain), not yet to
  `AgentSessionSink` (infra) — that comes in task_03. They stay compatible
  because the superset (RunnerSessionSink) is assignable to AgentSessionSink.

## Learnings
- Event log needs no change: `append()` only filters `stream`+`thought`, so
  `tool_call` rides ring/rotation/backlog untouched (verified by regression test).

## Files / Surfaces
- `src/domain/runner.ts` — types, union member, sink + emit wiring.
- `src/domain/runner.test.ts` — 3 new unit tests (emit, errorText, struct compat).
- `src/infra/daemon/event-log.test.ts` — persistence + backlog regression test.
- `src/infra/daemon/test-helpers/fixture-session-factory.test.ts` — added
  `toolCall: () => {}` to a `RunnerSessionSink` literal (typecheck fix).

## Errors / Corrections
- Adding `toolCall` to the interface broke one existing `RunnerSessionSink`
  literal in fixture-session-factory.test.ts; fixed by adding the no-op member.

## Ready for Next Run
- task_02 adds `summarizeToolCall` in `src/domain/tool-call.ts` consuming these
  types. task_03 adds `toolCall` to `AgentSessionSink` + per-session accumulator.
