# Workflow Memory

Keep only durable, cross-task context here. Do not duplicate facts that are obvious from the repository, PRD documents, or git history.

## Current State

Tasks 01–18 complete. `runDaemon` is the daemon entry point: acquires lockfile (with stale-PID reclaim), binds the UDS at `<storageRoot>/daemon.sock` with mode `0600`, runs `RunManager.discoverOnStartup()`, registers all eight handler factories (including `daemon.doctor` with `countActiveSubprocesses = list().filter(running).length` and `countOrphanPorts = () => 0`), and handles SIGTERM/SIGINT via an idempotent shutdown that stops the listener, awaits `RunManager.shutdown()`, unlinks the socket, and releases the lockfile. Client side: `src/infra/client/client.ts` exposes `connect({ storageRoot? })`, returning a `DaemonClient` with type-safe `call`/`subscribe`/`close`. Auto-spawn forks `src/infra/daemon/entry.ts` via `node:child_process` with detached + stdio:'ignore' + unref. Connection drops reject in-flight calls with `DaemonConnectionClosedError`; JSON-RPC errors surface as `DaemonRpcError`. The TUI now depends on `TuiEventSource` (in `src/infra/tui/event-source.ts`) instead of `Runner`; `/detach` triggers `source.detach()`, Ctrl-C / `/quit` / `/exit` kill the TUI only and print "run still alive — `attach` to return"; the foreground path supplies an in-process adapter from `src/app/main.ts`. All 8 `src/app/commands/*.ts` files consume per-subcommand parsers from `src/app/cli.ts` — no inline argv parsing remains, and `USAGE.<sub>` is the canonical usage source.

Next: task_19 (integration test suite). All eight `src/app/commands/*.ts` entries follow the canonical `run(argv, deps?): Promise<number>` shape: `start`, `attach`, `ps`, `send`, `retry-step`, `stop`, `doctor`, `daemon`. `daemon` is the only one that does NOT call `client.connect()` — it directly invokes `runDaemon({})` from `src/infra/daemon/daemon.ts`. Shared command infrastructure under `src/app/commands/`: `_tui-source.ts`, `_attach-loop.ts`, `_status-watcher.ts`, `_errors.ts`. Reusable mock at `src/infra/client/__tests__/mock-client.ts`. `src/app/main.ts` is a thin dispatcher: routes `argv[2]` to the matching `commands/*` `run()`, owns `--help`/`-h`/no-args/`--version`/`detach` (documentation-only no-op) and unknown-subcommand errors. The new optional `MainDeps` second parameter is backwards-compatible, so `src/index.ts`'s `main(process.argv)` shim was not edited.

## Shared Decisions

- `makeEventLogObserver` must capture subscribers at emit-time (before any await), then re-check attachment before delivery. This is the canonical subscriber-safety pattern for all RunManager observers.
- `onStepBoundary` passes `nextInboundMessage` so RunManager stores raw inbound messages in `kickoffPrompts` for exact retry reproduction (not the built kickoff prompt).
- Injectable options (`generateId`, `generateSlug`, `createMcpServer`) in `RunManagerOptions` are the pattern for breaking filesystem/process dependencies in unit tests.

## Shared Learnings

- `EventLog.append` serializes overlapping appends internally because `Runner` observer callbacks can be async and are not awaited by `Runner.emit`; future RunManager wiring does not need a separate event-log mutex.
- Branded type comparisons in tests must use the typed constructor (e.g., `asRunId("...")`) not bare string literals.

## Open Risks

## Shared Decisions (continued)

- Handlers throw `RpcError` (from `src/infra/daemon/rpc/server.ts`) for domain-specific codes; the RPC server's catch block distinguishes `RpcError` (uses `e.code`) from generic errors (uses `-32603`). This is the canonical error-mapping pattern for all handlers.
- `RunManagerError` carries an optional `data` field; `AMBIGUOUS_PREFIX` errors include `data: { candidates: RunId[] }` for the RPC error envelope.

## Handoffs

