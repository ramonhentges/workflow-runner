# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
- Done: web reducer folds `tool_call` events by `toolCallId` into one transcript
  row (locate-and-replace in place; append if new). Last-wins per ADR-002.

## Important Decisions
- Tool-call fields on `TranscriptItem` are optional (`toolCallId?`, `status?`,
  `errorText?`) since it's one shared interface; required only when
  `kind === 'tool_call'`. `text` holds the title (no new title field).
- `errorText` set unconditionally from `call.errorText` on each update (so a
  non-failed update clears a prior error) — pure last-wins, matches accumulator.

## Learnings
- reducer coverage 96% stmts / 94% branch with 6 added tests; >=80% met easily.

## Files / Surfaces
- `web/src/lib/ws/reducer.ts` — `TranscriptItem` + `tool_call` branch in `reduceEntry`.
- `web/src/lib/ws/reducer.test.ts` — added `tool_call folding` describe block.

## Errors / Corrections

## Ready for Next Run
- task_06 (`Transcript.tsx`) renders these folded rows: key by `toolCallId`,
  read `item.status`/`item.text`/`item.errorText`.
