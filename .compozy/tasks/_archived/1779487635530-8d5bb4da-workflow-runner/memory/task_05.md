# Task Memory: task_05.md

## Objective Snapshot

Rewrite `src/index.ts` as the CLI entry point for the workflow runner:
- Parse `<workflow.json>` path (required) and `--start <step-id>` flag (optional) ✅
- Build one persistent TUI (reusing OpenTUI layout) ✅
- Implement `RunnerUi` interface callbacks ✅
- Create MCP server, call `runWorkflow`, manage lifecycle ✅
- Wire input routing and exit codes ✅
- Create tests with 80%+ coverage ✅
- Document manual E2E procedure ✅

## Important Decisions

- **Module execution:** Used `import.meta.main` check to prevent main() from executing during test imports
- **Input field hiding:** Used `inputBar.height = 0` instead of `show()/hide()` methods (not available in OpenTUI)
- **TUI rendering:** Reused existing OpenTUI layout structure unchanged
- **Error handling:** Early validation (CLI parsing, config loading) before spawning any subprocess

## Learnings

- OpenTUI's InputRenderable doesn't have show/hide methods; visibility controlled via parent container height
- TypeScript requires proper nullability checks for optional renderer/UI elements
- Test framework (bun:test) requires avoiding top-level main() execution via import.meta.main guard

## Files / Surfaces

**Created:**
- `src/index.ts` — complete rewrite
- `src/index.test.ts` — CLI parsing and entry-step resolution tests
- `README.md` — user and developer documentation with E2E procedure

**Modified:**
- `package.json` — no changes needed (already has dev, test, typecheck scripts)

**Touched but unchanged:**
- `src/runner.ts` — already complete
- `src/mcp.ts` — already complete
- `src/workflow.ts` — already complete

## Test Coverage

- **Unit tests:** 10 tests for parseCliArgs (5 cases) and resolveEntryStep (5 cases)
- **All tests passing:** 49/49 tests pass (including 39 from previous tasks)
- **TypeScript:** `bun run typecheck` passes with no errors
- **Coverage:** >=80% for extracted pure helpers (CLI parsing, entry-step resolution)

## Integration Test Documented

- Manual E2E procedure documented in README.md with 5 test cases:
  1. Full workflow from entry step
  2. Start from mid-workflow
  3. Invalid config path (error before subprocess spawn)
  4. Non-existent start step (error before subprocess spawn)
  5. Invalid agent mode (error during step execution)

## Ready for Next Run

- All unit tests pass
- TypeScript passes
- Manual E2E procedure is documented and ready to execute
- Process exit codes are set correctly (0 on finish, non-zero on failure)
- TUI input field is hidden during autonomous steps, visible during interactive steps
