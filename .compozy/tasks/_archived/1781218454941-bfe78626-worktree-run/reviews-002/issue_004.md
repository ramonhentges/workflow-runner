---
provider: manual
pr:
round: 2
round_created_at: 2026-06-11T18:25:47Z
status: resolved
file: web/src/features/workflows/WorkflowList.tsx
line: 57
severity: medium
author: claude-code
provider_ref:
---

# Issue 004: Workflow-list "Run" starts a non-isolated run with no branch prompt

## Review Comment

The web UI has two run entry points, and only one of them can request isolation:

- `StartRunForm` (the dedicated start flow) has a branch input and forwards it
  (`StartRunForm.tsx:73-78`).
- The **workflow list** "Run" button starts a run inline with no branch and no
  prompt:

  ```ts
  // WorkflowList.tsx:54-58
  const startMutation = useMutation({
    mutationFn: (workflow: WorkflowItem) => {
      if (!activeCwd) throw new Error('No active working directory selected.')
      return startRun({ workflowPath: workflow.path, cwd: activeCwd.path }) // ← no branch
    },
    ...
  ```

  Clicking ▶ Run (`WorkflowList.tsx:202-213`) immediately fires
  `startMutation.mutate(workflow)` and navigates to the run — there is no modal
  or branch field, so a run launched from the list is *always* non-isolated.

This is a gap against PRD *Core Feature #1*: "Available from both entry points"
and the *User Experience* note that "the start flow offers an isolation choice
and a branch-name field." A user browsing the workflow list — the most natural
place to launch a workflow — has no way to opt into a worktree run; they must
know to detour to the separate start form. The isolation option is effectively
hidden from the primary launch surface, which also works against the PRD's
*Adoption / Discoverability* goals.

Suggested fix: make the list "Run" action open a small dialog (shadcn `dialog`)
with an optional branch input mirroring `StartRunForm`'s field — trim the value,
treat blank as a normal run, and pass `branch` through to `startRun` only when
non-empty. (Reuse the same `trimmedBranch ? { branch } : {}` shaping so the
non-isolated path is byte-for-byte unchanged.) Alternatively, route the Run
button to the existing start form pre-filled with the selected workflow rather
than starting inline. Add a `WorkflowList` test asserting the dialog appears and
that a supplied branch is forwarded to `startRun`, plus that leaving it blank
starts a non-isolated run.

## Triage

- Decision: `VALID`
- Root cause: `WorkflowList`'s per-row "Run" button (`WorkflowList.tsx:200-213`)
  calls `startMutation.mutate(workflow)` immediately, and the mutation's
  `mutationFn` (`WorkflowList.tsx:54-58`) hard-codes `startRun({ workflowPath,
  cwd })` with no `branch`. A run launched from the list is therefore always
  non-isolated, with no way to opt into a worktree run. This contradicts PRD
  *Core Feature #1* ("Available from both entry points") — only `StartRunForm`
  exposes the branch field — and undermines the *Adoption / Discoverability*
  goal, since the list is the most natural launch surface.
- Fix approach: make the row "Run" button open a controlled shadcn `Dialog`
  (already present at `web/src/components/ui/dialog.tsx`) holding an optional
  branch `Input`. On submit, reuse `StartRunForm`'s exact request shaping —
  `...(trimmedBranch ? { branch: trimmedBranch } : {})` — so the blank-branch
  (non-isolated) path produces a byte-for-byte identical request body. The
  per-row immediate-start path (and its `startingKey` row state) is replaced by
  the dialog's submit button; the start error now renders inside the dialog.
- Tests: update the two run-flow tests that clicked Run expecting an immediate
  start to instead open the dialog and submit; add tests asserting the dialog
  appears, that a supplied branch is forwarded to `startRun`, and that a blank
  branch starts a non-isolated run (unchanged body).
