---
provider: manual
pr:
round: 5
round_created_at: 2026-05-22T21:59:45Z
status: resolved
file: package.json
line: 14
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: ADR-002 not followed — @modelcontextprotocol/sdk is an unused dependency

## Review Comment

ADR-002 ("In-process HTTP MCP server") and the TechSpec both specify that the
MCP server is "built with `@modelcontextprotocol/sdk` using its Streamable HTTP
transport" (ADR-002 Implementation Notes; TechSpec Integration Points). The
dependency is declared in `package.json:14` (`"@modelcontextprotocol/sdk":
"^1.29.0"`) and task_01 was dedicated to adding it.

The actual implementation in `src/mcp.ts` hand-rolls a JSON-RPC-over-HTTP server
on `node:http` and never imports `@modelcontextprotocol/sdk`. A repo-wide grep
confirms the package is not referenced anywhere in `src/`. The result is a
documented architectural decision that the code does not match, plus a declared
runtime dependency that is dead weight (it ships in `node_modules` and the
lockfile for nothing).

This is architecture/documentation drift rather than a behavioral bug — the
hand-rolled server works and has been hardened across four review rounds
(body-size limit, step tokens, JSON-RPC error codes, initialize handshake,
`notifications/initialized`). Rewriting it onto the SDK now would discard that
hardening for no functional gain.

Suggested fix: reconcile the docs and the manifest with reality rather than
rewriting working code.
- Remove `@modelcontextprotocol/sdk` from `package.json` dependencies (and the
  lockfile).
- Amend ADR-002's Decision and Implementation Notes to record that the server
  is a minimal hand-rolled JSON-RPC/HTTP endpoint (only `initialize`,
  `notifications/initialized`, `tools/list`, `tools/call` are needed), and note
  why the SDK was not adopted.
- Update the TechSpec Integration Points and Impact Analysis rows that name the
  SDK.

If keeping the SDK is preferred instead, migrate `src/mcp.ts` to its Streamable
HTTP transport — but the pragmatic resolution is to drop the unused dependency.

## Triage

- Decision: `VALID`
- Notes: Confirmed that `@modelcontextprotocol/sdk` is declared in `package.json:14` but never imported or used anywhere in `src/`. The implementation uses `node:http` to hand-roll a JSON-RPC/HTTP server instead. The pragmatic fix is to remove the unused dependency and update the documentation to match the actual implementation.

## Implementation

### Changes Made:
1. **Removed unused dependency** from `package.json` — deleted `"@modelcontextprotocol/sdk": "^1.29.0"` from dependencies.
2. **Updated ADR-002** (`adrs/adr-002.md`) — Modified Implementation Notes to document that the server is hand-rolled with `node:http` implementing JSON-RPC 2.0, noting why the SDK was not adopted.
3. **Updated TechSpec** (`_techspec.md`):
   - Corrected Integration Points section to reference "hand-rolled JSON-RPC/HTTP endpoint" instead of SDK
   - Updated Impact Analysis row for `src/mcp.ts` to remove "new dependency" risk
   - Updated Impact Analysis row for `package.json` to remove SDK reference
   - Updated Development Sequencing step 7 to remove SDK installation requirement
   - Removed SDK from Technical Dependencies section
