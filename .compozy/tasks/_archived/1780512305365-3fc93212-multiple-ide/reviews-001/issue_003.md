---
provider: manual
pr:
round: 1
round_created_at: 2026-06-02T15:03:58Z
status: resolved
file: src/infra/acp/ide-profiles.test.ts
line: 360
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Per-agent configureSession tests duplicate one identical suite 4x

## Review Comment

The test file repeats the same `configureSession` suite for each agent —
`opencode` (line 194), `claude-code` (line 360), `codex` (line 523), and
`gemini` (line 686) — with near-identical cases (valid mode, unknown mode,
no-modes skip, log assertions, setSessionMode error wrap, model setter error
wrap). Because the four production `configureSession` bodies are identical
(see issue 001), these ~480 lines exercise one code path four times and add
maintenance cost without adding coverage.

Suggested fix: once issue 001 collapses the profiles onto one shared helper,
parameterize the behavioral suite with `it.each`/`describe.each` over the
profile ids, and keep only the genuinely per-profile assertions (spawn
command/args/env) as separate cases. This shrinks the file and keeps a single
source of truth for the shared behavior.

## Triage

- Decision: `valid`
- Notes: Partially confirmed. The issue's premise that "all four `configureSession`
  bodies are identical" is no longer accurate after issue 001 was resolved: that
  fix produced **two** helpers in `ide-profiles.ts`, not one —
  `configureStandardSession` (opencode, validates `step.agent` against advertised
  modes) and `configurePermissiveSession` (claude-code, codex, gemini, skips
  validation). So the opencode suite tests genuinely distinct behavior (the
  "throws when agent not in available mode ids" case) and must stay separate. The
  three permissive suites, however, exercise the same `configurePermissiveSession`
  with near-identical cases (~390 lines) and are true duplicates.
  Root cause: copy-paste of the permissive behavioral suite three times.
  Fix approach: parameterize the three permissive profiles
  (claude-code/codex/gemini) with `describe.each` over their ids, folding the
  per-profile spawn assertion in as a single case, and leave the opencode
  (standard/validating) suite untouched. Scope is limited to the test file
  `src/infra/acp/ide-profiles.test.ts`; no production change is needed.
- Resolution: Replaced the three copy-pasted permissive `configureSession`
  suites and their standalone per-profile spawn `describe` blocks with a single
  `describe.each(permissiveProfiles)` block parameterized over
  claude-code/codex/gemini. Each row carries its `ide`, spawn `command`,
  `sessionId`, `agent`, and `model`; the per-profile spawn assertion is folded in
  as one case. The opencode (standard/validating) suite is left intact because
  its "throws when agent not in available mode ids" case has no permissive
  counterpart. File shrank from 812 to ~600 lines. `as const` was deliberately
  omitted from the table so it matches Bun's mutable `each<const T>(table: T[])`
  overload and the callback receives a typed row.
  Verification: `bun run typecheck` exit 0; `bun test src/infra/acp/ide-profiles.test.ts`
  → 42 pass / 0 fail; full `bun test` → 830 pass / 1 skip / 0 fail; `bun run build` exit 0.
