# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Done. ACP `tool_call`/`tool_call_update` now fold through a per-session
accumulator and emit complete `ToolCallView`s via `sink.toolCall`; legacy
`Tool: …` log lines removed.

## Important Decisions
- Extracted routing into exported `handleSessionUpdate(update, cwd, sink, acc)`
  in `agent-session.ts` so the switch (chunks vs tool calls) is unit-testable
  without spawning a subprocess. The `sessionUpdate` closure is now a one-liner.
- Accumulator lives in its own file `tool-call-accumulator.ts` (class
  `ToolCallAccumulator`, single `apply()` method). Merge uses `??` so ACP
  null/undefined absent fields keep the prior value; status defaults "pending".

## Learnings
- ACP `ToolCall` (initial) requires `title`; `status` optional. `ToolCallUpdate`
  fields all optional and may be `null`. A single `apply(ToolCall|ToolCallUpdate)`
  handles both since the union shares the field names.
- `EventLog.append` is fire-and-forget over a write chain; `await log.flush()`
  makes queued appends visible before reading `currentStepBacklog`.

## Files / Surfaces
- NEW `src/infra/acp/tool-call-accumulator.ts`
- `src/infra/acp/agent-session.ts` (sink method, router, accumulator wiring)
- `src/infra/acp/agent-session.test.ts` (makeSink helper + new suites)

## Errors / Corrections
- None.

## Ready for Next Run
- task_04 (web Zod schema) mirrors only `{ toolCallId, status, kind, title,
  errorText? }`. Emission side is now live end-to-end.
