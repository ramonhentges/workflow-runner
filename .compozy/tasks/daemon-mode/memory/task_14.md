# Task Memory: task_14.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Refactor `Tui` from `attach(runner)` to `attachSource(source: TuiEventSource)`; introduce `/detach`; switch Ctrl-C to "kill TUI only with banner"; preserve `/quit`/`/exit` semantics; keep `RunnerEvent` rendering byte-identical; provide an in-memory adapter so foreground main still works.

## Important Decisions

- The `TuiEventSource` interface lives in its own `src/infra/tui/event-source.ts` types-only file so non-TUI callers (client adapter) can import it without pulling in `@opentui/core`.
- Ctrl-C and `/quit`/`/exit` both route through `shutdownWithBanner({callDetach:false})`; only `/detach` passes `callDetach:true`. This keeps the V1 "no distinction between quit and Ctrl-C" rule explicit while letting `/detach` cleanly close the server-side subscription.
- `shutdownWithBanner` is idempotent via `#shutdownInProgress` so repeated `/quit` keystrokes or a Ctrl-C following a `/quit` cannot double-print the banner or double-exit.
- The foreground adapter (`makeRunnerEventSource` in `src/app/main.ts`) maps `source.detach()` to a no-op — the foreground runner has no remote subscription. The TUI still tears itself down via `shutdown()`.
- The `hooks.exit` override in the foreground path resolves a `quitPromise` instead of calling `process.exit`, so `main()` can run its own post-TUI teardown (MCP close with a 500 ms cap) before returning.

## Learnings

- `@opentui/core/testing` exports `createTestRenderer` returning `{ renderer, mockInput, renderOnce, captureCharFrame }`. `mockInput.pressCtrlC()` synthesizes a real `KeyEvent` so the TUI's `keyInput.on("keypress")` handler can be exercised without a TTY.
- Tests must `try { renderer.destroy(); } catch {}` in `afterEach` because `shutdownWithBanner` paths already call `renderer.destroy()` and a second destroy throws.
- `InputRenderableEvents.ENTER` fires the handler with the raw string value; the TUI is responsible for trimming. Tests cover trimming directly via `submitInput("  hello world  ")`.

## Files / Surfaces

- `src/infra/tui/event-source.ts` — new types-only file; just the `TuiEventSource` interface.
- `src/infra/tui/tui.ts` — refactored: `attachSource`, `/detach`, Ctrl-C banner, idempotent shutdown. Imports limited to `@opentui/core`, `../../domain/runner.js`, `./event-source.js`, `./theme.js` (zero deps on `infra/client/` or `infra/daemon/`).
- `src/infra/tui/tui.test.ts` — 11 tests covering subscribe/teardown, double-attach error, 50-event burst, snapshot-style rendering of all event kinds, `/detach`/`/quit`/`/exit`/Ctrl-C semantics, idempotent banner, trimmed-input forwarding, empty-input skip.
- `src/app/main.ts` — wires a `makeRunnerEventSource(runner)` adapter to feed the refactored TUI; uses `hooks.exit` to resolve a quit-promise instead of calling `process.exit` directly.

## Errors / Corrections

- None for this task. (Verified prior session work; full suite green.)

## Ready for Next Run

- Task 15 / 16 (attach command) can build a daemon-backed `TuiEventSource` by wrapping `DaemonClient.subscribe` + `client.call("run.send")` + a `client.call("daemon...")` or close-subscription RPC. The TUI does not import client code, so the adapter must live near `src/infra/client/` or in the command module.
- The "run still alive — `attach` to return" banner string is hard-coded as `DETACH_BANNER` in `tui.ts`. If the attach-CLI in task 16 wants to vary the phrasing per exit reason, expose it via `TuiHooks.writeBanner` (already wired) rather than mutating the constant.
