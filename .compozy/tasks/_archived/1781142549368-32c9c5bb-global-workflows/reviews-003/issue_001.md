---
provider: manual
pr:
round: 3
round_created_at: 2026-06-11T01:44:39Z
status: resolved
file: web/src/router.tsx
line: 120
severity: low
author: claude-code
provider_ref:
---

# Issue 001: Duplicating a global workflow defaults the copy to Project scope

## Review Comment

Duplicating a **global** workflow opens the create editor with the scope toggle
defaulted to **Project**, so the copy lands in the project's `workflows/`
directory unless the user remembers to flip the toggle back to Global. The
`scope` search param is threaded only far enough to fetch the *source* document,
never far enough to seed the *destination* scope.

Trace:

- `router.tsx:57-62` — the `/workflows/new` route's `validateSearch` parses
  `scope` (added in round-1 issue 001 so the duplicate reads the correct source
  document).
- `router.tsx:90-92` — `NewWorkflowPage` consumes `scope` and passes it to
  `useWorkflow(from, scope)` to fetch the source. Good so far.
- `router.tsx:120` — but the editor is rendered as
  `<WorkflowEditor mode="create" initialValues={initialValues} />` with **no**
  `scope` prop. Contrast `EditWorkflowPage` (`router.tsx:149`), which forwards
  `scope={scope}`.
- `WorkflowEditor.tsx:54` — in create mode the scope comes from
  `useState<WorkflowScope>('project')`, ignoring any source scope. So the toggle
  always starts at Project (confirmed by `WorkflowEditor.test.tsx:892` "the
  create form scope selector defaults to Project").

Result: "Duplicate" on a Global workflow silently proposes a Project copy. There
is no data-corruption risk — the POST still validates and a same-named project
file would 409 rather than overwrite the global source — but the default
contradicts the create/edit/duplicate **scope parity** that round-1 issue 001
set out to establish for global workflows, and works against the feature's core
"reuse a global definition" intent (a user duplicating a global workflow most
likely wants another global one).

Suggested fix: thread the duplicate source scope into the create toggle's
initial value. Pass `scope` from `NewWorkflowPage` into `<WorkflowEditor>` (e.g.
an `initialScope`/`scope` prop used only when `mode === 'create'`), and seed
`createScope` from it (`useState<WorkflowScope>(initialScope ?? 'project')`).
Plain "New workflow" links already pass `scope: 'project'`
(`WorkflowList.tsx:88,149`), so they keep the Project default; only the Duplicate
link (`WorkflowList.tsx:227`, which passes `scope: workflow.scope`) changes the
proposed default — to match the row the user duplicated. Cover with a routing
test asserting that duplicating a global row opens the create editor with the
Global toggle pre-selected.

## Triage

- Decision: `VALID`
- Root cause: `NewWorkflowPage` (`router.tsx`) parsed the `scope` search param and
  used it to fetch the *source* document via `useWorkflow(from, scope)`, but
  rendered `<WorkflowEditor mode="create" initialValues={...} />` without threading
  `scope` into the editor. In create mode `WorkflowEditor` seeded its scope toggle
  from `useState<WorkflowScope>('project')`, hard-coding Project regardless of the
  duplicated row's scope. So "Duplicate" on a Global workflow opened the create
  editor defaulted to Project, breaking the create/edit/duplicate scope parity
  established in round-1 issue 001.
- Fix approach:
  - `WorkflowEditor.tsx`: added an `initialScope?: WorkflowScope` prop (create-mode
    only) and seeded the toggle with `useState<WorkflowScope>(initialScope ?? 'project')`.
    Edit-mode behavior (`scope` shown read-only) is unchanged; plain creates with no
    `initialScope` still default to Project.
  - `router.tsx`: `NewWorkflowPage` now passes `initialScope={scope}` to
    `<WorkflowEditor mode="create" …>`. The Duplicate link already carries
    `scope: workflow.scope` (`WorkflowList.tsx:227`); the plain "New workflow" links
    pass `scope: 'project'` (`WorkflowList.tsx:88,149`), so their Project default is
    preserved.
- Out-of-scope file note: the batch lists only `web/src/router.tsx` as a code file,
  but the toggle's initial value lives in `web/src/features/workflows/WorkflowEditor.tsx`.
  The router cannot seed component-local state on its own, so the minimal edit there
  (one new optional prop + its `useState` seed) was required to complete the fix.
- Tests: added two `routing.test.tsx` cases — duplicating a global workflow
  pre-selects the Global toggle, and a plain create keeps the Project toggle
  selected. Existing `WorkflowEditor.test.tsx` "defaults to Project" case still holds
  (it renders without `initialScope`).
