---
provider: manual
pr:
round: 1
round_created_at: 2026-06-08T13:21:13Z
status: resolved
file: web/src/features/workflows/EdgesField.tsx
line: 73
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: EdgesField next_step left as native select — dropdown seam

## Review Comment

The edge `next_step` control in `EdgesField` is still a native `<select>` with a
hand-copied class string (EdgesField.tsx:73-88), while the sibling step
dropdowns (`ide`, `mode`) in `StepFields` were migrated to the shadcn `Select`
via `Controller` per ADR-005. ADR-005's title is "Adopt the Radix-backed shadcn
Select for **all dropdowns**," and its Consequences claim it "eliminates the
last native-control visual seam in the forms." This native select is exactly the
half-migrated seam the PRD set out to remove (PRD goal: "no half-migrated seam
remains"), and it visually/behaviourally diverges from the migrated selects
(native popup + raw classes vs. Radix listbox).

Note the ambiguity for triage: ADR-005's Context/Decision body enumerated only
three native selects (the workflow picker, step `ide`, step `mode`) and did not
list the edges `next_step` field — which predates this effort (the diff barely
touches `EdgesField.tsx`). So this may be an ADR-scope oversight rather than a
missed task. Either way the stated "all dropdowns" outcome is not met.

Suggested fix: migrate the `next_step` field to the shadcn `Select` via a
react-hook-form `Controller`, mirroring `StepFields` (preserving the
`edge-next-step-input-${stepIndex}-${edgeIndex}` testid on the trigger and the
dangling-reference "(missing)" option round-trip). If the exclusion is
intentional, record it explicitly in ADR-005 so the seam is a documented
decision rather than a silent gap.

## Triage

- Decision: `VALID`
- Root cause: `EdgesField.tsx:73-88` renders the edge `next_step` control as a
  native `<select>` with a hand-copied class string, whereas the sibling step
  dropdowns (`ide`, `mode`) in `StepFields.tsx` were migrated to the
  Radix-backed shadcn `Select` via react-hook-form `Controller` per ADR-005.
  ADR-005's stated outcome is "Adopt the Radix-backed shadcn Select for **all
  dropdowns**" and "eliminates the last native-control visual seam in the
  forms." This native select is that remaining seam: it renders a native popup
  + raw classes instead of the Radix listbox, diverging visually and
  behaviourally from the migrated selects and violating the PRD goal that "no
  half-migrated seam remains." The ADR body enumerated only three native
  selects and omitted this field, but the explicit "all dropdowns" decision
  governs; the omission is an ADR-scope oversight, not an intentional
  exclusion, so the correct resolution is to migrate the field (not to record
  an exception).
- Fix approach: replace the native `<select>` with the shadcn `Select`
  (`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`) wrapped in a
  react-hook-form `Controller`, mirroring `StepFields`. Preserve the
  `edge-next-step-input-${stepIndex}-${edgeIndex}` testid and the
  `edge-next-${stepIndex}-${edgeIndex}` id on the `SelectTrigger`, keep the
  dangling-reference "(missing)" option so a value pointing at a removed/renamed
  step still round-trips and stays flagged by validation, and surface the empty
  state via a "Select a step" placeholder (Radix forbids an empty-string
  `SelectItem`). Update the three affected tests to drive the Radix Select
  (trigger click → option click / `role="option"`) instead of native
  `selectOptions`/`HTMLSelectElement`, reusing the pointer-API shims already in
  `test/setup.ts`.
