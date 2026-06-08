---
provider: manual
pr:
round: 1
round_created_at: 2026-06-08T13:21:13Z
status: resolved
file: web/src/features/workflows/WorkflowList.tsx
line: 22
severity: medium
author: claude-code
provider_ref:
---

# Issue 003: Link-as-button styling duplicated as raw class strings

## Review Comment

The Button primitive (`web/src/components/ui/button.tsx`) is a hand-rolled
component that neither exports a `buttonVariants` helper nor supports `asChild`
(Radix `Slot`). Because of that, every place that needs a `Link` styled as a
button copies the button class list by hand:

- `actionLinkClass` in WorkflowList.tsx:22, reused on the New / Edit / Duplicate
  / Create-first links.
- the inline `start-run-action` class string in RunsTable.tsx:106.

These hand-copied strings (border/bg/hover/focus/height/padding tokens) are a
parallel re-implementation of `Button`'s styling and will silently drift from it
whenever the button design changes — the exact "ad-hoc, inconsistent styling"
the PRD's whole-app-consistency goal aims to remove.

Suggested fix: make `Button` canonical — extract its class logic into a CVA
`buttonVariants({ variant, size })` export (and/or add `asChild` via
`@radix-ui/react-slot`). Then style the links with
`className={buttonVariants({ variant: 'outline', size: 'sm' })}` (or
`<Button asChild><Link/></Button>`) so there is a single source of truth for
button appearance. This is one issue covering both WorkflowList.tsx and
RunsTable.tsx since they share the same root cause.

## Triage

- Decision: `VALID`
- Root cause: `web/src/components/ui/button.tsx` was the lone hand-rolled UI primitive
  (conditional `&&` class concatenation, `forwardRef`, no CVA, no `asChild`). Every
  sibling primitive in `web/src/components/ui/` (e.g. `badge.tsx`, `alert.tsx`,
  `sidebar.tsx`) already follows the canonical shadcn pattern: a `cva` `*Variants`
  export plus React-19 `Slot.Root` `asChild`. Because `Button` exported neither a
  `buttonVariants` helper nor `asChild`, any link-as-button had to re-implement the
  button class list by hand — `actionLinkClass` in `WorkflowList.tsx:22` was an exact
  copy of the `outline` + `sm` token set. This parallel string drifts from `Button`
  whenever the button design changes, which is the inconsistency the PRD targets.
- Fix:
  1. Made `Button` canonical (matching `badge.tsx`): extracted its classes into a
     `cva` `buttonVariants({ variant, size })` export and added `asChild` via
     `Slot.Root`. Class tokens for every existing variant/size are byte-for-byte
     preserved, so no current `Button` usage changes visually. Switched from
     `forwardRef` to the React-19 function-component form used by the sibling
     primitives; refs still flow through `{...props}` (verified the
     `DropdownMenuTrigger asChild` usage in `mode-toggle.tsx` keeps working).
  2. In `WorkflowList.tsx` removed `actionLinkClass` and rendered every styled link
     as `<Button asChild variant="outline" size="sm"><Link/></Button>`, giving a
     single source of truth for the New / Edit / Duplicate / Create-first links.
- Out-of-scope note: the root-cause fix necessarily touches
  `web/src/components/ui/button.tsx` (not in this batch's listed code files) because
  that is the only place a canonical `buttonVariants`/`asChild` can live; the change
  there is limited to the minimum needed and is behavior-preserving for existing
  callers. `RunsTable.tsx` (mentioned in the review as sharing the root cause) was
  intentionally left untouched — it is not in this batch's scope. The exported
  `buttonVariants`/`asChild` now make remediating it a one-line change.
- Tests: added `web/src/components/ui/button.test.tsx` (covers `buttonVariants`
  output, `asChild` link-as-button rendering, and className merge) and a
  `WorkflowList.test.tsx` regression asserting the action links carry the Button
  primitive's `data-slot="button"` + shared `outline`/`sm` classes rather than a
  hand-copied string.
