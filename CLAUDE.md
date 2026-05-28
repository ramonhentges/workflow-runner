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
workflow-runner daemon                          # run the daemon in the foreground (diagnostics)
bun test                                        # run all tests
bun test src/domain/workflow.test.ts            # run a single test file
bun run typecheck                               # type-check without emitting
bun run build                                   # compile to ./build/
```

The daemon is auto-spawned on first CLI invocation; the `daemon` subcommand exists for diagnostics. `workflow-runner` is exposed via `package.json` `bin` (run `bun link` to put it on `$PATH`); otherwise invoke `bun src/index.ts <subcommand> ...`.

Always use `systematic-debugging` skill when debugging.

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
- `acp/agent-session.ts` — spawns `opencode acp` as a subprocess per step, connects via ACP over stdin/stdout, registers the MCP server as a workflow tool server, and sends the kickoff prompt. `dispose()` SIGTERM-then-SIGKILL cleans up the subprocess.
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
      "agent": "architect-advisor/AGENT",   // opencode mode id
      "model": "opencode/big-pickle",
      "mode": "interactive | autonomous",
      "description": "...",
      "ide": "opencode",
      "edges": [
        { "next_step": "step-2", "intent": "..." }
      ]
    }
  ]
}
```

- **interactive** steps wait for user messages and resolve via the `handoff`/`finish` MCP tool.
- **autonomous** steps fire a kickoff prompt and must call `handoff` or `finish` before the ACP prompt resolves; if the prompt resolves without a tool call, the step fails.
- `edges` constrain which `next_step` values are valid for `handoff`; a step with no edges cannot call `handoff`.

## End-to-end testing

The manual E2E procedure is documented in `README.md`. The fixture workflow is `workflows/who-is.json`. Prerequisites: `opencode` CLI installed and authenticated, `big-pickle` model available.
