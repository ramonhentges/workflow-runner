---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/mcp.ts
line: 20
severity: medium
author: claude-code
provider_ref:
---

# Issue 009: MCP server keeps current step in module-level mutable state

## Review Comment

`currentStep` and `currentResolve` are declared as module-level `let` variables
(lines 20-21) rather than being captured per-instance inside
`createWorkflowMcpServer`. The factory function exists specifically to return an
encapsulated `WorkflowMcpServer`, but its `beginStep` method mutates shared
module globals instead of closure state.

With the single-server design this happens to work, but it is a latent bug: any
second `WorkflowMcpServer` instance (the test suite already constructs a second
server in "can be created and closed without errors") shares the same
`currentStep`/`currentResolve`, so `beginStep` on one server would silently
overwrite the other's armed handler. It also makes the state harder to reason
about and untestable in isolation.

Suggested fix: move `currentStep` and `currentResolve` inside
`createWorkflowMcpServer` as closure variables that `handleMcpRequest` and
`beginStep` close over. The module level should hold no per-server runtime
state.

## Triage

- Decision: `VALID`
- Notes: Module-level mutable state violates encapsulation and prevents independent server instances. Moving `currentStep` and `currentResolve` into closure variables inside `createWorkflowMcpServer` ensures each instance has its own state.

## Fix Applied

Moved `let currentStep` and `let currentResolve` from module level (lines 20-21) into the `createWorkflowMcpServer` function (lines 46-47). Both variables are now closure variables that each server instance captures independently. The `handleMcpRequest` function (defined inside the factory) and the `beginStep` method (returned in the server object) both close over these per-instance variables.

## Verification

- TypeScript check: ✓ Pass (no errors)
- Test suite: ✓ Pass (49/49 tests pass, 0 failures)
