# Task Memory: task_07.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
TUI side of fold-by-id: render `tool_call` events as one self-updating line per
`toolCallId` in `src/infra/tui/tui.ts`, animate in_progress with a shared
braille spinner gated by a ~200ms appearance delay, clear map on banner, stop
timer on detach/shutdown. Pure formatting helper + tests required (>=80%).

## Important Decisions
- Pure helper `src/infra/tui/tool-call-format.ts` ALREADY EXISTS (untracked,
  pre-staged): exports `SPINNER_FRAMES`, `toolCallIcon`, `toolCallColor`,
  `formatToolCallContent`. Reuse it; do not duplicate. No test existed for it.
- Inject a `TuiClock` (setTimeout/Interval pair) via `Tui.create` opts so the
  spinner delay/interval are deterministically testable with a fake clock (no
  global timer mutation, no flaky waits). Default = real timers.
- Element id uses the existing `msg-${++#msgCounter}` counter (NOT
  `tool-${id}`) to avoid opentui id collisions when the same toolCallId
  reappears after a banner clears the map. Map stays keyed by toolCallId.

## Learnings
- baseline confirmed: `tui.ts` had zero tool_call/spinner handling before.
- tui.test.ts uses `@opentui/core/testing` `createTestRenderer`; content set on
  a renderable only shows in `captureCharFrame()` after `await renderOnce()`.

## Files / Surfaces
- `src/infra/tui/tui.ts` (edit: onEvent case, map, spinner, clock, lifecycle)
- `src/infra/tui/tool-call-format.ts` (reuse, exists)
- `src/infra/tui/tool-call-format.test.ts` (new: pure-helper unit tests)
- `src/infra/tui/tui.test.ts` (edit: fold/banner/detach integration tests)

## Errors / Corrections
- None. Implementation landed cleanly on first verification pass.

## Ready for Next Run
- task_07 COMPLETE. TUI `onEvent` has a `tool_call` case folding by id into
  `#toolCalls` Map; spinner is delay-gated (`SPINNER_DELAY_MS=200`) +
  interval (`SPINNER_FRAME_MS=100`) advancing `SPINNER_FRAMES`. `clearToolCalls`
  on banner; `stopSpinner`+map clear in `detach()` (shutdown calls detach).
  Element ids use the shared `msg-` counter. `TuiClock` injected via
  `Tui.create({ clock })`; default real timers. Tests: 32 (helper unit + TUI
  integration via fake clock). Full suite 989 pass / 0 fail; typecheck + build
  green. Whole CLI+web chain (tasks 01–07) now done — feature complete.
