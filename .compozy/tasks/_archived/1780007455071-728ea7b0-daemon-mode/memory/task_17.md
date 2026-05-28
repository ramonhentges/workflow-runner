# Task Memory: task_17.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Convert `src/app/main.ts` from the legacy foreground entry into a thin subcommand dispatcher. All 8 `commands/*.ts` entries already exist (tasks 15/16) and own their own argv parsing; `main` only routes by first positional, owns `--help`/`-h`/`--version`/`detach` (documentation-only), and prints an unknown-subcommand hint.

## Important Decisions

- Signature kept as `main(argv: string[], deps?: MainDeps): Promise<number>`. The second `deps` parameter is optional, so `src/index.ts`'s existing `main(process.argv)` shim works unchanged — no edit to index.ts needed.
- `deps.commands` is merged AFTER the defaults (`{...defaults, ...deps.commands}`), so unit tests override only the names they need.
- `detach` is handled inline in the dispatcher (not delegated to a `commands/detach.ts` file), since the task spec defines it as a documentation-only no-op for V1. Creating a file for one literal message would be ceremony.
- Version reader uses `Bun.file(new URL("../../package.json", import.meta.url)).json()` with a try/catch fallback to `"0.0.0"`. This works for `bun src/index.ts` (relative to source) and the `bun build --outdir ./build` output (`build/../../package.json` → project root). Injectable via `deps.readVersion` for hermetic tests.

## Learnings

- Bun's `Bun.file(url).json()` accepts a `URL` directly, no need to convert to a path string.
- The first 100-line draft came in at 116 lines; tightening multi-line arrow bodies and inlining the `version` const got it to 99. The line budget is real — keeping the dispatcher genuinely thin matters.

## Files / Surfaces

- `src/app/main.ts` — rewritten (99 lines).
- `src/app/main.test.ts` — new (10 tests, 55 expects, 97.40% line coverage on main.ts).
- `src/index.ts` — unchanged; verified the shim still works because the new `deps` param is optional.

## Errors / Corrections

- Initial draft was 116 lines, over the <100 line success criterion. Compressed to 99 by collapsing single-use locals and tightening arrow bodies — no behavior change.

## Ready for Next Run

Task 18 (per-subcommand argv parsing refactor in `src/app/cli.ts`) can proceed. The dispatcher does NOT touch per-subcommand parsing — each `commands/*.ts` still parses inline. Task 18 should preserve `commands/*.ts` `run(argv, deps?)` signatures so the dispatcher contract stays stable.