- task_11 (`daemon.ts`) registers each handler factory with the RPC server using `rpcServer.handle("run.start", createRunStartHandler(rm))` etc. For `daemon.doctor`, supply `DaemonDoctorDeps` with real `countActiveSubprocesses` (count of `record.runner !== null` in registry), `countOrphanPorts` (V1: return 0), and the storage root.
- task_13 → tasks 15/16: `formatPsTable(rows, now?: number)` was extended with an optional `now` so the formatter stays pure (no `Date.now()` inside). `app/commands/ps.ts` must pass `Date.now()` as the second argument so running rows show a non-zero `ELAPSED`. `formatDoctorReport` expects lowercase `DoctorStatus` (`"ok" | "warn" | "fail"`) per `protocol.ts`; the task_13 spec prose used `"OK"` but that referred to rendered output, not the input shape.

## Shared Decisions (task_12)

- The daemon-entry shim is `src/infra/daemon/entry.ts`. It reads `process.argv[2]` as an optional `storageRoot` and calls `runDaemon({ storageRoot })`. `src/infra/client/spawn.ts` resolves this path via `import.meta.url` so the spawn helper does not need a package-level bin entry yet (task_20 may simplify packaging).
- `DaemonClient.call()` honors backpressure (`await writer.ready` + `await writer.write`). In-memory tests that exercise the call/close paths must add a background drain on `pair.server.readable` to avoid TransformStream stalls — real UDS sockets are not affected because the kernel buffers writes.
- The client API surface is purely transport: TTY/auto-attach decisions are caller responsibilities (per task_12 requirements). App-command code in tasks 15/16 owns those policies.

## Shared Decisions (task_14)

- `TuiEventSource` lives in its own `src/infra/tui/event-source.ts` types-only file so the `src/infra/client/` adapter (task 16) can import it without pulling `@opentui/core`. The TUI imports it back via `./event-source.js`.
- The TUI exit banner is constant: `"run still alive — \`attach\` to return"`. Tests assert this exact bytes. To vary phrasing per exit reason in future commands, override via `TuiHooks.writeBanner` rather than mutating the constant in `tui.ts`.
- `/quit`, `/exit`, and Ctrl-C all route through `shutdownWithBanner({callDetach:false})`. Only `/detach` passes `callDetach:true`, which calls `source.detach()` exactly once. This is the V1 rule; a daemon-backed adapter must therefore treat a closed subscription (no `detach()` call) as "client disconnected" and clean up its own subscriber slot.
- `TuiHooks.exit` defaults to `process.exit(0)`. The foreground path overrides it to resolve a quit-promise so `main()` can run post-TUI teardown (e.g., `mcp.close()`) before returning. Daemon-backed callers in tasks 15/16 should follow the same pattern if they need to flush the client connection cleanly.

## Shared Decisions (task_15)

- The `retry-step` CLI banner is `↻ retrying ${resumedStepId} — LLM output may differ from the previous attempt` (no extra `step-` prefix). This matches the daemon's own log banner emitted by `RunManager.retryStep` at `run-manager.ts:242`, where `failedStepId` already includes the `step-` prefix. Future banner changes must update both sites in lockstep so CLI and daemon-log output agree.
- App-command convention: every `commands/*.ts` exports `async function run(argv: string[], deps?: <CmdDeps>): Promise<number>` and never calls `process.exit` directly — the dispatcher (task 17) decides what to do with the exit code. Default deps are `connect`, `stdout`, `stderr`; commands add their own (e.g., `isTty`, `attach` for `start`, `now` for `ps`).
- Non-TTY auto-detach: `start` treats `!process.stdout.isTTY` exactly like `--detach` (prints `${runId} ${slug}\n` and exits 0). This is the ADR-002 "auto-attach surprises in non-TTY environments" mitigation; any future `attach` command must honor the same rule when run non-interactively.

## Shared Decisions (task_16)

