---
provider: manual
pr:
round: 4
round_created_at: 2026-05-22T21:49:44Z
status: resolved
file: src/index.ts
line: 174
severity: low
author: claude-code
provider_ref:
---

# Issue 002: Input bar stays hidden after an autonomous final step

## Review Comment

The input bar visibility is driven only by `setInteractive`, which `runner.ts`
calls per step (`ui.setInteractive(step.mode === "interactive")` at
`runner.ts:386`). When the workflow's final step is `autonomous`, the last call
sets `inputBar.height = 0`, and nothing restores it afterwards.

The end-of-run `summary` callback (`index.ts:174-188`) renders the summary and
sets a status, but never calls `setInteractive(true)`. The TUI is intentionally
kept open for scrollback (PRD Core Feature 8), yet with the input bar collapsed
the documented `/quit` and `/exit` commands handled in `handleInput`
(`index.ts:95-98`) are unreachable — only `Ctrl+C` exits.

This affects the `who-is.json` milestone directly: the run finishes on an
autonomous step (`step-2` or `step-3`), so the post-run state always has a
hidden input bar.

Suggested fix: in the `summary` UI callback, re-enable the input bar before the
keep-open phase, so the user can type `/quit`:

```ts
summary: (summary: RunSummary) => {
  ...
  setInteractive(true);
  inputField?.focus();
}
```

Alternatively, document `Ctrl+C` as the post-run exit in the summary text.

## Triage

- Decision: `VALID`
- Root cause: The `summary` UI callback rendered the final state but did not restore the input bar visibility after autonomous steps completed.
- Implementation: Added `setInteractive(true)` and `inputField?.focus()` to the summary callback in `src/index.ts:188-189`. This ensures the input bar is visible post-run, allowing users to type `/quit` or `/exit` commands when the workflow ends on an autonomous step.
- Verification: Full pipeline passed (typecheck: pass, build: pass, tests: 73 pass/0 fail).
