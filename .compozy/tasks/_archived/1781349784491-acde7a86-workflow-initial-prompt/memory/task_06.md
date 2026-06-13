# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Surface the run's launch prompt in the web run view: add `initialPrompt?` to web
`RunDetail`, render a labeled section when present, omit when absent, keep
isolation display unchanged. DONE.

## Important Decisions

- Rendered as a distinct bordered section (`data-testid="initial-prompt-info"`,
  text in `initial-prompt-text`) placed right after the isolation block, framed as
  run context (label "Initial prompt"), using `whitespace-pre-wrap` to preserve
  prompt formatting.

## Learnings

- The snapshot frame is validated by `AttachFrameSchema`/`RunDetailSchema` (zod)
  in `web/src/lib/api/client.ts` before reaching the reducer. zod `z.object`
  STRIPS unknown keys, so adding a field to the TS `RunDetail` type alone is NOT
  enough — it must also be added to `RunDetailSchema` or it never reaches
  `vm.snapshot` in the component (same as `worktreePath`/`branch`).

## Files / Surfaces

- web/src/lib/api/types.ts — `RunDetail.initialPrompt?`
- web/src/lib/api/client.ts — `RunDetailSchema.initialPrompt` (zod, required for
  passthrough)
- web/src/features/run-view/RunView.tsx — conditional prompt section
- web/src/features/run-view/RunView.test.tsx — 3 new tests (present, present+iso,
  absent)

## Errors / Corrections

- First test run failed: section did not render even with `initialPrompt` on the
  snapshot. Root cause: missing field in `RunDetailSchema` (zod stripped it).
  Fixed by adding it to the schema; not a component bug.

## Ready for Next Run

Task 06 complete and verified. No follow-ups.
