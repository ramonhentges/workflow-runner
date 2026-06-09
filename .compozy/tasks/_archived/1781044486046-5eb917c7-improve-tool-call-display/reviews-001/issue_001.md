---
provider: manual
pr:
round: 1
round_created_at: 2026-06-09T10:50:28Z
status: resolved
file: web/src/lib/ws/reducer.ts
line: 160
severity: high
author: claude-code
provider_ref:
---

# Issue 001: Web tool_call fold is global, not per-step — diverges from TUI

## Review Comment

The web reducer folds tool-call updates by `toolCallId` across the **entire**
transcript, with no step scoping:

```ts
const idx = vm.transcript.findIndex(
  item => item.kind === 'tool_call' && item.toolCallId === call.toolCallId,
)
```

The TUI does the opposite: `onEvent('banner')` calls `clearToolCalls()`
(`src/infra/tui/tui.ts:259`, `:455`), dropping the previous step's
`Map<toolCallId, …>` so a re-seen id in a new step creates a **new** line.

This is an asymmetry between the two surfaces that the feature is explicitly
built to avoid. ADR-002's implementation notes state tool-call ids are
"unique per session" — i.e. per step, **not** per run. A run is multiple
sessions (one per step), and several supported adapters issue sequential ids
(`call_0`, `call_1`, …) that restart each session. When step 2 reuses an id
from step 1:

- **TUI**: map was cleared on the step-2 banner → a fresh line is rendered
  under step 2. Correct.
- **Web**: `findIndex` matches step 1's row and rewrites it in place — so a
  step-2 tool call silently mutates a line visually located under step 1's
  banner, and the row never appears in step 2.

This breaks the PRD's headline "Parity across CLI and web" goal and the
"faithful replay" / "Consistency" success metrics: live web, reopen, and the
TUI no longer converge to the same rendering.

**Suggested fix:** scope the fold to the current step, mirroring the TUI's
per-step reset. Add `item.stepId === stepId` to the `findIndex` predicate so a
reused id in a later step starts a new row:

```ts
const idx = vm.transcript.findIndex(
  item =>
    item.kind === 'tool_call' &&
    item.toolCallId === call.toolCallId &&
    item.stepId === stepId,
)
```

Add a reducer test covering two steps (banner → tc-1 → banner → tc-1) asserting
two distinct rows result, matching the existing TUI test
"clears the tool-call map on banner so a re-seen id creates a new line".

## Triage

- Decision: `VALID`
- Notes:
  - **Confirmed asymmetry.** `src/infra/tui/tui.ts:259` calls `clearToolCalls()`
    in the `banner` case, dropping the prior step's tool-call map. The TUI test
    "clears the tool-call map on banner so a re-seen id creates a new line"
    (`src/infra/tui/tui.test.ts:438`) asserts a re-seen id renders a second
    line. The web reducer's `findIndex` matched `toolCallId` across the entire
    transcript with no step scoping, so a reused id in step 2 mutated step 1's
    row in place and never appeared under step 2 — diverging from the TUI and
    breaking the PRD's "parity across CLI and web" / faithful-replay goals.
  - **Root cause:** the fold predicate ignored `stepId`. Tool-call ids are
    unique per session (per step), not per run; sequential-id adapters restart
    ids each session.
  - **Fix:** added `item.stepId === stepId` to the `findIndex` predicate in the
    `tool_call` case so a reused id in a later step starts a new row. `stepId`
    is already in scope as the `reduceEntry` parameter and is stored on each
    tool-call row.
  - **Test:** added "a re-seen toolCallId in a new step creates a new row
    (per-step fold)" to `web/src/lib/ws/reducer.test.ts`, mirroring the TUI
    test (banner → tc-1 → banner → tc-1 → two distinct rows).
