# TechSpec: Improved Tool-Call Display (CLI + Web)

## Executive Summary

This feature promotes tool calls to a first-class `tool_call` `RunnerEvent`
that carries a precomputed, display-ready view of the call (stable id, status,
kind, human title, optional error text). The ACP `AgentSession` derives that
view through a pure domain helper (`summarizeToolCall`) and emits it on every
ACP lifecycle update; each update is persisted append-only and consumers fold
by `toolCallId` into a single self-updating entry. The TUI keeps a
`Map<toolCallId, element>` and mutates the element in place (with a
timer-driven braille spinner for in-progress calls); the web reducer replaces
the matching transcript item in position and renders an icon/CSS-spinner.

The primary trade-off: we accept a few extra persisted events per call (one
per ACP update) and a small server-side accumulator, in exchange for leaving
the append-only event log untouched, getting trivially correct replay
(last-event-per-id wins), and keeping both render surfaces dumb. Summary
derivation is centralized in the domain so the CLI and web are identical by
construction. Implements PRD goals "single self-updating entry", "status at a
glance", "human summary", "failure reason", and "CLI/web parity"; see ADR-001,
ADR-002, ADR-003.

## System Architecture

### Component Overview

Data flows: **ACP subprocess → AgentSession → Runner → EventLog → (TUI |
WebSocket → web reducer → Transcript)**.

- **`summarizeToolCall` (new, `src/domain/tool-call.ts`)** — pure function
  mapping ACP-derived inputs (`kind`, `title`, `rawInput`, `locations`,
  `content`, `cwd`) to a `ToolCallView`. Owns command extraction, path
  relativization/truncation, error-text extraction, and the title/kind
  fallback. No I/O.
- **`RunnerEvent` (`src/domain/runner.ts`)** — gains a `tool_call` variant and
  the `ToolCallView`/`ToolCallStatus` types; `RunnerSessionSink` gains a
  `toolCall(view)` method whose Runner implementation emits the event.
- **`AgentSession` (`src/infra/acp/agent-session.ts`)** — in its `sessionUpdate`
  handler, replaces the two free-text `sink.log("Tool: …")` lines. It maintains
  a per-session `Map<toolCallId, accumulatedFields>`, merges each ACP update,
  calls `summarizeToolCall`, and emits via `sink.toolCall`.
- **`EventLog` (`src/infra/daemon/event-log.ts`)** — persists `tool_call`
  events unchanged (no new filter); they ride existing ring/rotation/backlog.
- **TUI (`src/infra/tui/tui.ts`)** — new `onEvent` case folds by id into a
  `Map<toolCallId, TextRenderable>`; a shared interval animates in-progress
  spinners after a ~200ms delay.
- **Web schema + reducer + Transcript (`web/src/lib/api/client.ts`,
  `web/src/lib/ws/reducer.ts`, `web/src/features/run-view/Transcript.tsx`)** —
  Zod schema gains the `tool_call` member; reducer folds by `toolCallId`;
  Transcript renders status icon/spinner + title + error.

External interaction: the Agent Client Protocol subprocess is the upstream
source of `tool_call`/`tool_call_update` notifications; no new external systems.

## Implementation Design

### Core Interfaces

The primary type both surfaces depend on, plus the domain helper and event:

```ts
// src/domain/runner.ts
export type ToolCallStatus = "pending" | "in_progress" | "completed" | "failed";

export interface ToolCallView {
  toolCallId: string;   // stable id; the fold key
  status: ToolCallStatus;
  kind: string;         // ACP ToolKind, or "other"
  title: string;        // precomputed label, e.g. "Bash: npm test"
  errorText?: string;   // present only when status === "failed"
}

export type RunnerEvent =
  // …existing variants…
  | { type: "tool_call"; call: ToolCallView };

export interface RunnerSessionSink {
  log(message: string, color?: string): void;
  stream(kind: StreamKind, chunk: string, color?: string): void;
  status(text: string, color?: string): void;
  toolCall(view: ToolCallView): void; // new
}
```

```ts
// src/domain/tool-call.ts (pure)
export interface ToolCallInput {
  toolCallId: string;
  status: ToolCallStatus;
  kind?: string | null;
  title?: string | null;
  rawInput?: unknown;                      // for "execute" command extraction
  locations?: Array<{ path: string }>;     // for read/edit file
  content?: unknown;                        // for failure-reason extraction only
  cwd: string;
}
export function summarizeToolCall(input: ToolCallInput): ToolCallView;
```

Error handling conventions: `summarizeToolCall` never throws — every optional
field is read defensively and falls back to `title`, then a kind-derived label,
then `"Tool call"`. The web `RunnerEventSchema.safeParse` already drops events
that fail validation, so a shape mismatch degrades to "event ignored", not a
crash.

### Data Models

- **`ToolCallView`** (above) is the persisted payload of a `tool_call` event and
  the unit both renderers fold on. Display fields only — no `rawInput`,
  `rawOutput`, or `content` are persisted (ADR-003, minimal payload).
