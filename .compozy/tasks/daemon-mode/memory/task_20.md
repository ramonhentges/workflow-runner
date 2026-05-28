# Task Memory: task_20.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Final cleanup pass: ensure no legacy single-workflow foreground path remains in app/index entries, add a `bin` entry so `workflow-runner` is installable, and rewrite the user-facing docs (README + CLAUDE.md) so the daemon CLI is the only entry point.

## Important Decisions

- `bin` points at `./src/index.ts` (source-run via Bun) rather than `./build/index.js`. The project ships source-run today and the task spec lists this as the canonical option; users need Bun installed (documented in README Prerequisites).
- Shebang on `src/index.ts` changed from `#!/usr/bin/env node` to `#!/usr/bin/env -S bun run` so `bin` invocation works when the file is launched directly (Node cannot execute `.ts`).
- Removed `scripts.dev` entirely (was `bun src/index.ts`). The daemon-mode CLI takes a subcommand and a bare `bun src/index.ts` no longer represents a meaningful invocation. Users wanting source-run invoke `bun src/index.ts <subcommand>` directly, which is documented.
- Kept the "run the daemon process in the foreground" description on the `daemon` subcommand in `src/app/main.ts:21`. The word "foreground" there refers to running the daemon process attached to the current terminal (as opposed to the auto-spawned detached daemon) — not to the legacy single-workflow foreground path. Removing it would lose accurate documentation.

## Learnings

- `src/infra/daemon/run-manager.test.ts:744` ("100 concurrent startRun calls produce non-colliding ids") is flaky. The slug space is 200 adjectives × 200 animals = 40k; birthday-paradox collision over 100 picks ≈ 12%. Re-run on failure. A future fix would either bump wordlist sizes, lower the count, or accept N−1 unique slugs.
- The `bin`-via-`.ts` route works for `bun link` users but will not work via `npx` without Bun on PATH. Acceptable for V1 (single-user tool, Bun is already a prereq).

## Files / Surfaces

- `package.json` — added `bin: { "workflow-runner": "./src/index.ts" }`; removed `scripts.dev`.
- `src/index.ts` — shebang switched to `#!/usr/bin/env -S bun run`.
- `README.md` — rewrote Usage and E2E sections around `workflow-runner <subcommand>`; added CLI subcommand table and updated Architecture summary.
- `CLAUDE.md` — replaced Commands block with the daemon CLI surface; expanded App/Infra architecture notes to reflect commands/, daemon/, client/, and TUI refactor.
- Verified clean: `src/app/main.ts`, `src/app/cli.ts`, `src/index.ts` — no legacy foreground-workflow code paths.

## Errors / Corrections

- None during execution.

## Ready for Next Run

- Task spec Success Criteria says "No `bun src/index.ts <workflow.json>` examples remain anywhere in the repo (verified by grep)." Live remaining matches are all in `.compozy/tasks/_archived/` (historical archive) and `.compozy/tasks/daemon-mode/_idea.md` (the narrative explaining *why* the daemon project exists — quoting the prior foreground UX). Editing those would corrupt PRD history. Live user-facing docs and `package.json` are clean.
- `task_20.md` itself contains the literal pattern as a requirement instruction; left untouched.
