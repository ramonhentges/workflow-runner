---
provider: manual
pr:
round: 5
round_created_at: 2026-05-28T16:40:33Z
status: resolved
file: src/infra/daemon/rpc/ndjson.ts
line: 1
severity: high
author: claude-code
provider_ref:
---

# Issue 001: ndjsonLines shares a module-level TextDecoder across connections

## Review Comment

`ndjson.ts` constructs a single `TextDecoder` at module scope and reuses it
inside every invocation of `ndjsonLines()`:

```ts
const decoder = new TextDecoder();

export async function* ndjsonLines(readable) {
  // ...
  buffer += decoder.decode(value, { stream: true });
  // ...
}
```

`decoder.decode(value, { stream: true })` is *stateful*: when the input chunk
ends partway through a multi-byte UTF-8 sequence, the decoder buffers the
trailing bytes internally and prepends them on the next call. Because the
daemon's `bindSocket` handler spawns a fresh `RpcServer`/`accept` for every
incoming connection (`daemon.ts:348-364`) and every accept call drives its own
`ndjsonLines` generator, two concurrent client connections share the same
decoder state. If client A delivers a chunk ending mid-character while client B
is also reading, B's first call splices in A's leftover bytes, producing
mojibake on B's side and missing bytes on A's side — corrupting the JSON-RPC
frames in both streams. Failure mode is hard to reproduce because it only fires
when interleaved reads land on a multi-byte boundary, but it is silently
data-corrupting when it does.

Other call sites already use per-instance decoders (`client.ts:56`,
`server.test.ts:35`), so this is the only shared-state instance.

### Suggested fix

Move the decoder into the generator so each connection owns its own state:

```ts
export async function* ndjsonLines(readable) {
  const decoder = new TextDecoder();
  const reader = readable.getReader();
  let buffer = "";
  // ...
}
```

## Triage

- Decision: `valid`
- Notes: Confirmed. `const decoder = new TextDecoder()` at module scope (ndjson.ts:1) is shared across
  all `ndjsonLines()` invocations. `TextDecoder.decode(value, { stream: true })` is stateful — it
  buffers trailing bytes from incomplete multi-byte UTF-8 sequences between calls. Two concurrent
  connections that share the decoder instance will splice each other's buffered byte remainders,
  producing corrupted JSON-RPC frames. Fix: move `const decoder = new TextDecoder()` inside the
  generator body so every call site owns its own isolated decoder instance.
