---
provider: manual
pr:
round: 1
round_created_at: 2026-06-10T20:35:32Z
status: pending
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

- Decision: `UNREVIEWED`
- Notes:
