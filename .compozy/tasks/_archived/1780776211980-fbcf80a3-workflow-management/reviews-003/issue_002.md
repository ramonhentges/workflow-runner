---
provider: manual
pr:
round: 3
round_created_at: 2026-06-05T14:05:49Z
status: resolved
file: web/src/features/workflows/WorkflowDraftSchema.ts
line: 77
severity: low
author: claude-code
provider_ref:
---

# Issue 002: "Duplicate" copies the workflow's internal id/name verbatim

## Review Comment

The duplicate flow (PRD Core Feature #2 / MVP "Create … duplicate") clears only
the file name when prefilling from a source workflow:

```ts
// router.tsx NewWorkflowPage
const initialValues =
  from && sourceDoc ? workflowDocToFormData(sourceDoc, '') : undefined
```

`workflowDocToFormData(doc, '')` (`WorkflowDraftSchema.ts:77`) blanks
`fileName` but copies `workflowId` (`wf.id`) and `workflowName` (`wf.name`)
straight from the source. The resulting duplicate is therefore saved under a new
file name but with the **same internal `id` and `name`** as the original, so the
project ends up with two distinct files that share one workflow identity.

This is the foreseeable footgun behind the PRD's own Open Question ("how should
id collisions within a project be presented?"). User-facing impact today is
limited because the list keys on the bare file name
(`workflowNames.ts` → `workflowDisplayName` = file name), so the collision is
invisible in the UI and the runner addresses workflows by path; hence low
severity. But the whole point of "duplicate to start from a baseline" is that
the author then edits — and an unchanged duplicate silently produces two
identical-id workflows, exactly the kind of subtle data issue the editor is
meant to prevent.

Suggested fix: when prefilling from a source (duplicate mode), clear or
suffix the identity fields so the author is nudged to give the copy its own
identity — e.g. blank `workflowId`, or set `workflowName`/`workflowId` to
`"<source> copy"`. Keep this scoped to the duplicate path so plain edit still
round-trips identity unchanged. Add a test asserting the duplicated draft does
not carry the source's `id` verbatim. (If the team prefers to defer per the PRD
Open Question, capture that decision explicitly rather than shipping a silent
verbatim copy.)

## Triage

- Decision: `VALID`
- Root cause: `workflowDocToFormData(doc, overrideFileName?)` only blanks
  `fileName` (via `overrideFileName`) and otherwise copies `wf.id` →
  `workflowId` and `wf.name` → `workflowName` verbatim. The duplicate flow
  (`router.tsx` `NewWorkflowPage`) calls it as
  `workflowDocToFormData(sourceDoc, '')`, so a duplicate saved without edits
  carries the **source's internal `id` and `name`**. The domain
  (`src/domain/workflow.ts:118-124`) defaults `id`/`name` to `""` with no
  uniqueness check, so two files sharing one identity persist silently — the
  exact "subtle data issue the editor is meant to prevent" the comment cites.
- Fix approach: the router already encodes "duplicate" as an **empty**
  `overrideFileName` (blanking the file name forces the author to pick a new
  one). I scope an identity nudge to exactly that signal: when
  `overrideFileName === ''` (duplicate mode), suffix non-empty `workflowId`
  and `workflowName` with `" copy"` so the copy gets its own distinct identity
  even if saved unedited. Plain edit (`overrideFileName === undefined`) and
  explicit rename (non-empty `overrideFileName`) still round-trip identity
  unchanged. This keeps the change entirely within the scoped file
  `WorkflowDraftSchema.ts` (+ its tests); `router.tsx` is untouched.
- Notes: Chose suffixing over blanking because the domain permits empty
  `id`/`name`, so blanking would still allow a save that produces an
  empty-identity workflow; suffixing guarantees a distinct, non-empty identity
  while remaining an obvious nudge to rename.
