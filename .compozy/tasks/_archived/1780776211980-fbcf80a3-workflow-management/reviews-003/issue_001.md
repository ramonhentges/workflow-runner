---
provider: manual
pr:
round: 3
round_created_at: 2026-06-05T14:05:49Z
status: resolved
file: web/src/features/workflows/StepFields.tsx
line: 108
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Step IDE `<select>` cannot represent an out-of-catalog ide on edit

## Review Comment

The step IDE field is a native `<select>` whose options are hard-coded to the
four built-in profiles:

```tsx
const SUPPORTED_IDES = ['opencode', 'claude-code', 'codex', 'gemini'] as const
// ...
<select id={`step-ide-${stepIndex}`} {...register(`steps.${stepIndex}.ide`)} ...>
  {SUPPORTED_IDES.map(ide => (
    <option key={ide} value={ide}>{ide}</option>
  ))}
</select>
```

The editor's stated purpose (PRD Overview, Core Feature #6 "Edit workflow …
change anything … and save") is to faithfully round-trip existing workflow
files — including ones that were hand-authored. The domain layer deliberately
accepts **any** non-empty string for `ide` (`src/domain/workflow.ts:152`:
`typeof s.ide === "string" && s.ide.trim() !== ""`), and CLAUDE.md documents
that an unrecognized `ide` "is not rejected at load time; it fails at the step
when the runner tries to dispatch it, preserving earlier steps' work". So a
workflow whose step has an `ide` outside the four built-ins is valid on disk and
runnable up to that step.

When such a file is opened in the editor, the native `<select>` has no `<option>`
matching the loaded value. The browser renders the select with no/first-option
selected, so the field **misrepresents the persisted `ide`** (the UI implies a
different IDE than what is saved). Two concrete consequences:

1. `useIdeCatalog(currentIde)` watches this field, so the catalog probe is
   issued for the unknown ide and the route returns `400 UNKNOWN_IDE`
   (`src/app/api/routes/ide-catalog.ts:54`) — the picker silently shows no
   suggestions and no status.
2. The moment the author touches the select (or it is otherwise changed), the
   real persisted ide is overwritten with a built-in value and saved, silently
   mutating the workflow. (A strictly untouched save preserves the value via
   react-hook-form's internal store, so this is misrepresentation + a
   one-interaction footgun rather than guaranteed silent loss — but for an
   editor that claims to faithfully edit, displaying a value the file does not
   contain is itself a correctness defect.)

Suggested fix: when the current `ide` value is not in `SUPPORTED_IDES`, render
an extra `<option value={currentIde}>` (e.g. labelled `{currentIde} (custom)`)
so the select faithfully shows and round-trips the persisted value. A
free-text/combobox affordance (mirroring `AgentModelPicker`) would also satisfy
this; either way the editor must not drop or misrepresent an ide it loaded. Add
an edit-mode test that loads a step with an unsupported `ide` and asserts the
value survives an untouched save.

## Triage

- Decision: `VALID`
- Notes:

The defect is real. `StepFields.tsx` renders the IDE field as a native
`<select>` whose `<option>` set is hard-coded to the four built-in profiles
(`SUPPORTED_IDES`). The domain layer (`src/domain/workflow.ts:152`) accepts any
non-empty string for `ide`, and the draft schema
(`web/src/features/workflows/WorkflowDraftSchema.ts`) mirrors that with
`z.string().min(1)`. So a workflow with an out-of-catalog `ide` is valid on disk
and round-trips into the form's RHF store, but the `<select>` has no matching
`<option>`. The browser then displays the first option (`opencode`) while the
RHF store still holds the real value — a misrepresentation, and a one-interaction
footgun: changing the select overwrites the persisted ide with a built-in.

Root cause: the option set is static and ignores the currently-loaded value.

Fix approach (matches the reviewer's first suggestion, minimal and constrained to
the in-scope file): when `currentIde` is non-empty and not one of
`SUPPORTED_IDES`, render an extra `<option value={currentIde}>` labelled
`{currentIde} (custom)` so the select faithfully shows and round-trips the
persisted value. Added an edit-mode test asserting an unsupported `ide` survives
an untouched save (PUT body preserves the value) and that the custom option is
rendered selected.
