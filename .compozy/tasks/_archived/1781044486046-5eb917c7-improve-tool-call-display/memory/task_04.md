# Task Memory: task_04.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Web client recognizes the `tool_call` event: added a `tool_call` member to
`RunnerEventSchema` and the matching TS types. Gate that lets tool-call events
reach the reducer (task_05) / Transcript (task_06). Complete.

## Important Decisions
- Wire shape is NESTED: `{ type: 'tool_call', call: ToolCallView }` (matches
  server emit `runner.ts:175` `emit({ type:'tool_call', call: view })`), NOT a
  flat object. The reducer/Transcript must read `event.call.*`.
- Introduced reusable `ToolCallStatusSchema` and `ToolCallViewSchema` (exported
  from `client.ts`) for symmetry with `RunStatusSchema`; task_05 can import
  `ToolCallView`/`ToolCallStatus` types from `types.ts`.

## Learnings
- `RunEventSchema.event` is `z.unknown()`, so `AttachFrameSchema` event frames
  do NOT validate the inner RunnerEvent — the two-stage validation (frame, then
  RunnerEventSchema) happens in the reducer. The integration test asserts the
  frame parses; inner validation is RunnerEventSchema's job.
- `types.ts` shows 0% coverage because it is type-only declarations (no runtime
  code); the runtime schema in `client.ts` is at 100%.

## Files / Surfaces
- `web/src/lib/api/client.ts` — `ToolCallStatusSchema`, `ToolCallViewSchema`,
  `tool_call` member in `RunnerEventSchema`.
- `web/src/lib/api/types.ts` — `ToolCallStatus`, `ToolCallView`, `RunnerEvent`
  union member.
- `web/src/lib/api/client.test.ts` — 5 new tests (4 RunnerEventSchema + 1
  AttachFrameSchema integration).

## Errors / Corrections

## Ready for Next Run
- task_05 (reducer) and task_06 (Transcript) consume `event.call` (nested).
  Import `ToolCallView`/`ToolCallStatus` from `web/src/lib/api/types.ts`.
