# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
workflow-runner start workflows/who-is.json     # start a run (auto-attaches TUI on TTY)
workflow-runner start workflows/who-is.json -d  # start a run in the background
workflow-runner ps                              # list active and recent runs
workflow-runner attach <run-id-or-slug-prefix>  # re-attach the TUI to a running run
workflow-runner send <run-id> <message|->       # send input to an interactive run
workflow-runner retry-step <run-id>             # retry the failing step of a run
workflow-runner stop <run-id>                   # stop a run (graceful then forceful)
workflow-runner doctor                          # daemon health report
workflow-runner daemon start                     # start the daemon (whole app) in the background
workflow-runner daemon stop                      # stop the daemon gracefully
workflow-runner daemon status                    # report whether the daemon is running (pid/port)
workflow-runner daemon restart                   # stop then start the daemon
workflow-runner daemon                          # run the daemon in the foreground (diagnostics)
bun test                                        # run all tests
bun test src/domain/workflow.test.ts            # run a single test file
bun run typecheck                               # type-check without emitting
bun run build                                   # compile to ./build/
```

The daemon is auto-spawned on first CLI invocation; `daemon start|stop|status|restart` manage its lifecycle explicitly, and bare `daemon` runs it in the foreground for diagnostics. `workflow-runner` is exposed via `package.json` `bin` (run `bun link` to put it on `$PATH`); otherwise invoke `bun src/index.ts <subcommand> ...`.

Always use `systematic-debugging` skill when debugging.

## Web UI components

The `web/` workspace uses **shadcn/ui** (config in `web/components.json`: style
`new-york`, baseColor `zinc`). UI primitives live in `web/src/components/ui/`.

To add a new primitive, install it via the CLI rather than hand-writing it so it
matches the project's generated conventions:

```bash
cd web && bunx --bun shadcn@latest add <component>   # e.g. textarea, dialog, tooltip
```

This writes `web/src/components/ui/<component>.tsx`. Import it via the `@/components/ui/<component>` alias and compose it in `web/src/features/**`. Components are React 19 function components that take `ref` as a regular prop (no `forwardRef`), so react-hook-form's `register()` ref flows through `{...props}`. Run `bun run test` and `bun run typecheck` (from `web/`) after.

## Architecture

The project follows hexagonal architecture with three layers:

```
src/
  index.ts          — entry point, calls main()
  domain/           — pure business logic, no I/O
  app/              — CLI dispatcher + per-subcommand entry points
  infra/            — I/O adapters
```

**Domain** (`src/domain/`) is I/O-free:

- `workflow.ts` — `Workflow` value object, JSON loading/validation, `Step` and `Edge` types
- `runner.ts` — `Runner` orchestration loop, `RunnerEvent`/`RunnerObserver` observer pattern, and port interfaces (`RunnerTools`, `RunnerAgentSessionFactory`, `RunnerSessionSink`)
- `outcome.ts` — `StepOutcome` discriminated union: `handoff | finish | failure`
- `run.ts` / `run-id.ts` — `Run` aggregate (status transitions, snapshot round-trip) plus id/slug generators
- `ids.ts` — branded types: `SessionId` and `StepToken` are opaque; `StepId` is a plain string alias

**App** (`src/app/`) routes argv to per-subcommand handlers:

- `main.ts` — thin dispatcher that routes `argv[2]` to a `commands/*` handler; owns `--help`/`--version`/`detach`
- `cli.ts` — per-subcommand parsers and a `USAGE` map keyed by subcommand
- `commands/<name>.ts` — one file per subcommand (`start`, `attach`, `ps`, `send`, `retry-step`, `stop`, `doctor`, `daemon`)

**Infra** (`src/infra/`) provides the concrete adapters:

- `mcp/mcp-server.ts` — in-process HTTP MCP server; exposes `handoff` and `finish` tools to the agent subprocess. Implements `RunnerTools`. Guards each tool call with a per-step `StepToken` (`x-workflow-step-token` header) to prevent stale agents from resolving steps they no longer own.
- `acp/ide-profile.ts` — `IdeProfile` value type (spawn spec + `configureSession` hook) and `UnknownIdeError`.
- `acp/ide-profiles.ts` — static registry of the four supported profiles (`opencode`, `claude-code`, `codex`, `gemini`); exports `PROFILES` map and `resolveIdeProfile(ide)`.
- `acp/agent-session.ts` — spawns the IDE subprocess for the current step (selected by `step.ide` via the profile registry), connects via ACP over stdin/stdout, registers the MCP server as a workflow tool server, and sends the kickoff prompt. `dispose()` SIGTERM-then-SIGKILL cleans up the subprocess.
- `acp/acp-client.ts` — thin handler-based wrapper over `@agentclientprotocol/sdk`'s `ClientSideConnection`
- `tui/tui.ts` — terminal UI built on `@opentui/core`; consumes a `TuiEventSource` (live event stream + `sendInput`/`detach`) rather than a `Runner` directly. `/detach` cleanly closes the subscription; Ctrl-C / `/quit` kill the TUI only and leave the run alive.
- `daemon/` — daemon entry, `RunManager`, event log, run store, JSON-RPC server, and per-method handlers
- `client/` — UDS JSON-RPC client with auto-spawn-on-missing-socket and CLI output formatting

## Port rule

A port interface is only needed when it has two or more implementations. When a single adapter is the only implementation, the adapter is used directly — no separate port interface.

## Workflow JSON format

```json
{
  "id": "string",
  "name": "string",
  "steps": [
    {
      "id": "step-1",
      "agent": "architect-advisor/AGENT", // agent/persona id — meaning is per-IDE
      "model": "opencode/big-pickle", // model id — syntax is per-IDE
      "mode": "interactive | autonomous",
      "description": "...",
      "ide": "opencode", // REQUIRED — see supported values below
      "edges": [{ "next_step": "step-2", "intent": "..." }]
    }
  ]
}
```

- **`ide`** is **required** on every step. Supported values: `opencode`, `claude-code`, `codex`, `gemini`. An unrecognized value is not rejected at load time; it fails at the step when the runner tries to dispatch it, preserving earlier steps' work (fail-at-the-step).
- **interactive** steps wait for user messages and resolve via the `handoff`/`finish` MCP tool.
- **autonomous** steps fire a kickoff prompt and must call `handoff` or `finish` before the ACP prompt resolves; if the prompt resolves without a tool call, the step fails.
- `edges` constrain which `next_step` values are valid for `handoff`; a step with no edges cannot call `handoff`.
- A single workflow may freely mix IDEs across steps, including cross-IDE handoffs (e.g. a `claude-code` step hands off to an `opencode` step).

## Workflow management API

Workflow authoring (create, edit, delete) is available in the **web UI only** — there is no CLI command for these operations. The daemon exposes the following endpoints for workflow CRUD and IDE catalog discovery:

| Method | Path | Description |
|--------|------|-------------|
| GET | `/workflows?cwd=` | List `*.json` files in `<cwd>/workflows` (existing; unchanged). |
| GET | `/workflows/:name?cwd=` | Read one by bare name (`.json` appended by the server). |
| POST | `/workflows?cwd=` | Create; body `{ name, workflow }`. Server-validates with `Workflow.fromJson`. 409 if name exists. |
| PUT | `/workflows/:name?cwd=` | Update or rename; body `{ workflow, name? }`. 409 if a run is active (rename only) or rename target exists. |
| DELETE | `/workflows/:name?cwd=` | Delete (run-aware). 409 `WORKFLOW_RUN_ACTIVE` if a run is active. |
| GET | `/ide/:ide/catalog?cwd=` | Probe IDE for available agents and models. Always 200; `reachable: false` if unreachable. 400 for unknown `ide`. |

**Bare-name addressing:** `{name}` in the URL is the bare workflow name without extension; the server appends `.json`. Two name forms coexist: the list endpoint returns `who-is.json`; CRUD routes use `who-is`. The web client strips the extension from list filenames before constructing edit/delete URLs.

**Server-side validation:** `POST` and `PUT` bodies are validated by `Workflow.fromJson`; a `WorkflowConfigError` maps to `400 WORKFLOW_INVALID`. The server is the source of truth; the web editor mirrors validation locally for instant feedback only.

**Run-aware guard:** `DELETE` and rename (`PUT` with a new name) return `409 WORKFLOW_RUN_ACTIVE` when a run referencing that workflow file is in the `running` state. An in-place `PUT` (no rename) does not trigger the guard.

**IDE catalog:** `GET /ide/{ide}/catalog?cwd=` spawns the IDE subprocess over ACP, reads agents and models from one `newSession` response, then exits. Supported `ide` values match the run-time registry: `opencode`, `claude-code`, `codex`, `gemini`. Discovery requires the IDE to be installed and authenticated locally.

## End-to-end testing

The manual E2E procedure is documented in `README.md`. Fixture workflows:

- `workflows/who-is.json` — two-IDE fixture (claude-code + opencode) used in basic E2E tests.
- `workflows/multi-agent.json` — four-IDE fixture (claude-code → opencode → codex → gemini) used in multi-agent E2E tests.

Prerequisites per agent (all must be installed, authenticated, and ACP-reachable):

| `ide` value   | Required CLI            | ACP entrypoint (spawned by the runner)                                                |
| ------------- | ----------------------- | ------------------------------------------------------------------------------------- |
| `opencode`    | `opencode`              | `opencode acp` (native)                                                               |
| `claude-code` | `claude` + `node`/`npx` | `npx -y @zed-industries/claude-code-acp` (adapter; `claude` itself has no native ACP) |
| `codex`       | `codex` + `node`/`npx`  | `npx -y @zed-industries/codex-acp` (adapter; `codex` itself has no native ACP)        |
| `gemini`      | `gemini`                | `gemini --experimental-acp` (native)                                                  |
