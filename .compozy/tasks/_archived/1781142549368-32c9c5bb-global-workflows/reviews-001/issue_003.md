---
provider: manual
pr:
round: 1
round_created_at: 2026-06-10T20:35:32Z
status: resolved
file: web/src/lib/api/types.ts
line: 103
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Web WorkflowDoc/WorkflowDeleteResult types omit server `scope`

## Review Comment

The server now returns `scope` on the single-workflow document and the delete
result (`schema.ts:174-180` `WorkflowDocSchema`, and the DELETE response
`{ deleted, scope }` at `workflow-crud.ts:392`). The mirrored web types do not
model it:

- `web/src/lib/api/types.ts:103-107` `WorkflowDoc` lacks `scope`.
- `web/src/lib/api/types.ts:119-121` `WorkflowDeleteResult` lacks `scope`.

The TechSpec states "responses carry the resolved `scope`," so the web contract
has drifted from the server. It is currently harmless because the edit flow
derives scope from the route search param rather than from the fetched document,
but the omission means the authoritative server-resolved scope is silently
dropped, and a future consumer that trusts the type would not see the field.

Suggested fix: add `scope: WorkflowScope` to `WorkflowDoc` and
`scope: WorkflowScope` to `WorkflowDeleteResult` to keep the web types aligned
with `schema.ts`.

## Triage

- Decision: `VALID`
- Notes:
  - Confirmed against the server source of truth:
    - `src/app/api/schema.ts` `WorkflowDocSchema` (lines 174-180) includes
      `scope: WorkflowScopeSchema`, returned from `GET /workflows/:name`.
    - `src/app/api/routes/workflow-crud.ts:220` declares the DELETE response
      schema as `z.object({ deleted: z.string(), scope: WorkflowScopeSchema })`,
      and `:392` returns `{ deleted: name, scope: target.scope }`.
  - The mirrored web wire types in `web/src/lib/api/types.ts` omit `scope` on
    both `WorkflowDoc` (lines 103-107) and `WorkflowDeleteResult` (lines
    119-121), so the web contract has drifted from the server. `WorkflowScope`
    is already declared in the same file (line 91), so the fix only needs to add
    the field to both interfaces.
  - Root cause: the two interfaces were not updated when the server added the
    resolved `scope` field to the document and delete responses (ADR-003).
  - Fix approach: add `scope: WorkflowScope` to `WorkflowDoc` and
    `WorkflowDeleteResult` to realign the web types with `schema.ts`.

## Resolution

- `web/src/lib/api/types.ts`: added the required `scope: WorkflowScope` field to
  both `WorkflowDoc` (line 106) and `WorkflowDeleteResult` (line 122), aligning
  the mirrored web wire types with the server's `WorkflowDocSchema` and the
  DELETE `{ deleted, scope }` response.
- Making `scope` required surfaced existing test fixtures that constructed
  `WorkflowDoc` literals without it. These test files were not in `<batch_scope>`
  code files, but updating them is required for the type change to typecheck —
  test edits that validate the fix are in scope:
  - `web/src/lib/api/client.test.ts`: added `scope` to the create-handler doc
    fixture and updated the `deleteWorkflow` test to mock and assert
    `{ deleted, scope }`, exercising the new `WorkflowDeleteResult.scope` field.
  - `web/src/features/workflows/WorkflowDraftSchema.test.ts`: added `scope` to
    `sampleDoc` and the two inline `doc` fixtures.
  - `web/src/features/workflows/WorkflowEditor.test.tsx`: added `scope` to the
    seven `WorkflowDoc` fixtures (`'global'` for the global-scoped `globalDoc`,
    `'project'` for the rest).
- Verification (web workspace, after all changes):
  - `bun run typecheck` → exit 0, no errors.
  - `bun run test` → 28 files / 440 tests passed.
