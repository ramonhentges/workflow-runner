---
provider: manual
pr:
round: 1
round_created_at: 2026-05-27T16:52:03Z
status: resolved
file: src/infra/client/spawn.ts
line: 4
severity: medium
author: claude-code
provider_ref:
---

# Issue 009: autoSpawnDaemon entry path does not survive the bundled build

## Review Comment

`daemonEntryPath` is derived from `new URL("../daemon/entry.ts", import.meta.url)`
and then passed as the first argv to `process.execPath`. This works under
`bun src/index.ts ...`, but the project's documented build target is
`bun build ./src/index.ts --outdir ./build --target=node` (see `package.json`
`build` script). The bundled output produces a single `build/index.js`; the
URL relative to that bundle is `build/../daemon/entry.ts`, which does not
exist on disk. Auto-spawn from the built binary fails with `ENOENT` on the
entry file, and the client then times out after 2 s with the generic
"daemon did not become reachable" message — exactly the diagnostic the PRD
calls out as "loud, actionable error" in F1.

Suggested fix: emit the daemon entry as a stable file (or as a second bundle)
in the build output, and resolve the spawn entry by looking next to the
running binary (`fileURLToPath(new URL("./daemon-entry.js", import.meta.url))`
on the bundled output) rather than relative to the source tree. Add a smoke
test that runs the bundled output and exercises auto-spawn.

## Triage

- Decision: `valid`
- Notes: The issue is confirmed. `daemonEntryPath` is resolved once at module load via `new URL("../daemon/entry.ts", import.meta.url)`. In development (`bun src/index.ts`) `import.meta.url` is `file://.../src/infra/client/spawn.ts`, so the relative path correctly reaches `src/infra/daemon/entry.ts`. In the bundled output (`build/index.js`), `import.meta.url` becomes `file://.../build/index.js`, so `../daemon/entry.ts` resolves to `daemon/entry.ts` one level above `build/` — which does not exist — causing `ENOENT` on auto-spawn.

  **Root cause**: single-file bundle collapses all source files, so the relative path assumption breaks.

  **Fix approach**:
  1. Update the `build` script in `package.json` to emit a second bundle `build/daemon-entry.js` from `src/infra/daemon/entry.ts`.
  2. In `spawn.ts`, replace the module-level constant with a `resolveDaemonEntry()` function that first checks for `./daemon-entry.js` next to the running module (bundle case) and falls back to `../daemon/entry.ts` (source case).
  3. Update `spawn.test.ts` first assertion to allow either extension, since the path will end in `.ts` under `bun test` but `.js` in a bundled environment.
