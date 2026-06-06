---
provider: manual
pr:
round: 1
round_created_at: 2026-06-05T13:25:26Z
status: resolved
file: src/app/api/routes/workflow-crud.ts
line: 39
severity: low
author: claude-code
provider_ref:
---

# Issue 003: Path-containment check hard-codes "/", not OS-portable

## Review Comment

`resolveWorkflowFile` is the defense-in-depth containment check for the
filesystem CRUD surface (TechSpec "Path traversal" known risk):

```ts
const file = join(dir, `${name}.json`);
if (!file.startsWith(dir + "/")) {
  throw new Error(`Unsafe workflow name: ${name}`);
}
```

`join` produces OS-native separators (`\` on Windows), but the guard compares
against `dir + "/"`. On Windows this check would fail for *every* valid name,
breaking all CRUD operations; the comparison is only correct on POSIX. It is
also a raw prefix check rather than a resolved-path containment check.

In practice this is currently dead defense: `WorkflowNameParamSchema` already
rejects `/`, `\`, and `..` before the handler runs, so the branch can't be
reached today, and the project targets Linux/macOS (bun). Hence low severity —
but the guard is presented as the path-safety backstop, so it should actually
hold on every platform it claims to.

Suggested fix: use `path.sep` (or `path.relative(dir, file)` and reject results
that start with `..` or are absolute) instead of a hard-coded `"/"`, and throw a
mapped error rather than a bare `Error` (which would become a 500 if ever hit).

## Triage

- Decision: `VALID`
- Root cause: `resolveWorkflowFile` builds the file path with `join`, which
  emits OS-native separators (`\` on Windows), then compares against a
  hard-coded `dir + "/"`. On Windows the comparison fails for every valid name,
  and even on POSIX it is a raw prefix check rather than a true containment
  check. It also throws a bare `Error`, which `mapError` would surface as a 500.
- Reachability confirmed: `WorkflowNameParamSchema` (`src/app/api/schema.ts`)
  refines out `/`, `\`, and `..`, and both the `:name` param and the POST/PUT
  body `name` reuse it. So the guard is currently unreachable through the HTTP
  surface (the 400s in the path-traversal tests come from Zod validation, not
  this guard). Hence low severity / dead defense — but the guard is documented
  as the path-safety backstop, so it must actually hold on every platform.
- Fix approach: replace the literal `"/"` prefix check with an OS-portable
  containment check using `path.relative` + `isAbsolute` + `path.sep` (reject
  results that escape via `..`, are absolute, or contain a separator), and
  throw a typed `WorkflowConfigError` instead of a bare `Error`. `WorkflowConfigError`
  is mapped to `400 WORKFLOW_INVALID` by `mapError`, so the guard degrades to a
  client error rather than a 500 if it is ever reached (e.g. if the schema is
  loosened in the future).
- Scope note: kept changes within `src/app/api/routes/workflow-crud.ts` plus its
  co-located test file. No handler-level `try/catch` was added because the guard
  is provably unreachable today; wrapping five dead-code call sites (or adding a
  global `onError` in the out-of-scope `app.ts`) would be disproportionate for a
  low-severity defense-in-depth path. The typed error ensures correct mapping
  wherever `mapError` is applied.
