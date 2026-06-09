---
provider: manual
pr:
round: 1
round_created_at: 2026-06-09T10:50:28Z
status: resolved
file: src/domain/tool-call.ts
line: 124
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: Failure-reason extraction ignores rawOutput and terminal content

## Review Comment

`extractErrorText` only reads the ACP `content` array, and within it only
plain text blocks (`{ type: "content", content: { type: "text", … } }` or a
bare `{ type: "text", … }`). The `ToolCallAccumulator` likewise never merges
`rawOutput` — `AccumulatedFields` has no such field
(`src/infra/acp/tool-call-accumulator.ts:7-15`).

The TechSpec (Data Models, line 128) specifies the error string is "extracted
from the update's `content`/`rawOutput`", and ACP exposes `rawOutput` on both
`ToolCall` and `ToolCallUpdate`. For the `execute`/Bash kind — the PRD's
primary example surface — agents commonly report the failing command's stderr
via `rawOutput` or a terminal-shaped content block, not a `text` content
block. Those blocks are silently dropped (`textFromContentItem` returns `""`
for non-text shapes, validated by the test at
`src/domain/tool-call.test.ts:175`).

Result: a failed Bash call frequently renders as `✗ Bash: npm test` with **no**
reason, partially missing PRD Core Feature #4 ("Inline failure reason") and the
user story "when a call fails I want a short reason on the line." It degrades
gracefully (errorText is optional, never throws), so this is not a crash — but
the stated goal is only partially met for the most common failure source.

**Suggested fix:** thread `rawOutput` through the accumulator into
`ToolCallInput`, and in `extractErrorText` fall back to a string/structured
`rawOutput` (and a terminal content block) when no text content yields a
reason. Cap as today. Add a test for an `execute` failure whose reason lives in
`rawOutput`.

## Triage

- Decision: `VALID`
- Root cause: `summarizeToolCall` extracted the failure reason from `content`
  text blocks only, and `ToolCallAccumulator`/`ToolCallInput` never carried
  `rawOutput`. For the `execute`/Bash kind — the PRD's primary surface — agents
  commonly report stderr via `rawOutput` (or a terminal block), so failed Bash
  calls rendered with no reason, only partially meeting the TechSpec
  ("extracted from the update's `content`/`rawOutput`", line 128) and PRD Core
  Feature #4.
- Fix approach:
  - Added `rawOutput?: unknown` to `ToolCallInput`.
  - `extractErrorText` now takes `(content, rawOutput)` and falls back to
    `rawOutput` when content yields no text: a bare string, or the first
    non-empty string among structured keys `stderr` → `error` → `message` →
    `output` → `stdout` (most-specific-first). Content text still wins when
    present. The existing `MAX_ERROR_LEN` cap is applied unchanged.
  - The ACP `Terminal` content block carries only a `terminalId` (no inline
    text per `@agentclientprotocol/sdk` `Terminal` type), so it is not a viable
    extraction source from a pure function and was intentionally not pursued;
    documented inline.
- Out-of-scope file touched (minimal): `src/infra/acp/tool-call-accumulator.ts`
  — added `rawOutput` to `AccumulatedFields` and folded `update.rawOutput` in
  `apply()`. Without this thread-through the domain change would have no runtime
  effect, since the accumulator is the sole producer of `ToolCallInput` at the
  ACP boundary.
- Tests: added `tool-call.test.ts` cases for string `rawOutput`, structured
  `rawOutput` (stderr preference), content-wins-over-rawOutput precedence,
  rawOutput cap, and a no-string-field rawOutput (no reason).
