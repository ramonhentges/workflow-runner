---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/domain/run-id.ts
line: 421
severity: low
author: claude-code
provider_ref:
---

# Issue 010: parseIdentifier accepts empty input and matches every candidate

## Review Comment

`parseIdentifier` lowercases the input and uses `startsWith(normalized)` to
match. JavaScript's `String.prototype.startsWith("")` returns `true` for any
string, so passing `""` as `idOrPrefix` matches every candidate's id and
slug. With one active run, that resolves to a (silent) match; with multiple
runs, it returns `AMBIGUOUS_PREFIX` with the full registry as candidates.
Today this is gated by the CLI parsers, which reject empty strings, but it
is an easy footgun for any future caller (a programmatic API, a test
harness, or a future MCP-exposed handler).

Suggested fix: reject empty input explicitly.

```typescript
export function parseIdentifier(input, candidates) {
  if (input.length === 0) return { kind: "not-found" };
  const normalized = input.toLowerCase();
  ...
}
```

A unit test covering `parseIdentifier("", ...)` would make the contract
explicit.

## Triage

- Decision: `valid`
- Notes: `String.prototype.startsWith("")` returns `true` for every string, so passing `""` causes every candidate to match. With one run active it silently resolves to that run; with multiple it returns `ambiguous` with the full registry. The fix is a one-line early-return guard before the `normalized` assignment. A unit test for `parseIdentifier("", [...])` is added to make the contract explicit.