- **`EventLogEntry`** is unchanged: `{ seq, ts, stepId, event }` where `event`
  may now be `{ type: "tool_call", call: ToolCallView }`.
- **Web `TranscriptItem` (`reducer.ts`)** gains `kind: 'tool_call'` plus
  `toolCallId: string`, `status: ToolCallStatus`, and `errorText?: string`
  (reusing `text` for the title). The fold key is `toolCallId`, not `seqStart`.

**Summary mapping (in `summarizeToolCall`):**

| ACP `kind` | Title format | Source |
|------------|--------------|--------|
| `execute` | `Bash: <command>` | `rawInput.command` (string) → fallback `title` |
| `read` | `Read <relpath>` | `locations[0].path` relto `cwd` → fallback `title` |
| `edit` / `delete` / `move` | `Edit/Delete/Move <relpath>` | `locations[0].path` → fallback `title` |
| `search` / `fetch` / `think` / other | `title` verbatim | `title` → kind label |

Long commands/paths are truncated to a sensible cap. `errorText` (failed only)
is a short string extracted from the update's `content`/`rawOutput`, capped.

### API Endpoints

None. No daemon JSON-RPC method, HTTP route, or workflow-JSON change. The
feature rides the existing `event.run.event` notification and WebSocket attach
frames; the only contract change is the new `tool_call` variant inside the
already-transported `RunnerEvent`.

## Integration Points

The only boundary is the existing in-process ACP connection
(`@agentclientprotocol/sdk`). `AcpClient.sessionUpdate` already receives the
full `SessionNotification`; no SDK, auth, or transport change is required. ACP
`ToolCallStatus` (`pending|in_progress|completed|failed`), `ToolKind`, and
`ToolCallLocation.path` map directly onto `ToolCallView`.

## Impact Analysis

| Component | Impact Type | Description and Risk | Required Action |
|-----------|-------------|----------------------|-----------------|
| `src/domain/tool-call.ts` | new | Pure summary helper. Low risk. | Add file + unit tests. |
| `src/domain/runner.ts` | modified | Add `ToolCallView`/`ToolCallStatus`, `tool_call` event, `sink.toolCall` emit. Low risk; additive union member. | Extend types and the `sink` object in `run()`. |
| `src/infra/acp/agent-session.ts` | modified | Replace 2 `sink.log` lines (194–199) with per-session accumulator + `summarizeToolCall` + `sink.toolCall`. Medium risk: per-call merge correctness. | Implement accumulator; add `toolCall` to `AgentSessionSink`. |
| `src/infra/daemon/event-log.ts` | unchanged | `tool_call` persists via existing path; verify not filtered. Low risk. | Add a regression test asserting persistence + backlog replay. |
| `src/infra/tui/tui.ts` | modified | New `onEvent` case, `Map<id, TextRenderable>`, spinner interval + 200ms delay, clear map on banner, clear timer on detach/shutdown. Medium risk: render-loop/timer lifecycle. | Implement in-place update + spinner. |
| `web/src/lib/api/client.ts` (+`types.ts`) | modified | Add `tool_call` to `RunnerEventSchema`/types. Low risk. | Extend Zod union + TS types. |
| `web/src/lib/ws/reducer.ts` | modified | `TranscriptItem` fields + fold-by-`toolCallId` (locate & replace in place). Medium risk: replay/backlog ordering. | Implement fold + tests. |
| `web/src/features/run-view/Transcript.tsx` | modified | Render status icon/CSS-spinner + title + errorText; key by `toolCallId`. Low risk. | Add tool_call rendering branch. |

## Testing Approach

### Unit Tests

- **`src/domain/tool-call.test.ts`** (primary): `execute` → `Bash: <command>`
  from `rawInput.command`; `read`/`edit` → relativized path from `locations`;
  path relativization against `cwd`; long command/path truncation; failed status
  → `errorText` extracted and capped; missing specifics → `title` then `kind`
  fallback; never throws on malformed input.
- **`web/src/lib/ws/reducer.test.ts`**: a sequence of `tool_call` events with one
  `toolCallId` (pending → in_progress → completed) yields exactly one
  transcript item ending `completed`; a `failed` event populates `errorText`;
  interleaving two ids keeps both, each in first-seen position; backlog replay
  of the same sequence converges to identical final state.
- **`web/src/lib/api/client.test.ts`**: `RunnerEventSchema` parses a valid
  `tool_call` event and rejects a malformed one (drops, no throw).

### Integration Tests

- **Event-log regression** (`src/infra/daemon`): append pending/in_progress/
  completed `tool_call` events; assert all persist and `currentStepBacklog`
  returns them after a `banner`, so re-attach folds to final state.
- **Manual E2E** (per `README.md`): run a workflow exercising bash + file
  read/edit + one failing call; verify one self-updating entry per call in both
  the TUI and web, and that reopening the finished run reproduces final `✓/✗`
  states. The TUI render loop/spinner is validated here (opentui is not unit
  tested).

