---
provider: manual
pr:
round: 4
round_created_at: 2026-05-22T21:49:44Z
status: resolved
file: src/mcp.ts
line: 151
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: notifications/initialized gets a malformed JSON-RPC response

## Review Comment

`handleMcpRequest` answers the `notifications/initialized` message with an HTTP
200 and the body `{"jsonrpc":"2.0"}`:

```ts
if (method === "notifications/initialized") {
  res.end(JSON.stringify({ jsonrpc: "2.0" }));
  return;
}
```

Two problems:

1. `notifications/initialized` is a JSON-RPC *notification* — it carries no `id`
   and, by the JSON-RPC 2.0 spec, MUST NOT receive a response.
2. The body `{"jsonrpc":"2.0"}` is not a valid JSON-RPC message at all: it has
   no `id`, `method`, `result`, or `error`. A strict MCP client that parses the
   HTTP response to its notification POST can fail schema validation and tear
   down the transport.

Per the MCP Streamable HTTP transport, a POST that contains only notifications
or responses must return `202 Accepted` with an empty body. The code path above
also runs after the unconditional `res.writeHead(200, ...)` at line 124-129, so
the status cannot simply be changed in place.

Suggested fix: detect notification-only requests before writing headers and
respond with `202` and no body, e.g.:

```ts
if (method === "notifications/initialized") {
  res.writeHead(202);
  res.end();
  return;
}
```

This is low-risk and protocol-correct. It works with opencode today by luck of
a lenient client; making it conformant removes a fragile dependency. Note this
path is not covered by any test in `mcp.test.ts` — add a case asserting a `202`
with an empty body.

## Triage

- Decision: `VALID`
- Root Cause: The `notifications/initialized` handler responds with HTTP 200 and a malformed JSON-RPC body. Per JSON-RPC 2.0 spec, notifications (messages without an `id`) must NOT receive a response. Per MCP Streamable HTTP transport, POST requests containing only notifications should return 202 Accepted with an empty body.
- Impact: Strict MCP clients that validate response schemas can fail and tear down the transport connection.
- Fix Approach: Check for `notifications/initialized` BEFORE writing the default 200 headers. Return 202 Accepted with empty body. Add test coverage for this case.
