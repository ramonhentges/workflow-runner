---
provider: manual
pr:
round: 1
round_created_at: 2026-06-01T11:13:34Z
status: resolved
file: src/app/api/routes/workflows.ts
line: 43
severity: medium
author: claude-code
provider_ref:
---

# Issue 001: Invalid cwd yields unhandled 500 instead of 400

## Review Comment

The handler only special-cases `ENOENT` (missing `workflows` folder → empty
list) and re-throws everything else:

```ts
} catch (err) {
  if ((err as { code?: string }).code === "ENOENT") {
    return c.json({ workflows: [] }, 200);
  }
  throw err;
}
```

ADR-006 specifies a **400 for a missing/invalid `cwd`**, but several realistic
invalid-cwd cases never reach that contract:

- `cwd` points at a regular file → `join(resolve(cwd), "workflows")` →
  `readdirSync` throws `ENOTDIR`.
- `cwd` is an unreadable directory → `EACCES`.

Both are re-thrown and surface to the client as an unstructured Hono 500
(`{ code: "HTTP_ERROR" }` after the web client's fallback parsing), rather than
the documented 400 with a `{ code, message }` body. The "no traversal / invalid
cwd → 400" backend test described in the TechSpec does not cover these paths.

Suggested fix: treat `ENOTDIR` (and arguably `EACCES`) as a 400 invalid-cwd
response, and keep `ENOENT` as the empty-list case:

```ts
const code = (err as { code?: string }).code;
if (code === "ENOENT") return c.json({ workflows: [] }, 200);
if (code === "ENOTDIR" || code === "EACCES") {
  return c.json({ code: "INVALID_CWD", message: `Invalid cwd: ${cwd}` }, 400);
}
throw err;
```

Secondary (low) note in the same file: `readdirSync` is a blocking call inside
an async handler. For a single-user local daemon the impact is negligible, but
`await fs.promises.readdir(...)` avoids stalling the event loop and is a trivial
change.

## Triage

- Decision: `VALID`
- Root cause: The `catch` block in `registerWorkflowsRoute` only handles `ENOENT` (absent `workflows/` folder) and re-throws all other filesystem errors. When `cwd` points to a regular file, `readdirSync` on `<cwd>/workflows` throws `ENOTDIR`; when `workflows/` exists but is unreadable, it throws `EACCES`. Both propagate as unhandled 500s instead of the documented 400 `INVALID_CWD` response.
- Fix: Add `ENOTDIR` and `EACCES` to the catch block, returning `{ code: "INVALID_CWD", message: ... }` with status 400. Also switch `readdirSync` to `await fs.promises.readdir(...)` (secondary suggestion — avoids blocking the event loop) by making the handler `async`.
- Tests added: ENOTDIR case (file named `workflows` in cwd) and EACCES case (unreadable `workflows/` directory, skipped when process runs as root).
