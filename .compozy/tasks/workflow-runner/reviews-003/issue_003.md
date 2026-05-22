---
provider: manual
pr:
round: 3
round_created_at: 2026-05-22T20:45:42Z
status: resolved
file: src/index.ts
line: 423
severity: medium
author: claude-code
provider_ref:
---

# Issue 004: index.ts spawns a redundant long-lived opencode process and dead permission UI

## Review Comment

`main()` spawns its own `opencode acp` subprocess (lines 423-429), builds a full
`ClientSideConnection`, and calls `connection.initialize` purely to verify
`agentCapabilities.mcpCapabilities.http`. That connection never creates a
session or sends a prompt — yet `agentProcess` and `connection` are held as
module globals and the subprocess is only killed in the `finally` block, so an
otherwise-idle `opencode` process runs for the entire workflow duration.

This duplicates work `setupStepSession` already does: `runner.ts` line 317
performs the identical `mcpCapabilities.http` check for every step's own
session. The pre-run process buys at most an earlier error, at the cost of a
whole lingering subprocess.

Because that connection never runs a session, an entire permission-handling
path in `index.ts` is now dead code:

- `handlePermission` (lines 103-129) — passed to the pre-run `AcpClient` but
  never invoked, since the connection issues no `prompt`.
- `permissionResolver` / `permissionOptions` and the permission branch of
  `handleInput` (lines 132-147) — only reachable if `handlePermission` fired.
- The permission branch of the Ctrl+C handler (lines 401-405).

Per-step sessions use a different handler entirely (`requestPermission` in
`setupStepSession`, runner.ts lines 237-259), so none of the above can run.

Suggested fix: either close the pre-run connection and kill its subprocess
immediately after the capability check, or drop the pre-run check entirely and
rely on the per-step check in `setupStepSession`. Then remove the unreachable
`handlePermission`/`permissionResolver`/`permissionOptions` code.

## Triage

- Decision: VALID
- Root cause: `main()` in `src/index.ts` spawns a dedicated opencode ACP subprocess purely to verify `agentCapabilities.mcpCapabilities.http` (lines 422-475). This check is already performed per-step in `setupStepSession` (runner.ts:322-334), making the pre-run subprocess redundant while keeping it alive for the entire workflow. Because no session or prompt is ever sent through this early connection, the permission-handling code (`handlePermission`, `permissionResolver`/`permissionOptions`, their branches in `handleInput` and the Ctrl+C handler) is entirely dead code — the per-step connection uses a different handler (`requestPermission` in runner.ts:248-272).
- Fix approach: Drop the pre-run check entirely and remove the dead permission infrastructure. Specifically: (1) remove `agentProcess` and `connection` module globals, (2) remove `handlePermission`, (3) remove `permissionResolver`/`permissionOptions` and their branches, (4) remove the opencode spawn/connect/initialize block, (5) clean up now-unused imports (`spawn`, `ChildProcess`, `Writable`, `Readable`, `ClientSideConnection`, `ndJsonStream`, `RequestPermission*`, `AcpClient`), (6) simplify `cleanup()` and `finally` to remove the dead `killAgentProcess()` call.
