---
provider: manual
pr:
round: 3
round_created_at: 2026-06-05T14:05:49Z
status: resolved
file: web/src/features/workflows/EdgesField.tsx
line: 53
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Edge "Next step ID" is free text, should be a step-id dropdown

## Review Comment

The edge target ("Next step ID") is a free-text `<input>`:

```tsx
<Input
  id={`edge-next-${stepIndex}-${edgeIndex}`}
  {...register(`steps.${stepIndex}.edges.${edgeIndex}.next_step`)}
  placeholder="target-step-id"
  data-testid={`edge-next-step-input-${stepIndex}-${edgeIndex}`}
/>
```

A handoff edge can only ever point at an existing step id — both the web schema
(`WorkflowDraftSchema.ts` superRefine: "No step with id …") and the domain
(`src/domain/workflow.ts:189`: `edge.next_step` must reference an existing step
id) reject any other value. So the set of valid `next_step` values is exactly
the workflow's current step ids, which the form already knows. Asking the author
to retype an id by hand invites typos that are only caught after submit as a
validation error, working against the PRD's "define handoff edges … so
interactive steps can hand off correctly" (Core Feature #3) and "inline,
specific feedback before save" (Core Feature #5) goals — and it is inconsistent
with the IDE/mode fields, which are already constrained `<select>`s.

Suggested fix: replace the free-text input with a `<select>` populated from the
sibling step ids. `EdgesField` can read the live step list via the form context
(`useWatch({ control, name: 'steps' })`) and render an `<option>` per
non-empty step id (optionally excluding the current step to discourage trivial
self-loops, and including a blank "select a step" placeholder). To preserve
fidelity when editing a workflow whose edge references an id that no longer
exists (e.g. after a step was renamed/removed), keep the dangling value
selectable as an extra option so the existing validation can flag it rather than
silently dropping it. Add a test asserting the dropdown lists the current step
ids and that selecting one sets `next_step`.

## Triage

- Decision: `VALID`
- Root cause: `EdgesField` renders `next_step` as a free-text `<Input>`
  (`web/src/features/workflows/EdgesField.tsx:53`). The set of valid `next_step`
  values is provably closed: both the web schema (`WorkflowDraftSchema`
  superRefine "No step with id …") and the domain (`src/domain/workflow.ts`)
  reject any value that is not an existing step id. Free text therefore only
  invites typos that surface as post-submit validation errors, and is
  inconsistent with the IDE/mode fields, which are constrained `<select>`s.
- Fix approach: replace the free-text input with a native `<select>` (mirroring
  the IDE select in `StepFields.tsx`, including its `register(...)` wiring and
  styling). Populate options from the live step list via
  `useWatch({ control, name: 'steps' })`, listing every non-empty sibling step
  id and excluding the current step to discourage trivial self-loops. Include a
  blank "Select a step" placeholder. To preserve fidelity when editing a
  workflow whose edge references an id that no longer exists (or a pre-existing
  self-loop), keep the current value selectable as an extra "(missing)" option
  when it is not already in the list so the existing validation can still flag
  it instead of silently dropping it.
- Tests: update the existing "edge with next_step matching no step" test to
  exercise the dangling-value path via `initialValues` (a select cannot type an
  arbitrary value), and add coverage asserting the dropdown lists the current
  sibling step ids and that selecting one sets `next_step`.
