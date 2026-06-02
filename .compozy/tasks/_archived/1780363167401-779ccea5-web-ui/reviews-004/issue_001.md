---
provider: manual
pr:
round: 4
round_created_at: 2026-06-01T14:18:36Z
status: resolved
file: web/src/lib/ws/reducer.ts
line: 42
severity: high
author: claude-code
provider_ref:
---

# Issue 001: Step breadcrumb ignores snapshot.visitedStepIds, so only the current step shows

## Review Comment

When the user opens a run, the step-progress breadcrumb shows only the latest
(current) step, never the steps the run already passed through.

Root cause: the breadcrumb is derived exclusively from `banner` runner events,
and the `snapshot` frame's `visitedStepIds` is thrown away.

`reduceFrame` handles the snapshot frame by storing only `snapshot` and
`status`:

```ts
case 'snapshot':
  return { ...vm, snapshot: frame.snapshot, status: frame.snapshot.status }
```

`vm.steps` is only ever populated in the `banner` case
(`reducer.ts:77-92`), and `StepProgress` renders purely from `vm.steps`
(`StepProgress.tsx:13-35`). On an initial attach the client receives at most the
**current** step's `banner` (see the related server-side issue), so every step
the run already completed is invisible in the breadcrumb.

This contradicts the TechSpec, which explicitly specifies the source for step
progress (`_techspec.md:183`):

> **Step progress derived from `banner` events + `visitedStepIds`.** ... the MVP
> shows an ordered breadcrumb of entered steps with the current one active.

The data needed to fix this is already on the wire: the server sends
`visitedStepIds` in the snapshot frame (`ws-attach.ts:463`) and the client type
declares it (`types.ts:40` — `RunDetail.visitedStepIds: string[]`). It is simply
never consumed.

Suggested fix: in the `snapshot` case, seed `vm.steps` from
`frame.snapshot.visitedStepIds`, marking `currentStepId` active, before any
`banner` events arrive. Reconcile with the existing `banner` reducer so that:

- steps present in `visitedStepIds` but not yet seen via `banner` are rendered
  (inactive, in visit order);
- a later `banner` for an already-listed step flips `active` without
  duplicating it (the `banner` case already de-dupes by `id`);
- exactly one step is `active` at a time (the current step).

Because the `banner` case already upserts by `id` and clears `active` on all
other steps, merging the snapshot-seeded list is low-risk. Add a reducer test
that feeds a snapshot with `visitedStepIds: ['a','b','c']` and
`currentStepId: 'c'` and asserts the breadcrumb renders a, b, c with c active.

## Triage

- Decision: `valid`
- Notes: Confirmed. The `snapshot` case in `reduceFrame` (reducer.ts:42) spreads only `snapshot` and `status` from the frame, discarding `frame.snapshot.visitedStepIds` and `frame.snapshot.currentStepId`. The `vm.steps` array — which drives the breadcrumb — is only populated by `banner` events. On initial attach, previously-completed steps have no banner events, so the breadcrumb stays empty until the current step's banner arrives. `RunDetail.visitedStepIds: string[]` and `currentStepId: string | null` are already declared on the type and sent by the server. Fix: seed `vm.steps` in the `snapshot` case from `visitedStepIds`, marking the `currentStepId` entry active. The existing `banner` de-dupe logic (upsert-by-id) handles reconciliation correctly — a later banner for an already-listed step will find it via `exists` and flip `active` without adding a duplicate.
