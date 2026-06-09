---
provider: manual
pr:
round: 2
round_created_at: 2026-06-09T11:06:11Z
status: resolved
file: web/src/features/run-view/Transcript.tsx
line: 105
severity: high
author: claude-code
provider_ref:
---

# Issue 001: Tool-call React key omits stepId — duplicate keys defeat the per-step fold

## Review Comment

`Transcript` keys every tool-call row by `toolCallId` alone:

```tsx
item.kind === 'tool_call' ? (
  <ToolCallRow key={`tool-${item.toolCallId}`} item={item} />
) : (
```

Round 1 / Issue 001 (`reducer.ts`, resolved) deliberately made the reducer
fold tool calls **per step**, so a `toolCallId` reused across steps produces
**two distinct transcript rows** — one per `stepId`. The resolved reducer test
proves this exact shape (`web/src/lib/ws/reducer.test.ts:515`, "a re-seen
toolCallId in a new step creates a new row"): step-1 and step-2 both emit
`tc-1`, yielding two rows that differ only in `stepId`.

But the render layer keys both of those rows `tool-tc-1`. React requires keys
to be unique among siblings; two children with the same key produce a dev
warning and, worse, unreliable reconciliation — live `in_progress → completed`
updates for the step-2 row can be applied to the step-1 DOM node (or dropped),
and a reopened finished run can render the cross-step pair incorrectly.

This re-opens, at the rendering layer, the very asymmetry Round 1 closed at the
reducer layer. It is realistic, not theoretical: the Round 1 triage documented
that several supported adapters issue sequential ids (`call_0`, `call_1`, …)
that **restart each session/step**, so the same id legitimately recurs across
steps within one run. The result undermines the PRD's headline "Parity across
CLI and web" goal and the "faithful replay" / "Consistency" success metrics —
the TUI keys its in-place element by a `Map<toolCallId, …>` that is *cleared on
every banner* (`src/infra/tui/tui.ts:259`), so the TUI renders the two rows
correctly while the web does not.

No existing test catches this: every `Transcript.test.tsx` scenario uses a
single `stepId` ('step-1'), so the duplicate-key path is uncovered.

**Suggested fix:** include `stepId` in the key so it matches the reducer's
`(stepId, toolCallId)` fold identity:

```tsx
<ToolCallRow key={`tool-${item.stepId ?? ''}-${item.toolCallId}`} item={item} />
```

`stepId` is already present on each tool-call `TranscriptItem`. Add a
`Transcript.test.tsx` case that reduces `banner(step-1) → tc-1 →
banner(step-2) → tc-1` through `reduceFrame` and asserts two rows render, then
that completing the step-2 `tc-1` updates only the step-2 row — mirroring the
existing reducer test and the TUI test "clears the tool-call map on banner so a
re-seen id creates a new line".

## Triage

- Decision: `VALID`
- Root cause: `Transcript.tsx` keyed every tool-call row by `tool-${item.toolCallId}`
  alone, while the reducer folds tool calls by the `(stepId, toolCallId)` pair
  (`reducer.ts` `toolCallKey`, line 84). When an adapter restarts sequential ids
  per step (`call_0`, `call_1`, …), the same `toolCallId` recurs across steps,
  producing two distinct transcript rows that differ only in `stepId`. The render
  layer collapsed both onto the same React key, causing duplicate-key warnings
  and unreliable reconciliation (live `in_progress → completed` updates could be
  applied to the wrong row's DOM node or dropped).
- Fix: the render key now mirrors the reducer's fold identity —
  `tool-${item.stepId ?? ''}-${item.toolCallId}`. `stepId` is already present on
  every tool-call `TranscriptItem` (`stepId: string | null`), so no data plumbing
  was needed. Non-tool rows are unaffected.
- Test: added `Transcript.test.tsx` case "the same toolCallId re-seen in a new
  step renders a second row, updated independently". It drives
  `banner(step-1) → tc-1 → banner(step-2) → tc-1` through the real `reduceFrame`
  path, asserts two distinct rows render, then completes the step-2 `tc-1` and
  asserts each DOM node is preserved by its key and only the step-2 row updates —
  mirroring `reducer.test.ts:515` and the TUI banner-cleared-map test.
- Notes: change confined to `Transcript.tsx` (key string + comment) and its test
  file, both in scope.
