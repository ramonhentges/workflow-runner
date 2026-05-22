---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/index.ts
line: 229
severity: critical
author: claude-code
provider_ref:
---

# Issue 002: Interactive steps cannot receive user turns

## Review Comment

Interactive mode (PRD Core Feature 3, a P0) is structurally non-functional.

`handleInput()` sends user turns via `connection.prompt({ sessionId:
currentSessionId, ... })`. But `connection` is the module-global assigned once
in `main()` to a throwaway `opencode acp` process used only for the `initialize`
capability check — no session is ever created on it. `currentSessionId` is
declared `let currentSessionId = ""` and is never reassigned. So every interactive
keystroke is sent to a connection with no session (`sessionId: ""`) and fails.

The per-step sessions that actually run the workflow are created inside
`runner.ts` `setupStepSession()`; each gets its own `ClientSideConnection` stored
in the internal `StepSession` struct, which is never exposed outside `runner.ts`.
The `RunnerUi` interface has callbacks for `banner`/`log`/`setInteractive`/
`setStatus`/`summary` but **no callback to push user input into the current
step's session**. Consequently an interactive step runs its kickoff prompt once,
then `runWorkflow` simply awaits `outcomePromise` — the user can type into the
visible input field but the text reaches nothing, the agent never learns the
user's intent, and the step hangs forever.

Suggested fix: add a user-input channel to the runner — e.g. extend `RunnerUi`
or `RunOptions` so the TUI can deliver typed turns to the active step's
connection, and have `setupStepSession` register that connection as the current
turn target for interactive steps. Relatedly, the dedicated init subprocess in
`main()` is redundant: `setupStepSession` already verifies
`mcpCapabilities.http` per step, so the throwaway connection/process can be
removed once input wiring is corrected.

## Triage

- Decision: `VALID` (Critical)
- Root Cause: 
  - `handleInput()` was sending user input to the module-global `connection` with an empty `currentSessionId`
  - The actual step sessions are created inside `setupStepSession()` with their own connections and sessionIds
  - `RunnerUi` interface had no callback to deliver user input to the active step's session
- Fix Applied:
  - Added `onUserInput?: (text: string) => Promise<void>` optional callback to `RunnerUi` interface
  - Added `currentInputHandler` object to `RunOptions` to hold a mutable reference to the input handler
  - For interactive steps, `setupStepSession` now registers the current step's connection as the input handler
  - Updated `handleInput()` to call `currentInputHandler.handle()` instead of using global connection
  - Removed now-unused `currentSessionId` variable
