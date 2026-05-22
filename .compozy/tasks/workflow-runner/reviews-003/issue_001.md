---
provider: manual
pr:
round: 3
round_created_at: 2026-05-22T20:45:42Z
status: resolved
file: src/runner.ts
line: 200
severity: high
author: claude-code
provider_ref:
---

# Issue 002: Setup failure leaks the opencode subprocess and leaves MCP armed

## Review Comment

When `setupStepSession` throws after spawning the agent, the spawned
`opencode acp` subprocess is never killed and the MCP server is never reset.

`setupStepSession` spawns the subprocess at line 200, then arms the MCP server
via `mcp.beginStep(step, resolve)` at line 305, and only afterwards performs
checks that can throw:

- line 319 — `Agent does not support HTTP MCP capabilities`
- line 344 — `agent '<step.agent>' is not a valid mode`

The "invalid agent mode" case is one of the PRD's three named failure
scenarios, so this path is reachable in normal use. When it throws, the
exception propagates to `runWorkflow`'s `catch` (line 166), where `session` is
still `null` because `setupStepSession` never returned — so `teardownSession`
is skipped. The result:

- The `opencode acp` subprocess is orphaned. Because the PRD requires the TUI to
  stay open after a halt-and-report failure, that orphaned process keeps running
  for as long as the user inspects the failure.
- `mcp.beginStep` left `currentStep`/`currentResolve` armed with a resolver for
  a step the runner has already abandoned; `mcp.resetStep()` is never called.

Suggested fix: make `setupStepSession` clean up its own subprocess on any
throw — wrap the post-spawn logic in `try { ... } catch (err) { agentProcess.kill();
mcp.resetStep(); throw err; }` — or have `runWorkflow` track the subprocess
independently of a successful `StepSession` return so teardown still runs.

## Triage

- Decision: `VALID`
- Root cause: `setupStepSession` spawns `agentProcess` (line 208), arms MCP via `mcp.beginStep` (line 321), then continues with checks that can throw (HTTP capability at line 332, mode validation at line 358, setModel at line 378). When a throw occurs, the exception propagates to `runWorkflow`'s catch block (line 174), but `session` is still `null` because `setupStepSession` never returned. Therefore `teardownSession` is not called, leaving the subprocess orphaned and `mcp.resetStep()` uncalled.
- Fix: Wrap the post-spawn logic in `setupStepSession` (after the spawn-error check) in a try-catch that kills `agentProcess` and calls `mcp.resetStep()` on any throw, then re-throws.
