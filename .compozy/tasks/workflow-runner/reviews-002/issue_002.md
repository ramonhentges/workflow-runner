---
provider: manual
pr:
round: 2
round_created_at: 2026-05-22T20:26:37Z
status: resolved
file: src/mcp.ts
line: 113
severity: high
author: claude-code
provider_ref:
---

# Issue 002: MCP handler double-writes the HTTP response and crashes runner

## Review Comment

The MCP HTTP server writes the response in several places without tracking
whether headers/body were already sent, so an error path writes the response a
second time, Node throws `ERR_HTTP_HEADERS_SENT` / `ERR_STREAM_WRITE_AFTER_END`,
and because that throw happens inside an event handler it becomes an uncaught
exception that crashes the whole runner process.

**Malformed `tools/call` (most representative).** `handleMcpRequest` calls
`res.writeHead(200, ...)` (line 113) before dispatching. In the `tools/call`
branch it then does `const params = req.params as Record<string, unknown>;`
and `const toolName = params.name as string;`. If a tool is called without a
`params` object — or `finish`/`handoff` called without an `arguments` object
(`const message = toolInput.message` → `toolInput` is `undefined`) — a
`TypeError` is thrown. That throw unwinds into the `req.on("end")` catch block,
which runs `res.writeHead(400)` on a response whose `200` headers are already
sent → `ERR_HTTP_HEADERS_SENT` thrown *inside the catch* → uncaught → process
crash. An LLM agent calling `finish` with no `message` argument is enough to
crash the orchestrator instead of finishing the workflow.

**Body-size guard (same root cause, `startServer`).** When `totalSize >
MAX_BODY_SIZE` the `req.on("data")` handler calls `res.writeHead(413)` +
`res.end()` but does not destroy the request. The next `data` chunk re-enters
the branch and calls `res.writeHead(413)` again on an ended response → throw →
crash; and `req.on("end")` still fires afterwards and calls `handleMcpRequest`,
which writes the response yet again.

Suggested fix: track response state and never write twice. Validate
`req.params` / `params.arguments` before dereferencing and return a proper
JSON-RPC `-32602` (invalid params) error instead of throwing. In the catch
block, only `writeHead` if `!res.headersSent`. In the size-limit branch, call
`req.destroy()` and set a flag the `end` handler checks so it bails. Adopting
`@modelcontextprotocol/sdk`'s transport (round 1, issue 001) would remove this
hand-rolled lifecycle management entirely. Add tests for malformed `tools/call`,
unknown methods, and oversized bodies — none are currently covered.

## Triage

- Decision: `VALID` ✓
- Notes: Critical vulnerability confirmed and fixed. The issue was real: calling `res.writeHead(200)` at line 114 unconditionally, then attempting to write response headers again in error paths without checking `res.headersSent`, causes `ERR_HTTP_HEADERS_SENT` which crashes the runner process.

## Implementation

**Root causes fixed:**

1. **Response state tracking** (line 119): Added `!res.headersSent` check before writing headers to prevent double-write errors in catch block.

2. **Size limit guard** (lines 73-82): Added `sizeExceeded` flag and `req.destroy()` call when body exceeds 1MB limit, plus early return in `req.on("end")` to prevent duplicate request processing.

3. **Parameter validation** (lines 199-216): Added strict validation of `params`, `params.name`, and `params.arguments` before dereferencing, returning JSON-RPC -32602 (invalid params) error instead of throwing TypeError.

4. **Tool-specific validation** (lines 219-232, 250-260): Added type checks for `handoff` (requires next_step and message strings) and `finish` (requires message string) before accessing properties.

**Tests added:** 8 new test cases covering all vulnerability paths:
- Missing params → -32602 error
- Missing arguments → -32602 error  
- finish without message → -32602 error
- handoff without required fields → -32602 error
- Unknown method → -32601 error
- Oversized body (2MB) → 413 response without crash
- Malformed JSON → 400 response without crash

**Verification:** Full test suite passes (60 tests, 0 failures). New tests confirm the fix prevents crashes on all identified error paths.
