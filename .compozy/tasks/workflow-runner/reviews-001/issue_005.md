---
provider: manual
pr:
round: 1
round_created_at: 2026-05-22T19:42:20Z
status: resolved
file: src/index.ts
line: 563
severity: high
author: claude-code
provider_ref:
---

# Issue 005: Process always exits 0; failure exit code is unreachable

## Review Comment

The runner never exits non-zero, so it is not scriptable as the TechSpec
requires ("process exits `0` on `finish`, non-zero on any failure").

`main()` computes `exitCode` (1 on `summary.failure` or fatal error, else 0),
then runs:

```ts
await new Promise(() => {}); // never resolves
exit(exitCode);              // unreachable
```

`new Promise(() => {})` never settles, so `exit(exitCode)` is dead code and
`exitCode` is never consumed. The only paths that actually terminate the process
are `handleInput`'s `/quit`/`/exit` branch and the Ctrl+C handler — both call
`exit(0)` unconditionally. A failed workflow therefore still exits 0.

Suggested fix: route all quit paths through a single shutdown function that
exits with the run's actual code. Store the computed `exitCode` in a shared
variable and have `/quit`, `/exit`, and Ctrl+C call `exit(exitCode)` instead of
hardcoded `exit(0)`. This pairs with issue 003's fix for the cleanup ordering.

## Triage

- Decision: `valid`
- Root cause: The `exitCode` computed in `main()` (lines 545-548) is module-local and inaccessible to the `/quit`/`/exit` handler (line 228) and Ctrl+C handler (line 471). Both handlers hardcode `exit(0)`. The `await new Promise(() => {})` at line 563 never resolves, so line 565 is unreachable dead code.
- Fix approach: Move `exitCode` to module scope, create a `shutdown()` function that calls `cleanup()` and `exit(exitCode)`, and update handlers to call `shutdown()` instead of hardcoding `exit(0)`.

## Implementation

Changes made to `src/index.ts`:

1. **Added module-level `exitCode` variable** (line 72): Created a shared variable initialized to `0` that can be accessed by all handlers and `main()`.

2. **Created `shutdown()` function** (lines 264-267): New function that calls `cleanup()` and `exit(exitCode)`, centralizing the shutdown logic.

3. **Updated `/quit`/`/exit` handler** (lines 228-231): Changed from `cleanup(); exit(0);` to `shutdown();`, which now uses the computed exit code.

4. **Updated Ctrl+C handler** (lines 469-477): Changed from `cleanup(); exit(0);` to `shutdown();`, which now uses the computed exit code.

5. **Removed unreachable code**: Deleted the `await new Promise(() => {})` and `exit(exitCode)` statements at the end of `main()` (previously lines 563-565).

6. **Removed local `exitCode` declaration**: Removed the local variable in `main()` so it uses the module-level variable instead.

The fix ensures that:
- When a workflow fails, the process exits with code 1 (as required by TechSpec)
- When a workflow succeeds, the process exits with code 0
- All quit paths (Ctrl+C, `/quit`, `/exit`) use the same shutdown logic
- The exit code is scriptable as required

## Verification

- TypeScript type checking: ✅ PASS (no errors)
- Build: ✅ PASS (bundled successfully in 48ms)
- Test suite: ✅ PASS (49 pass, 0 fail across 4 files)
