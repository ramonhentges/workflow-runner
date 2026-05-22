---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/mcp.ts
line: 69
severity: medium
author: claude-code
provider_ref:
---

# Issue 012: Request body assembled with unsafe decoding and no size limit

## Review Comment

The MCP HTTP server accumulates the request body as:

```ts
let body = "";
req.on("data", (chunk) => { body += chunk.toString(); });
```

Two problems:

1. **Multi-byte corruption.** `chunk.toString()` decodes each chunk
   independently as UTF-8. When a multi-byte character (non-ASCII text, emoji)
   straddles a chunk boundary, each half is decoded separately and the character
   is corrupted. Handoff and finish messages are agent-authored prose and may
   well contain non-ASCII content, so this is a real correctness risk, not
   theoretical.
2. **No size bound.** `body` grows without limit; a malformed or oversized
   request would buffer unboundedly in memory.

Suggested fix: collect raw buffers and decode once at the end —
`const chunks: Buffer[] = []; req.on("data", c => chunks.push(c)); req.on("end",
() => { const body = Buffer.concat(chunks).toString("utf-8"); ... });` — and
enforce a reasonable maximum body size, rejecting with 413 if exceeded.
Adopting `@modelcontextprotocol/sdk`'s transport (issue 001) would resolve this
for free.

## Triage

- Decision: `VALID`
- Notes: Issue confirmed as a real security and correctness risk. The original code `body += chunk.toString()` would corrupt multi-byte UTF-8 characters (emoji, non-ASCII text) when they straddle chunk boundaries, and had no size limit.

## Fix Applied

Changed request body accumulation to:
1. Collect raw chunks as `Buffer[]` instead of converting each to string
2. Decode once at the end with `Buffer.concat(chunks).toString("utf-8")` to preserve multi-byte characters
3. Added MAX_BODY_SIZE limit of 1MB, rejecting oversized requests with HTTP 413

This ensures:
- Multi-byte characters are decoded correctly
- Requests exceeding 1MB are rejected early
- Memory is not unboundedly consumed

## Verification

- TypeScript type checking: PASS
- Build: PASS (bundled successfully in 46ms)
- Tests: PASS (53 tests passed, 0 failed)
