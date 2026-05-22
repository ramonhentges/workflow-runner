---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/index.ts
line: 555
severity: critical
author: claude-code
provider_ref:
---

# Issue 003: cleanup() destroys the TUI before the keep-open wait

## Review Comment

The end-of-run sequencing in `main()` tears the TUI down immediately instead of
keeping it open for scrollback:

```ts
} finally {
  if (mcp) await mcp.close().catch(() => {});
  cleanup();                 // <-- renderer.destroy() runs here
}
await new Promise(() => {}); // "Keep TUI open until user quits"
```

The `finally` block runs as soon as the `try` completes (right after
`runWorkflow` returns and the summary is rendered). `cleanup()` calls
`renderer.destroy()`, so the terminal UI is destroyed *before* the
`await new Promise(() => {})` that is supposed to keep it open. The process then
hangs forever on a dead renderer: the user sees the TUI vanish, cannot scroll
back through the run log, and likely cannot even quit because the `keypress`
handler was registered on the now-destroyed `renderer.keyInput`.

This violates PRD Feature 8 ("keeps the TUI open so the user can scroll back"),
Feature 9 ("keeps the TUI open for inspection"), and the stated UX requirement
that "the log stays on screen" after finish or failure.

Suggested fix: do not call `cleanup()` in the `finally`. Close `mcp` and any
per-step resources there, but keep the renderer alive; perform `renderer.destroy()`
only on the explicit quit path (`/quit`, `/exit`, Ctrl+C) after the keep-open
wait, so the run log remains visible until the user chooses to exit.

## Triage

- Decision: `VALID`
- Notes: The issue accurately identifies a critical sequencing bug. The renderer is destroyed in the finally block before the keep-open wait, breaking the UX requirement to keep the TUI visible for scrollback. The fix is straightforward: only destroy the renderer on explicit quit paths (/quit, /exit, Ctrl+C), not in the finally block.

## Implementation

### Changes Made

1. **Created `killAgentProcess()` function** (lines 254-256): Extracted the agent process termination logic into a separate function.

2. **Modified `cleanup()` function** (lines 258-261): Now calls `killAgentProcess()` before destroying the renderer, maintaining the behavior for quit paths.

3. **Updated the `finally` block** (line 559): Changed to call `killAgentProcess()` instead of `cleanup()`, so the agent is killed and MCP closed without destroying the renderer.

4. **Result**: The renderer stays alive during the `await new Promise(() => {})` keep-open wait (line 563), allowing users to scroll through the run log until they explicitly quit via `/quit`, `/exit`, or Ctrl+C.

### Verification

- TypeScript compilation: ✓ No errors
- Test suite: ✓ 49 pass, 0 fail
- Build: ✓ Successfully bundled 103 modules
- Behavior: The fix preserves existing quit behavior while ensuring the TUI remains visible for scrollback after workflow completion
