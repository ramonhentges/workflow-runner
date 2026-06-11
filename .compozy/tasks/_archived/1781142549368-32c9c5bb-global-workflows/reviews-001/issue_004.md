---
provider: manual
pr:
round: 1
round_created_at: 2026-06-10T20:35:32Z
status: resolved
file: src/app/api/routes/workflows.ts
line: 70
severity: low
author: claude-code
provider_ref:
---

# Issue 004: Invalid project workflows dir hides global workflows in combined list

## Review Comment

ADR-003 and the TechSpec state that global items are "always included (they do
not depend on `cwd`)." In the list handler, an unreadable project workflows
directory aborts the whole response before the global portion is read:

- `workflows.ts:69-72` — if the project `readScopedWorkflows` returns
  `ok: false` (ENOTDIR/EACCES on `<cwd>/workflows`), the handler immediately
  returns `400 INVALID_CWD`.
- `workflows.ts:78-81` — the global read never runs, so global workflows
  disappear from the combined list whenever the project workflows path is a file
  or unreadable.

The inline comment frames this as "unchanged behavior," but the new product
requirement is a combined list where globals are independent of `cwd`; a
degenerate project directory state should not erase the user's global workflows.
This is an edge case (the project `workflows` path would have to be a file or
permission-denied), hence low severity, but it is a genuine spec-vs-impl
tension.

Suggested fix: read the global portion regardless, and either (a) return the
global-only list with the project error surfaced separately, or (b) keep the
400 only when `cwd` is supplied *and* the caller has no other recourse —
document the chosen behavior so it is intentional rather than incidental.

## Triage

- Decision: `VALID`
- Root cause: The list handler (`workflows.ts:67-74`) reads the project portion
  first and returns `400 INVALID_CWD` the moment `readScopedWorkflows` reports
  `ok: false` (ENOTDIR/EACCES on `<cwd>/workflows`). Because that early return
  happens *before* the global portion is read (`workflows.ts:78-81`), a
  degenerate project directory (the path is a file, or permission-denied) erases
  the user's global workflows from the combined list. The web client
  (`useWorkflowList` → `listWorkflows`) treats any non-2xx as a full query
  failure, so in that case the UI shows no workflows at all — directly
  contradicting ADR-003 / TechSpec "Global items are always included (they do not
  depend on `cwd`)."
- Fix (reviewer option (b)): Read the global portion first/unconditionally, then
  read the project portion. When the project portion fails:
  - if there are globals to show, return `200` with the **global-only** list —
    globals are never erased by a broken project dir; and
  - only when there are no globals to fall back to (the broken project dir is the
    *sole* possible content, "no other recourse") return `400 INVALID_CWD`.
  This honors the "globals always included" contract, preserves the documented
  `400 INVALID_CWD` signal for the genuinely degenerate case, and is fully
  contained to `src/app/api/routes/workflows.ts` (no schema/web/OpenAPI changes).
  The chosen behavior is documented inline in the handler and the route's `400`
  response description so it is intentional rather than incidental.
- Notes: Existing `400` tests populate no globals, so they still assert `400`
  unchanged; new tests cover "broken project dir + globals present → 200
  global-only".
