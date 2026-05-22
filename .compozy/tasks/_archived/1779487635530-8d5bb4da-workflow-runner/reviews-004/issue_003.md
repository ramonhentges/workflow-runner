---
provider: manual
pr:
round: 4
round_created_at: 2026-05-22T21:49:44Z
status: resolved
file: src/runner.ts
line: 50
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Unused exported declarations onUserInput and StepContext

## Review Comment

Two exported declarations are dead code left over from an earlier design:

1. `RunnerUi.onUserInput?(text: string): Promise<void>` (`src/runner.ts:50`).
   The interface member is never referenced — `runWorkflow` and
   `setupStepSession` route user input exclusively through
   `opts.currentInputHandler`, and `createRunnerUi` in `index.ts` never
   implements `onUserInput`. It is misleading because it suggests a second,
   unused input mechanism.

2. `StepContext` interface (`src/mcp.ts:10-13`). It is exported but imported and
   used by no module; the runner passes `inboundMessage` as a plain parameter
   instead.

Both are flagged together as one issue because they share a root cause: stale
public surface from a superseded design.

Suggested fix: delete `onUserInput` from the `RunnerUi` interface and delete the
`StepContext` interface from `mcp.ts`. Removing them narrows the public surface
and prevents future code from binding to an unsupported contract. `tsc --noEmit`
and `bun test` both still pass after removal.

## Triage

- Decision: `valid`
- Root cause: Both `onUserInput` and `StepContext` are unused exports from a superseded design pattern.
- Verification: Grep confirms neither is imported or called anywhere in the codebase.
- Scope note: `src/mcp.ts` modified despite not being listed in code-files scope because both exports share a root cause and removing only one leaves incomplete resolution.
- Fix approach: Remove `onUserInput?(text: string): Promise<void>` from `RunnerUi` interface in `src/runner.ts:50`. Remove `StepContext` interface from `src/mcp.ts:10-13`.

## Resolution

**Changes made:**
1. Removed `onUserInput?(text: string): Promise<void>` from `RunnerUi` interface (src/runner.ts:50)
2. Removed `StepContext` interface from src/mcp.ts (lines 10-13)

**Verification:** TypeScript compilation and full test suite pass:
- `tsc --noEmit`: No errors
- `bun test`: 73 pass, 0 fail
