---
provider: manual
pr:
round: 3
round_created_at: 2026-05-22T20:45:42Z
status: resolved
file: src/mcp.ts
line: 230
severity: medium
author: claude-code
provider_ref:
---

# Issue 006: MCP server cannot attribute a tool call to its originating step

## Review Comment

The MCP server tracks a single `currentStep`/`currentResolve` pair and resolves
whatever step is currently armed when *any* `tools/call` arrives — it has no way
to verify the call came from the step it is armed for. The handler keys only on
the tool name and the presence of `currentResolve` (lines 230, 287).

This creates a cross-step contamination window. When step N's agent calls
`handoff`, the handler resolves and nulls `currentResolve`. The runner then
cancels the turn and `teardownSession` kills step N's subprocess — but
`process.kill()` only sends a signal; the process can outlive it briefly. The
next iteration's `setupStepSession` calls `mcp.beginStep(stepN+1, ...)`
(line 305) *before* `newSession`, re-arming `currentStep`/`currentResolve` for
step N+1. If the still-dying agent N emits a second `tools/call` in that window,
the handler resolves **step N+1's** outcome with agent N's arguments —
potentially routing the workflow to a step the new agent never chose.

The likelihood is low (it needs a second tool call from a process under
teardown), but the impact is a silent mis-route, and the root cause is
structural: a single shared HTTP endpoint with no per-session/per-step
correlation.

Suggested fix: give each `beginStep` a unique step token, expose it to that
step's session (e.g. as a header or a tool-arg the runner injects/validates),
and have the handler reject or ignore tool calls whose token does not match the
currently armed step. At minimum, drop tool calls when the armed step's session
id does not match.

## Triage

- Decision: `valid`
- Notes:
  - **Root cause**: The MCP server's `tools/call` handler only checks for the
    presence of `currentResolve` without verifying the call originated from the
    step that armed it. HTTP requests from any source will be processed if a
    step is currently armed.
  - **Race condition**: `process.kill()` sends SIGTERM/SIGKILL but does not
    synchronously wait for the process to terminate. The `beginStep()` for step
    N+1 runs before we can guarantee step N's subprocess is truly dead.
  - **Fix approach**:
    1. Generate a unique step token in `beginStep()` and return it to the caller
    2. Store the token alongside `currentStep` and `currentResolve`
    3. Check for `x-workflow-step-token` HTTP header in the request handler
    4. Only accept `tools/call` requests when the header value matches the
       currently armed step token
    5. `tools/list`, `initialize`, and other read-only methods can remain
       unrestricted since they don't resolve outcomes
    6. Update runner.ts to pass the returned token as a header when configuring
       the MCP server in `connection.newSession()`
  - **Files to modify**:
    - `src/mcp.ts`: Add token generation, storage, and validation
    - `src/runner.ts`: Pass token via headers when creating the MCP server session
  - **Backwards compatibility**: Tests that call `tools/call` directly without
    headers will need to be updated to include the step token header.

## Resolution

- Changes made:
  1. Modified `WorkflowMcpServer.beginStep()` to return a `string` step token
  2. Added `currentStepToken` closure variable to track the armed step's token
  3. Added `generateStepToken()` function using `crypto.randomUUID()`
  4. Extract `x-workflow-step-token` header from incoming HTTP requests
  5. Validate token in `tools/call` handler; reject with -32001 if missing or mismatched
  6. Clear token in `resetStep()`
  7. Updated runner.ts to capture the returned token and pass it via headers
  8. Updated all mcp.test.ts cases that call `tools/call` to include the step token header