- `daemon.ts` is the only command that does not take a `connect` dep — its single dep is `runDaemon: () => Promise<number | void>`. The default wraps `runDaemon({})` from `infra/daemon/daemon.ts`; void resolves are coerced to exit code 0. Task 17's dispatcher must NOT inject a `DaemonClient` for the `daemon` subcommand.
- `doctor.ts` exits 1 if any subsystem reports `"fail"`, else 0. WARN-only reports return 0 in V1 (per task spec). When/if WARN-as-failure is added later, the central check lives in `hasFailure(report)` inside `doctor.ts`.
- Command-level `client.close()` must run on every exit path, including early returns from disambiguation paths (e.g., `attach`'s zero/many active-runs case). Use a single outer try/finally around the entire post-connect block; nest the call-loop try/catch inside if it has its own error mapping.

## Shared Decisions (task_18)

- `src/app/cli.ts` exports one `parse<Sub>Args(argv)` per subcommand plus a `USAGE` map keyed by subcommand. Every parser returns `ParseResult<T> = {ok:true,help:true} | {ok:true,value:T} | {ok:false,error:string}`. The `--help`/`-h` arms exist on every parser; command files print `USAGE.<sub>` to stdout for help and to stderr alongside the error message for parse failures.
- Future subcommand additions MUST add a parser to `cli.ts` and a matching `USAGE.<sub>` entry; do not reintroduce inline parsing inside `commands/*.ts`.
- Integration tests (task_19) should assert against the `USAGE` map rather than hardcoding usage strings.

## Shared Decisions (task_17)

- The CLI dispatcher's `main(argv, deps?)` is intentionally tiny: route by `argv[2]`, slice the rest, hand off to `commands/*.run()`. `deps.commands` (a `Partial<Record<string, CommandRun>>`) is merged AFTER the default registry so unit tests override only what they need without re-declaring the whole map. Task 18 (per-subcommand parsing) must NOT change the dispatcher's contract — keep each `commands/*.ts` exporting `run(argv, deps?): Promise<number>`.
- `detach` is handled inline in the dispatcher as a documentation-only print + `return 0`. No `commands/detach.ts` file. If a future task adds real client-side detach behavior, create the file then; until then, the inline branch is correct because the message is fixed.
- Version read uses `Bun.file(new URL("../../package.json", import.meta.url)).json()` with a try/catch fallback to `"0.0.0"`. Works for `bun src/index.ts` and `bun build --outdir ./build` because both resolve `../../package.json` to the project root from the source/bundle URL.

## Shared Decisions (task_20)

- `package.json` exposes `workflow-runner` via `bin: { "workflow-runner": "./src/index.ts" }`; the shebang on `src/index.ts` is `#!/usr/bin/env -S bun run` so direct invocation works. Bun is a hard runtime prerequisite (`bun link` is the install path; `npx` won't work without Bun on PATH). `scripts.dev` was deleted — the daemon CLI requires a subcommand, so a bare `bun src/index.ts` has no meaningful default.
- The `daemon` subcommand description ("run the daemon process in the foreground") in `src/app/main.ts:21` refers to attaching the daemon to the current terminal, NOT to the deleted legacy workflow-foreground path. Do not "clean up" that wording.
- Known flake: `src/infra/daemon/run-manager.test.ts:744` ("100 concurrent startRun calls produce non-colliding ids") has ~12% collision probability over the 200×200 slug space. Re-run on intermittent failure.

## Shared Decisions (task_10)

- `RunSubscriber.onStatusChanged?(status)` is the canonical mechanism for daemon-side observers (e.g., `run.attach`) to learn about status transitions. RunManager invokes it after `markCompleted`/`markFailed`/`markCrashed`/`markAborted` (in `#launchRunner` and `stop`) and after `retryStep` puts the run back into `running`.
- `RunManager.sendInput` returns `Promise<number>`: the seq of the `{type:"log", message:"→ <message>"}` event log entry appended for the user message. Handlers expose this as `acceptedSeq` in `run.send`'s result. The entry is also fan-out to live subscribers so attached clients see the echo.
- Handlers that emit notifications after the result reply must defer those `ctx.notify` calls via `Promise.resolve().then(...)` so the RPC server's serialized writeChain enqueues the result reply first. Pattern is encoded in `createRunAttachHandler`.

