---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/runner.ts
line: 174
severity: medium
author: claude-code
provider_ref:
---

# Issue 008: Child opencode stderr is inherited and corrupts the TUI

## Review Comment

`setupStepSession` spawns `opencode acp` with
`stdio: ["pipe", "pipe", "inherit"]`, and `index.ts` line 491 does the same for
the init subprocess. With `"inherit"`, the child's stderr writes directly to the
terminal that `@opentui/core` is actively rendering into. Any diagnostic,
warning, or stack trace opencode emits will splatter raw text over the TUI's
managed screen buffer, corrupting the rendered log, banners, status line, and
input field — undermining the PRD's "clear, observable log" goal.

Suggested fix: pipe the child's stderr (`stdio: ["pipe", "pipe", "pipe"]`),
attach a `data` listener, and route the output into the TUI log via `ui.log`
(e.g. dimmed, prefixed with the step id). If child diagnostics are not wanted at
all, use `"ignore"` instead of `"inherit"`. Either way, the child must not write
straight to the rendered terminal.

## Triage

- Decision: `valid`
- Notes: The issue correctly identifies that `stdio: ["pipe", "pipe", "inherit"]` allows child process stderr to write directly to the terminal, corrupting TUI output. Two instances need fixing: src/runner.ts:179 (setupStepSession) and src/index.ts:493 (init subprocess). Both should pipe stderr and route through ui.log.
