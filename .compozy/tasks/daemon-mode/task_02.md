---
status: completed
title: Run id and slug generation
type: backend
complexity: low
dependencies:
  - task_01
---

# Task 02: Run id and slug generation

## Overview
Implement deterministic-in-test, random-in-production generators for the run identifier (short opaque id) and the human-memorable slug (`adjective-animal`). These appear on every CLI command and in every log line, so getting their format right has user-experience impact disproportionate to the code size.

<critical>
- ALWAYS READ the PRD and TechSpec before starting
- REFERENCE TECHSPEC for implementation details — do not duplicate here
- FOCUS ON "WHAT" — describe what needs to be accomplished, not how
- MINIMIZE CODE — show code only to illustrate current structure or problem areas
- TESTS REQUIRED — every task MUST include tests in deliverables
</critical>

<requirements>
- MUST live in `src/domain/run-id.ts` (pure domain, no I/O imports).
- MUST expose `generateRunId(rand?: () => string): RunId` returning an 8-character lowercase base32 string derived from random bytes.
- MUST expose `generateSlug(rand?: () => number): RunSlug` returning `${adjective}-${animal}` from bundled wordlists.
- MUST bundle two static `const` wordlists (`ADJECTIVES`, `ANIMALS`) of ~200 entries each, kid-safe and easy to say (no profanity, no obscure references).
- MUST accept injected random sources (`() => string` for id, `() => number` for slug) so tests can drive deterministic outputs; default to `crypto.randomUUID()` and `Math.random()` respectively.
- MUST NOT add any new npm dependency (Bun ships `crypto.randomUUID`).
- MUST expose a `parseIdentifier(input: string, candidates: Array<{id: RunId; slug: RunSlug}>): {kind: "id" | "slug"; match: RunId} | {kind: "ambiguous"; candidates: RunId[]} | {kind: "not-found"}` helper for prefix matching used by the daemon.
</requirements>

## Subtasks
- [x] 2.1 Curate the `ADJECTIVES` and `ANIMALS` const wordlists, ~200 entries each. Inline-only — no separate JSON file.
- [x] 2.2 Implement `generateRunId` with an injectable random source; default uses `crypto.randomUUID()` and trims/base32-encodes to 8 chars.
- [x] 2.3 Implement `generateSlug` with an injectable random source; pick one adjective + one animal, joined with `-`.
- [x] 2.4 Implement `parseIdentifier` doing case-insensitive unambiguous-prefix matching against the supplied candidates.
- [x] 2.5 Write unit tests covering id format, slug format, collision rejection via candidate scan, and `parseIdentifier` for all four outcomes.

## Implementation Details
Create `src/domain/run-id.ts` importing `RunId`/`RunSlug` types from task 01. The base32 alphabet should use Crockford base32 (no `i`, `l`, `o`, `u`) to avoid confusable characters in typed CLI input. The `parseIdentifier` helper is responsible for matching user input against running-run candidates; the actual de-duplication retry loop lives in `RunManager` (task 08), which calls `generateRunId` repeatedly until the produced id is not in its active set.

### Relevant Files
- `src/domain/run.ts` (task 01) — defines `RunId` and `RunSlug` types this task imports.
- `src/domain/ids.ts` — branded-id pattern used by `RunId`/`RunSlug`.

### Dependent Files
- `src/infra/daemon/run-manager.ts` (task 08) — calls `generateRunId` and `generateSlug` on `startRun`, retries on collision.
- `src/infra/daemon/handlers/run-attach.ts` (task 10) — calls `parseIdentifier` to resolve user-supplied prefixes to run ids.
- `src/infra/daemon/handlers/run-stop.ts`, `run-send.ts`, `run-retry-step.ts` — same prefix-resolution path.
- `src/infra/client/format.ts` (task 13) — displays both id and slug in `ps` output.

### Related ADRs
- [ADR-002: Terminal-Multiplexer Mental Model for the Daemon CLI](adrs/adr-002.md) — locks in the Docker-style prefix-matching UX that `parseIdentifier` implements.

## Deliverables
- `src/domain/run-id.ts` with `generateRunId`, `generateSlug`, `parseIdentifier`, and the two bundled wordlists.
- Zero new npm dependencies.
- Unit tests with 80%+ coverage **(REQUIRED)**

## Tests
- Unit tests:
  - [x] `generateRunId()` returns a string of exactly 8 lowercase characters, each in the Crockford base32 alphabet `[0-9a-hjkmnp-tv-z]`.
  - [x] `generateRunId(() => "fixed-uuid-string-here")` returns the same id on every call (determinism under injected source).
  - [x] `generateSlug()` returns a string matching `/^[a-z]+-[a-z]+$/`.
  - [x] `generateSlug(() => 0)` returns `${ADJECTIVES[0]}-${ANIMALS[0]}` (determinism under injected source).
  - [x] `ADJECTIVES` and `ANIMALS` each contain at least 150 unique entries; no entry contains a hyphen or whitespace.
  - [x] `parseIdentifier("kf2", candidates=[{id:"kf2a9xeh",slug:"brave-otter"}])` returns `{kind:"id", match:"kf2a9xeh"}`.
  - [x] `parseIdentifier("brave", candidates=[{id:"kf2a9xeh",slug:"brave-otter"}])` returns `{kind:"slug", match:"kf2a9xeh"}`.
  - [x] `parseIdentifier("brave-otter", candidates=[…])` matches the full slug exactly.
  - [x] `parseIdentifier("k", candidates=[{id:"kf2…",slug:"…"},{id:"k83…",slug:"…"}])` returns `{kind:"ambiguous", candidates: [kf2…, k83…]}`.
  - [x] `parseIdentifier("zzz", candidates=[…non-matching…])` returns `{kind:"not-found"}`.
  - [x] `parseIdentifier("BRAVE", …)` is case-insensitive and matches `brave-otter`.
- Integration tests:
  - [x] None for this task — generators are pure functions. Cross-task collision behavior is exercised by task 08's tests.
- Test coverage target: >=80%
- All tests must pass

## Success Criteria
- All tests passing
- Test coverage >=80%
- No new entries in `package.json` dependencies.
- `src/domain/run-id.ts` has zero imports from `src/infra/` or `src/app/`.
