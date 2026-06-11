---
provider: manual
pr:
round: 1
round_created_at: 2026-06-11T13:33:39Z
status: resolved
file: src/app/api/schema.ts
line: 97
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: Branch name not validated/trimmed at CLI and HTTP boundaries

## Review Comment

Branch input is only meaningfully validated in the web form, which trims and
drops a blank value (`StartRunForm.tsx`: `const trimmedBranch = branch.trim()`).
The other two entry points let degenerate branch names through:

- **HTTP** (`schema.ts:97`): `branch: z.string().min(1).optional()` accepts a
  whitespace-only value like `" "` because `min(1)` counts the space.
- **CLI** (`cli.ts:76`): `--branch " "` is accepted — the only check is that the
  value does not start with `-`.

A whitespace-only (or otherwise odd) branch then flows into `RunManager`:

- `sanitizeBranch` is applied **only to the worktree path segment**, while the
  **raw** branch string is passed to git (`addWorktree` uses `branch` verbatim:
  `["worktree", "add", "-b", branch, worktreePath]`).
- `sanitizeBranch(" ")` collapses to `""`, so the computed path becomes
  `"<repo>-"` (e.g. `/work/app-`), and any branch that sanitizes to empty
  (`"//"`, `"   "`) produces the same colliding `app-` directory.
- `git worktree add -b " " ...` fails with a git ref-name error that
  `normalizeAddWorktreeError` does not recognize, so it rethrows un-normalized →
  generic 500 (see also issue 002), rather than a clear 400.

Net effect: invalid branch input yields confusing 500s and/or malformed worktree
paths instead of a clean rejection at the boundary.

Suggested fix: normalize and validate the branch where it enters the system —
trim and reject empty in `StartRunRequestSchema` (e.g.
`z.string().trim().min(1).optional()`) and in `parseStartArgs`. Optionally guard
in `RunManager` that the sanitized segment is non-empty before computing the
path, returning a stable error instead of producing `"<repo>-"`.

## Triage

- Decision: `VALID`
- Root cause: At the HTTP boundary (`src/app/api/schema.ts:97`),
  `branch: z.string().min(1).optional()` treats a whitespace-only string such as
  `" "` as valid because `min(1)` counts the space character. The degenerate
  branch then flows into `RunManager`, where `sanitizeBranch(" ")` collapses to
  `""` (producing a colliding `"<repo>-"` worktree path) and the raw value is
  passed verbatim to `git worktree add -b`, yielding a confusing 500 instead of a
  clean 400 rejection.
- Fix: Changed the HTTP schema to `branch: z.string().trim().min(1).optional()`.
  Zod's `.trim()` normalizes the value before the `.min(1)` length check, so a
  whitespace-only branch is rejected at the boundary and a branch with incidental
  surrounding whitespace is normalized (e.g. `"  feature/iso  "` → `"feature/iso"`).
- Scope note: This batch's scope is limited to `src/app/api/schema.ts`. The
  related CLI boundary (`cli.ts:76`/`parseStartArgs`) and the `RunManager`
  empty-sanitized-segment guard called out in the review live in files outside
  this batch and are intentionally left untouched here; the HTTP-boundary fix is
  the portion that maps to the filed file/line.
- Tests: Added `StartRunRequestSchema` cases in `schema.test.ts` for rejecting a
  whitespace-only branch and for trimming surrounding whitespace. The existing
  empty-string-branch rejection still holds.
