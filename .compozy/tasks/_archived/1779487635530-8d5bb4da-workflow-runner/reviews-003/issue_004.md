---
provider: manual
pr:
round: 3
round_created_at: 2026-05-22T20:45:42Z
status: resolved
file: src/runner.ts
line: 409
severity: medium
author: claude-code
provider_ref:
---

# Issue 005: currentInputHandler is never reset; points at torn-down sessions

## Review Comment

`currentInputHandler.handle` is only ever (re)assigned inside the *interactive*
branch of `setupStepSession` (lines 409-428). It is never reset when a step ends
and never set for autonomous steps. As a result the shared handler keeps
referencing the previous step's `connection`/`sessionId` after that session has
been cancelled and its subprocess killed by `teardownSession`.

Concrete consequences:

- After an interactive step hands off to an *autonomous* step, the input field
  is hidden but `currentInputHandler.handle` still closes over the dead
  interactive session. Any input that reaches `handleInput` runs `prompt()`
  against a torn-down connection.
- During the next interactive step's kickoff (`await connection.prompt` at
  line 402, before the reassignment at line 409), the handler still points at
  the *previous* step's dead session.

The initial value in `index.ts` is a no-op (`handle: async () => {}`), which is
the correct safe default — but it is never restored.

Suggested fix: reset `currentInputHandler.handle` to a no-op in
`teardownSession` (or at the top of each iteration in `runWorkflow`), and assign
the real handler only once the new interactive session is fully ready. This
guarantees user input is either handled by the current live session or harmlessly
dropped, never routed to a dead one.

## Triage

- Decision: `VALID`
- Root cause: `teardownSession` kills the subprocess and resets MCP state but never clears `currentInputHandler.handle`, which still captures the dead session's `connection`/`sessionId`.
- Fix: added `currentInputHandler` parameter to `teardownSession` and reset the handle to a no-op from both call sites in `runWorkflow` (lines 157 and 176). This guarantees user input is either handled by the current live session or harmlessly dropped, never routed to a torn-down session.
- Test: added "resets currentInputHandler handle after step completes" test in `runner.test.ts` that verifies the handler reference changes after a step ends.
