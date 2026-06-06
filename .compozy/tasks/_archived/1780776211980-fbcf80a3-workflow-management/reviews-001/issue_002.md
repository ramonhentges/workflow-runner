---
provider: manual
pr:
round: 1
round_created_at: 2026-06-05T13:25:26Z
status: resolved
file: src/app/api/routes/workflow-crud.ts
line: 203
severity: medium
author: claude-code
provider_ref:
---

# Issue 002: GET /workflows/:name returns 500 on a malformed JSON file

## Review Comment

In the read-one handler, after successfully reading the file the body is parsed
with an unguarded `JSON.parse`:

```ts
const content = await fs.readFile(file, "utf-8");
...
const workflow = JSON.parse(content) as unknown; // line 203
return c.json({ name, path: file, workflow }, 200);
```

If the file on disk is not valid JSON, `JSON.parse` throws and the error
propagates out of the handler as an unhandled exception → HTTP 500
`INTERNAL_ERROR` with no actionable code. This is a realistic case for this
feature specifically: the whole point is to *replace* hand-editing, so the
editor will routinely open files that may have been hand-edited badly or
truncated by a crashed external write. A 500 also surfaces in the web editor's
`EditWorkflowPage` as the generic "Workflow not found." fallback
(`router.tsx`), which is misleading — the file exists, it just won't parse.

Note the asymmetry: the list route (`workflows.ts`) carefully maps `ENOENT`/
`ENOTDIR`/`EACCES`, but the read-one path has no equivalent guard for parse
failure.

Suggested fix: wrap `JSON.parse` in a try/catch and return a clear 4xx (e.g.
`400 WORKFLOW_INVALID` or a dedicated `WORKFLOW_MALFORMED`) with the parse
message, so the editor can show a meaningful error instead of a 500.

## Triage

- Decision: `VALID`
- Root cause: In the `GET /workflows/:name` handler (`workflow-crud.ts:203`),
  `JSON.parse(content)` runs without a try/catch. The handler carefully maps
  `ENOENT` from `fs.readFile` to a 404, but a parse failure on an
  on-disk-but-malformed file propagates as an unhandled exception, which Hono's
  default error handling turns into `500 INTERNAL_ERROR`. This is a realistic
  case for this feature: the editor exists to replace hand-editing, so it will
  routinely open files that may have been hand-edited badly or truncated by a
  crashed external write. The 500 also surfaces in the web editor as the
  misleading generic "Workflow not found." fallback even though the file exists.
- Fix approach: Wrap `JSON.parse` in a try/catch and return a clear `400`
  with a dedicated `WORKFLOW_MALFORMED` code and the parse message. A dedicated
  code (rather than reusing `WORKFLOW_INVALID`, which is for schema-validation
  failures via `Workflow.fromJson`) keeps the distinction between "file is not
  valid JSON" and "JSON is valid but not a valid workflow". The route's existing
  OpenAPI `400` response (`ApiErrorSchema { code, message }`) already covers the
  new branch, so no route-shape change is needed.
- Tests: Added a unit test that writes a malformed JSON file and asserts the
  read-one handler returns `400` with code `WORKFLOW_MALFORMED`.
- Notes: Fix is confined to the in-scope file `src/app/api/routes/workflow-crud.ts`
  plus its co-located test.