## Development Sequencing

### Build Order

1. **Domain types + Runner sink** (`src/domain/runner.ts`) — add
   `ToolCallStatus`, `ToolCallView`, the `tool_call` event variant, and
   `RunnerSessionSink.toolCall` wired to emit `{ type: "tool_call", call }`. No
   dependencies.
2. **`summarizeToolCall`** (`src/domain/tool-call.ts`) + unit tests — depends on
   step 1 (consumes `ToolCallView`/`ToolCallStatus`).
3. **ACP emission** (`src/infra/acp/agent-session.ts`) — per-session
   accumulator, `AgentSessionSink.toolCall`, replace the `tool_call`/
   `tool_call_update` log lines with summarize+emit. Depends on steps 1–2.
4. **Event-log persistence check + regression test**
   (`src/infra/daemon/event-log.ts`) — confirm `tool_call` is not filtered and
   replays via backlog. Depends on step 1.
5. **Web schema + types** (`web/src/lib/api/client.ts`, `types.ts`) — add the
   `tool_call` union member matching step 1's shape. Depends on step 1.
6. **Web reducer fold-by-id** (`web/src/lib/ws/reducer.ts`) + tests — extend
   `TranscriptItem`, locate-and-replace by `toolCallId`. Depends on step 5.
7. **Web rendering** (`web/src/features/run-view/Transcript.tsx`) — icon/CSS
   spinner + title + errorText, keyed by `toolCallId`. Depends on step 6.
8. **TUI rendering** (`src/infra/tui/tui.ts`) — `Map<id, TextRenderable>`
   in-place update, braille spinner interval with 200ms delay, map reset on
   banner, timer cleanup on detach/shutdown. Depends on step 1.
9. **Manual E2E validation** — depends on steps 3, 4, 7, 8.

### Technical Dependencies

- No infrastructure, external service, or shared-team deliverables block this.
- Requires a locally installed/authenticated IDE (per `README.md`) only for the
  manual E2E in step 9; all unit tests run under `bun test` with no agents.

## Monitoring and Observability

No new operational surface; this is local CLI/web rendering. The existing event
log is the record of truth — `tool_call` entries in `events.jsonl` (with
`seq`, `ts`, `stepId`) now provide a structured, queryable trace of every tool
call and its final status, which is strictly more observable than today's
free-text `log` lines. No metrics or alerts are added.

## Technical Considerations

### Key Decisions

- **Decision:** Animate the CLI running state with a single shared
  timer-driven braille spinner (~80–120ms frames) gated by a ~200ms appearance
  delay. **Rationale:** matches the PRD's "animated spinner" and standard agent
  CLIs while letting fast calls settle straight to `✓/✗` without a flash.
  **Trade-off:** one interval runs while calls are in flight. **Rejected:** a
  static running glyph (no motion, fails the PRD intent).
- **Decision:** Centralize per-call field merging in a server-side accumulator
  and ship a complete `ToolCallView` each event. **Rationale:** consumers stay
  pure last-wins; no merge logic duplicated across surfaces (ADR-002/003).
  **Trade-off:** small per-session state in `AgentSession`. **Rejected:**
  emitting deltas (drift risk).
- **Decision:** Persist display fields only. **Rationale:** YAGNI for the
  non-committed Phase 2; smallest log footprint. **Trade-off:** Phase 2 must
  re-instrument to surface raw command/output. **Rejected:** retaining
  `rawInput`/`content` speculatively.

### Known Risks

- **TUI timer lifecycle** (medium likelihood): a leaked interval after
  detach/shutdown. *Mitigation:* register the timer in `#detachListeners`/
  `shutdown()` cleanup and stop it when no call is in progress; cover in the
  E2E detach path.
- **Web/server schema drift** (low likelihood): a `tool_call` shape change
  silently dropped by `safeParse`. *Mitigation:* the client schema parse test
  fixture (step 5) pins the shape.
- **Fold positioning on reopen** (low likelihood): an out-of-order backlog could
  misplace an entry. *Mitigation:* reducer keys position to first-seen id;
  backlog is seq-sorted before reduction (existing behavior).
- **Spinner threshold tuning** (low): the 200ms delay/frame rate may need
  adjustment for feel; isolated constants, settled during E2E.

## Architecture Decision Records

- [ADR-001: Model tool calls as a first-class, identity-bearing run event](adrs/adr-001.md)
  — Tool calls become a distinct, persisted, id-keyed event consumed
  identically by CLI and web (vs. free-text logs or a renderer-only patch).
- [ADR-002: Append-each-update, fold-by-id tool-call lifecycle](adrs/adr-002.md)
  — Each ACP update is appended as its own event; consumers fold by
  `toolCallId`, leaving the append-only log untouched.
- [ADR-003: Derive the tool-call summary in the domain and ship it in the event](adrs/adr-003.md)
  — A pure `summarizeToolCall` computes the display view server-side; both
  surfaces render precomputed fields; only display fields are persisted.
