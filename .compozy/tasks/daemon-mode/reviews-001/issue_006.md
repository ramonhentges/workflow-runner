---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/infra/daemon/run-manager.ts
line: 120
severity: medium
author: claude-code
provider_ref:
---

# Issue 006: startRun id/slug uniqueness check races with concurrent starts

## Review Comment

`RunManager.startRun` snapshots existing pairs at line 120, runs the
generate/retry loop, then awaits `this.#store.persist(...)` *before* inserting
the new record into `#registry` at line 155. Two concurrent `run.start` RPCs
on different connections can both pass the `do { ... } while` check using the
same stale `existingPairs` and then both attempt to use the same generated
id or slug. ID collisions are unlikely given 8 base32 chars from a UUID, but
slug collisions ride on ~16 bits of entropy (200×200 wordlist) and the spec
explicitly allows recycling slugs of terminal runs >24h old — so users will
collide in practice once enough runs accumulate.

Symptom: both runs write `meta.json` to the same `runDir`, and the second
`#registry.set(runId, record)` overwrites the first record's `runner`,
`mcpServer`, and `eventLog`, leaking the first run's resources and producing
indistinguishable IDs in `ps`.

Suggested fix: synchronize generation. Either (a) hold a per-manager mutex
around the id/slug allocation + registry insertion block, or (b) reserve the
id/slug by inserting a placeholder record into `#registry` *before* the await
on `persist()` and remove it on failure.

## Triage

- Decision: `valid`
- Notes: The race is real. `startRun` snapshots `existingPairs` once (line 120) before the do-while loop, then only calls `#registry.set` at line 155 — _after_ three awaits (`persist`, `EventLog.open`, `createMcpServer`). Two concurrent calls both complete `await Workflow.load()`, both snapshot an empty (or identically-stale) `existingPairs`, both generate "aaaa"/"brave-cat", both pass the uniqueness check, both proceed to `persist`, and whichever sets the registry second silently overwrites the first record's `runner`, `mcpServer`, and `eventLog` — leaking all three. Slug entropy is ~16 bits (200×200 wordlist) with recycling allowed after 24h, making collisions likely in practice.

  Fix: option (b) — reserve the slot in `#registry` synchronously _before_ any `await`. Since JS is single-threaded, the check-and-reserve inside a synchronous block is atomic: once one call exits the do-while loop and calls `#registry.set`, any concurrent call that subsequently executes its do-while sees the reservation and retries. Also switch the loop condition to check the live `#registry` on every iteration (instead of a pre-snapshot), so a reservation made between iterations is detected. Wrap the subsequent async I/O in try/catch that removes the placeholder if any step fails.
