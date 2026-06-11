---
provider: manual
pr:
round: 1
round_created_at: 2026-06-10T20:35:32Z
status: resolved
file: web/src/features/workflows/WorkflowList.tsx
line: 42
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: Delete/run row state keyed by bare name, not scope+name

## Review Comment

The combined list keys rows by `scope + name` (`WorkflowList.tsx:179`) precisely
because a global and a project workflow may share a bare name (PRD edge case:
"both shown and distinguished so that I can ... act on the right one"). But the
per-row *interaction* state is keyed by bare name only:

- `confirmingName` / `startingName` are single strings holding a `bareName`
  (`WorkflowList.tsx:42,44`).
- Per row: `isConfirming = confirmingName === bareName`,
  `isStarting = startMutation.isPending && startingName === bareName`,
  `isDeleting = deleteMutation.isPending && isConfirming` (`:173-175`).

When a global and a project workflow share a name, clicking Delete (or Run) on
one row sets the bare-name state, and **both** rows enter the confirming /
"Starting…" / "Deleting…" state simultaneously. The two scopes are no longer
visually distinguishable during the action — directly contradicting the
disambiguation the PRD requires for the collision case. (Data integrity is
preserved because each row's `deleteMutation.mutate` / `startMutation.mutate`
carries its own `workflow.scope`/`workflow.path`; the defect is the ambiguous
UI state, which invites acting on the wrong row.)

Suggested fix: key the interaction state by `scope + bareName` (or store the
`WorkflowItem` itself), e.g. `confirmingKey === `${workflow.scope}-${bareName}``,
matching the row `key`. Apply the same to `startingName`.

## Triage

- Decision: `VALID`
- Severity: medium
- Root cause: The row `key` and `data-testid` are derived from `scope + bareName`
  (`WorkflowList.tsx:179`), but the per-row interaction state — `confirmingName`
  and `startingName` — stores a bare `bareName` only (`:42,44`). The per-row
  predicates compare against that bare name (`isConfirming = confirmingName ===
  bareName`, `isStarting = startMutation.isPending && startingName === bareName`,
  `:173-175`). When a global and a project workflow share a bare name, the two
  rows compute the same predicate result, so confirming-delete / "Starting…" /
  "Deleting…" state lights up on **both** rows at once. Data integrity is intact
  (each row's `mutate` carries its own `scope`/`path`), but the ambiguous UI
  contradicts the PRD's collision-disambiguation requirement.
- Fix approach: Key the interaction state by the same composite the row `key`
  uses. Introduce a `rowKey = `${scope}-${bareName}`` per row, rename the two
  state slots to `confirmingKey` / `startingKey`, and compare/set against
  `rowKey`. This makes the active-row state unique per scope+name pair so only
  the clicked row enters the confirming/starting state.
- Tests: Add a regression test asserting that, for two same-named rows in
  different scopes, clicking Delete (and Run) on one row activates only that
  row's state and leaves the other row's actions in their default state.
