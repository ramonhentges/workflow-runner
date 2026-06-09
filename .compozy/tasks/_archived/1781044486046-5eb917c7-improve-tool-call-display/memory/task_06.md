# Task Memory: task_06.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Render folded `tool_call` rows in the web Transcript with a status affordance
(pending/in_progress/completed/failed), the precomputed title, and inline error
on failure. Keyed by `toolCallId` so live updates mutate the row in place.
DONE — all subtasks 6.1–6.4 complete, tests green.

## Important Decisions
- Icons via existing `lucide-react`: `Circle` (pending, text-muted-foreground),
  `LoaderCircle` (in_progress, `animate-spin` + text-status-running),
  `CircleCheck` (completed, text-status-completed), `CircleX` (failed,
  text-status-failed). Same lucide set the app's StatusBadge already uses.
- Spinner is CSS-only via Tailwind v4 builtin `animate-spin` (no JS timer) —
  settles to the terminal glyph the moment status leaves `in_progress`.
- Extracted two small local subcomponents in Transcript.tsx: `ToolCallStatusIcon`
  and `ToolCallRow` (same feature folder, not a new file).
- errorText rendered inline as ` — {errorText}` in a `text-status-failed` span;
  guarded by `item.errorText` presence (model only sets it on failure).
- Row key = `tool-${toolCallId}`; other kinds keep `${seqStart}-${kind}`.

## Learnings
- Test hooks: spinner has `data-testid="tool-call-spinner"`; the three settled
  icons share `data-testid="tool-call-icon"` and are disambiguated by
  `aria-label` (pending/completed/failed). Row carries `data-status` too.
- jsdom test needs `window.HTMLElement.prototype.scrollIntoView = vi.fn()`
  (Transcript's useEffect calls it). Same pattern as RunView.test.tsx.
- Integration tests drive the real task_05 reducer (`reduceFrame`) then render
  Transcript; `rerender` + capturing the DOM node proves in-place update
  (`expect(rowAfter).toBe(rowBefore)`).

## Files / Surfaces
- `web/src/features/run-view/Transcript.tsx` — added tool_call branch + 2 subcomponents.
- `web/src/features/run-view/Transcript.test.tsx` — NEW, 10 tests (unit + integration).

## Errors / Corrections
- None.

## Ready for Next Run
- Web chain (task_04→05→06) is fully landed. Remaining: TUI rendering (task_07).
- Verified: web typecheck 0, vite build 0, `vitest run` 27 files / 405 tests pass.
  Transcript.tsx coverage 94.73% stmts / 100% lines.
