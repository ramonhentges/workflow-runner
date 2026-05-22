---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/index.ts
line: 131
severity: medium
author: claude-code
provider_ref:
---

# Issue 010: Dead session handlers in index.ts; no streaming primitive in RunnerUi

## Review Comment

After the rewrite, `index.ts` retains a full set of ACP session handlers —
`handleSessionUpdate`, `handlePermission`, `handleWriteTextFile`,
`handleReadTextFile`, plus the `appendStream`/`flushStream`/`streamedEl`
machinery — wired to the `acpClient` of the init connection. That connection
never creates a session and never prompts (it exists only for the capability
check, see issue 002), so all of this is dead code. The real per-step work runs
through a parallel, near-duplicate handler set defined inline in `runner.ts`
`setupStepSession`.

The two handler sets are not equivalent. `index.ts` `handleSessionUpdate`
coalesces `agent_message_chunk`/`agent_thought_chunk` into a single growing
`TextRenderable` via `appendStream`. The `runner.ts` `sessionUpdate` handler can
only call `ui.log`, because `RunnerUi` exposes no streaming primitive — so every
chunk of agent output becomes a separate log line. Autonomous step output (which
the PRD says must stream "thinking and tool data") renders as a fragmented wall
of one-token-per-line entries.

Suggested fix: delete the dead handlers and streaming machinery from `index.ts`,
and add a streaming/append callback to the `RunnerUi` interface (e.g.
`appendStream(type, chunk, color?)`) so `runner.ts` can render coalesced agent
output. Keep a single shared implementation of the session-update handler rather
than two divergent copies.

## Triage

- Decision: `VALID`
- Root cause: Init connection never creates a session (lines 519-534 in index.ts are capability-check only), so handlers wired to it are dead code. Per-step sessions in runner.ts have duplicate handlers that lack streaming coalescing, causing agent output fragmentation.
- Fix approach: Add `appendStream` to RunnerUi interface, implement it in CLI renderer, update runner.ts handlers to use it for message/thought chunks, delete dead handlers from index.ts.
