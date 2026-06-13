# Task Memory: task_05.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Add optional multi-line `initialPrompt` to both web run-start surfaces
(StartRunForm + WorkflowList run dialog), mirroring the existing `branch`
field: trimmed, omitted from the request when blank.

## Important Decisions

- Mirror `branch` shaping exactly: `...(trimmedPrompt ? { initialPrompt: trimmedPrompt } : {})`.
  Trim to decide inclusion AND send the trimmed value (same as branch). Keeps the
  no-prompt path byte-for-byte identical.
- Label: "Initial prompt (optional)" — distinct from `/branch/i` so existing
  `getByLabelText(/branch/i)` assertions remain unambiguous.
- shadcn `textarea` primitive already existed; no CLI install needed (5.2 pre-done).

## Learnings

- Running `bun run test` against a SUBSET of files trips the global coverage
  threshold (80%) because coverage is measured only over the touched files. Run
  the FULL `bun run test` to get a true pass/coverage signal (full suite: 95%).
- shadcn `textarea` was already in `web/src/components/ui/textarea.tsx` — no CLI
  install required. Future web tasks needing it can import directly.
- Done (all subtasks 5.1–5.5): 29 files / 471 tests pass, typecheck + build clean.

## Files / Surfaces

- `web/src/lib/api/types.ts` — `StartRunRequest.initialPrompt?`
- `web/src/features/start-run/StartRunForm.tsx` + `.test.tsx`
- `web/src/features/workflows/WorkflowList.tsx` + `.test.tsx`
- `web/src/lib/api/client.ts` — `startRun` spreads `req`, forwards new field unchanged (verify-only)

## Errors / Corrections

## Ready for Next Run
