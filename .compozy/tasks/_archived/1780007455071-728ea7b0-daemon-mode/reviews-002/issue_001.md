---
provider: manual
pr:
round: 2
round_created_at: 2026-05-28T10:17:03Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 445
severity: high
author: claude-code
provider_ref:
---

# Issue 001: McpServer leaks once a run reaches a terminal state

## Review Comment

`RunManager` allocates one `McpServer` per run in `startRun` (line 156) and only
closes it in two places: `retryStep` (line 276, when re-creating a server for
the retry) and `shutdown` (line 393). The terminal-state paths in
`#launchRunner` (lines 422–468) never close `record.mcpServer`, so every
`completed`, `failed`, or `crashed` run keeps its `McpServer` instance alive
for the lifetime of the daemon.

Each `McpServer` holds an ephemeral TCP port on `127.0.0.1`, an in-flight HTTP
listener, and event-loop refs. A daemon that completes runs steadily will leak
ports until the local ephemeral-port range is exhausted — well before the
documented "long-lived daemon" use case. `daemon.doctor` currently hides the
leak because `countOrphanPorts` is hardcoded to `0` in `daemon.ts:307`.

Suggested fix: close the server in `#launchRunner`'s `try` and `catch` blocks
after persisting the terminal-state snapshot, e.g.

```ts
try {
  if (record.mcpServer) {
    await record.mcpServer.close().catch(() => {});
    record.mcpServer = null;
  }
} catch {}
```

…and add an integration assertion that completing N runs holds at most one
extra port (the active one) regardless of N.

## Triage

- Decision: `valid`
- Notes: The issue correctly identifies a resource leak where McpServer instances are not closed when runs reach terminal states. This causes TCP port exhaustion on long-lived daemons that repeatedly complete runs.

## Solution

Fixed the leak by adding McpServer closure in both the try and catch paths of `#launchRunner` after transitioning to a terminal state and persisting the snapshot. This mirrors the pattern already used in `retryStep`.

Added three integration tests to verify:
1. Completed runs close their MCP server
2. Failed runs close their MCP server  
3. Multiple completed runs maintain at most one open server at any time
