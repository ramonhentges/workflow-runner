# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State
- task_01 complete: `ToolCallStatus`/`ToolCallView`, `tool_call` `RunnerEvent`,
  `RunnerSessionSink.toolCall` (domain) all landed and emit from `Runner.run()`.
- task_02 complete: pure `summarizeToolCall(ToolCallInput) -> ToolCallView` in
  `src/domain/tool-call.ts` (the single authoritative summary for CLI + web).
  Owns command/path/error extraction, cwd relativization, truncation, and the
  title→kind-label→"Tool call" fallback. task_03 calls it from `AgentSession`.
- task_03 complete: ACP emission is live end-to-end. `AgentSessionSink.toolCall`
  added; per-session `ToolCallAccumulator` (`src/infra/acp/tool-call-accumulator.ts`)
  folds `tool_call`/`tool_call_update` last-wins and emits complete views via the
  exported `handleSessionUpdate` router in `agent-session.ts`. Legacy `Tool: …`
  log lines gone. Real runs now persist structured `tool_call` events. Downstream
  consumers (web reducer/Transcript task_05-06, TUI task_07) fold by `toolCallId`.

- task_04 complete: web client recognizes `tool_call`. `web/src/lib/api/client.ts`
  has `ToolCallStatusSchema`, `ToolCallViewSchema`, and a `tool_call` member in
  `RunnerEventSchema`; `web/src/lib/api/types.ts` exports `ToolCallStatus`,
  `ToolCallView`, and the `RunnerEvent` union member. Wire shape is NESTED:
  `{ type: 'tool_call', call: ToolCallView }` — reducer (task_05) and Transcript
  (task_06) read `event.call.*`. Note `RunEventSchema.event` is `z.unknown()`, so
  inner-event validation happens in the reducer via `RunnerEventSchema`, not in
  `AttachFrameSchema`.

- task_05 complete: web reducer (`web/src/lib/ws/reducer.ts`) folds `tool_call`
  by `toolCallId`. `TranscriptItem` gained `kind:'tool_call'` + optional
  `toolCallId`/`status`/`errorText` (`text` = title). `reduceEntry` locates an
  existing tool_call row by id and replaces it in place (keeping `seqStart`/
  position, updating `seqEnd`), else appends. Pure last-wins; backlog replay and
  live converge. task_06 Transcript renders these rows keyed by `toolCallId`.

- task_06 complete: web rendering landed. `web/src/features/run-view/Transcript.tsx`
  has a `tool_call` branch (`ToolCallStatusIcon` + `ToolCallRow` subcomponents),
  keyed by `tool-${toolCallId}` so live updates mutate in place. Status affordance
  uses lucide-react: `Circle`/pending, `LoaderCircle`+`animate-spin`/in_progress,
  `CircleCheck`/completed, `CircleX`/failed, colored with `text-status-*` tokens.
  Spinner is CSS-only (Tailwind builtin `animate-spin`, no JS timer). Title shown
  verbatim; `errorText` inline as ` — {errorText}`. Test hooks: spinner
  `data-testid="tool-call-spinner"`, settled icons share
  `data-testid="tool-call-icon"` disambiguated by `aria-label`; row keeps
  `data-testid="transcript-item"` + `data-kind="tool_call"` + `data-status`.
  New `Transcript.test.tsx`. Web chain (04→05→06) is fully done; only TUI
  (task_07) remains for parity.

- task_07 complete: TUI parity landed. `src/infra/tui/tui.ts` `onEvent` folds
  `tool_call` by id into a `Map<toolCallId, {el,view}>`, mutating one
  `TextRenderable` in place; pure `src/infra/tui/tool-call-format.ts`
  (`SPINNER_FRAMES`, `toolCallIcon`/`Color`, `formatToolCallContent`) owns
  glyph/color/title. Shared braille spinner: 200ms appearance delay then a
  100ms interval, so fast calls settle straight to ✓/✗. Map cleared on banner;
  spinner+map torn down in `detach()` (shutdown calls detach). Timers injected
  as a `TuiClock` via `Tui.create({ clock })` for deterministic tests.
  ENTIRE FEATURE (01–07) NOW COMPLETE.

## Shared Decisions
- Two sink interfaces exist: domain `RunnerSessionSink` (src/domain/runner.ts)
  and infra `AgentSessionSink` (src/infra/acp/agent-session.ts). Keep them
  structurally compatible. `toolCall` was added to `RunnerSessionSink` first;
  task_03 must add the matching `toolCall` to `AgentSessionSink` so the ACP
  session can call it.

- `ToolCallInput` (the input to `summarizeToolCall`) carries display-source
  fields only: `{ toolCallId, status, kind?, title?, rawInput?, locations?,
  content?, cwd }`. task_03's per-session accumulator must merge ACP updates
  into exactly this shape (incl. the run `cwd`) before calling the helper.
- `summarizeToolCall` never throws and emits only the 4–5 `ToolCallView`
  display fields (no raw blobs) — so the web Zod schema (task_04) mirrors only
  `{ toolCallId, status, kind, title, errorText? }`.

## Shared Learnings
- Event log (`src/infra/daemon/event-log.ts`) `append()` filters only
  `stream`+`thought`; every other event type (incl. `tool_call`) persists and
  replays via ring/backlog with no code change.

## Open Risks

## Handoffs
