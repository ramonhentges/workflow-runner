# Workflow Runner

A terminal application that supervises multi-step agent workflows defined in JSON config files. Runs as a background daemon; one CLI is used to start, attach to, list, message, retry, and stop runs.

## Quick Start

### Prerequisites

- `opencode` CLI installed and authenticated
- `big-pickle` model available in opencode
- [Bun](https://bun.sh) installed (the `bin` entry resolves to `./src/index.ts` and is launched via `workflow-runner` after link)

### Install

```bash
bun install
bun link              # exposes `workflow-runner` on $PATH
```

Or run without linking by running dev script directly: `bun dev <subcommand> ...`.

### Starting a Workflow

```bash
workflow-runner start workflows/who-is.json
```

The daemon is auto-spawned on first invocation. `start` auto-attaches a TUI when stdout is a TTY; pass `--detach`/`-d` to start in the background.

## CLI Surface

| Command | Description |
|---|---|
| `workflow-runner start <workflow.json> [--detach\|-d]` | Start a new run. Auto-attaches the TUI on a TTY, prints `<runId> <slug>` otherwise. |
| `workflow-runner attach [<run-id>]` | Attach the TUI to a running run. Resolves an unambiguous prefix of id or slug. |
| `workflow-runner ps [--all\|-a]` | List runs. Active first, then terminal-state runs from the last 24h. |
| `workflow-runner send <run-id> <message\|->` | Queue a user message for an interactive run. `-` reads from stdin. |
| `workflow-runner retry-step <run-id>` | Re-spawn the failing step of a `crashed`/`failed`/`aborted` run. |
| `workflow-runner stop <run-id>` | Graceful-then-forceful stop; run reaches `aborted`. |
| `workflow-runner doctor` | Print the daemon health report (socket, lockfile, active runs, disk usage). |
| `workflow-runner daemon` | Run the daemon process in the foreground (normally auto-spawned, exposed for diagnostics). |

Detach from an attached TUI with the `/detach` slash command inside the TUI; Ctrl-C kills the TUI only and leaves the run alive.

Global flags: `--help`/`-h`, `--version`.

## Manual E2E Testing Procedure

Integration test procedure for the workflow runner using the `workflows/who-is.json` fixture.

### Test Case 1: Full workflow run from entry step

**Command:**
```bash
workflow-runner start workflows/who-is.json
```

**Expected behavior:**

1. **Initialization:** Daemon auto-spawns if not running. TUI appears with "Initializing..." status, connects to opencode, shows "Connected (protocol v1)".
2. **Step 1 (interactive, architect-advisor):**
   - Step banner appears: "Step 1/3: step-1 [architect-advisor / big-pickle]"
   - Mode shows "interactive"
   - Input field is visible (user can type)
   - Agent asks to write name to `./agent.txt`
   - User enters intent like "step-2" or "critical analysis"
   - Agent calls `handoff` tool to route to next step
   - File `./agent.txt` is created with agent's name
3. **Step 2 or 3 (autonomous, depends on user choice):**
   - Step banner appears for the chosen step (step-2 or step-3)
   - Input field is hidden (autonomous mode)
   - Agent's thinking and tool calls stream into log
   - Agent writes its name to corresponding file (`./agent-2.txt` or `./agent-3.txt`)
   - Agent calls `finish` tool with completion message
4. **Summary:**
   - End-of-run summary appears with banner
   - Shows "Workflow completed:" with visited steps listed in order
   - Shows finish message and duration
   - Status shows "Workflow completed" in green
   - TUI stays attached until the user `/detach`s or Ctrl-C's; the run is then visible as `completed` via `workflow-runner ps`.

**Verification:**
- Check that `./agent.txt`, `./agent-2.txt` (or `./agent-3.txt`) were created.
- `workflow-runner ps` shows the run with status `completed` and the visited step list.

### Test Case 2: Detach and re-attach

**Command:**
```bash
workflow-runner start workflows/who-is.json
# inside the TUI: type `/detach`
workflow-runner ps
workflow-runner attach <run-id-or-slug-prefix>
```

**Expected behavior:**

1. After `/detach`, the TUI exits and the run continues in the daemon.
2. `ps` lists the run as `running` with `ATTACHED` empty.
3. `attach` re-opens the TUI with the backlog of events; live events resume streaming.

### Test Case 3: Invalid config path

**Command:**
```bash
workflow-runner start nonexistent.json
```

**Expected behavior:**

1. Error message in stderr describing the missing/unreadable workflow file.
2. No TUI is displayed and no run is created.
3. Process exits non-zero.

### Test Case 4: Stop a run

**Command:**
```bash
workflow-runner start workflows/who-is.json --detach
workflow-runner stop <run-id>
workflow-runner ps
```

**Expected behavior:**

1. `stop` returns when the run reaches `aborted` (within the grace window).
2. `ps` shows the run as `aborted` in the recent-terminal-state section.

### Test Case 5: Health check

**Command:**
```bash
workflow-runner doctor
```

**Expected behavior:**

Reports per subsystem: socket reachable, lockfile valid, active run count, active agent subprocess count, disk usage. Exits non-zero only if any subsystem reports `FAIL`.

## HTTP + WebSocket API

The daemon exposes an HTTP/WS API on `127.0.0.1` (loopback only). The default port is **4517**,
overridable with `--api-port` or `WORKFLOW_RUNNER_API_PORT`. The live port is always written to
`daemon.json` in the storage root (see Discovery below).

### HTTP Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Daemon liveness snapshot (`status`, `pid`, `uptimeMs`, `activeRuns`, `version`). |
| GET | `/runs` | List active + recent runs. `?all=true` includes all terminal-state runs. |
| GET | `/runs/:id` | Run detail snapshot (id or unambiguous slug-prefix). 404 unknown, 409 ambiguous. |
| GET | `/runs/:id/events` | Historical events page. `?fromSeq=N` and/or `?stepId=X`. |
| POST | `/runs` | Start a run. Body: `{ "workflowPath": "...", "cwd": "..." }` (both required). |
| POST | `/runs/:id/stop` | Stop a run gracefully then forcefully. |
| POST | `/runs/:id/retry-step` | Retry the failing step of a crashed/failed/aborted run. |
| GET | `/openapi.json` | OpenAPI 3.0 document describing all endpoints. |

### WebSocket Endpoint

```
WS /runs/:id/attach[?fromSeq=N]
```

Streams live run events as lean JSON frames. See [`docs/ws-protocol.md`](docs/ws-protocol.md)
for the full frame schema, `fromSeq` resume semantics, close codes, and the `input` frame for
interactive steps.

### Discovery File

When the daemon starts it writes `daemon.json` to the storage root (mode `0600`):

```json
{ "pid": 12345, "apiPort": 4517, "socket": "/path/to/daemon.sock" }
```

Consumers should read `daemon.json` to obtain the live port rather than hardcoding 4517. The file
is removed on graceful shutdown. Consumers can cross-check `pid` liveness using the same pattern
as the lockfile.

## Development

### Running Tests

```bash
bun test
```

### Type Checking

```bash
bun run typecheck
```

### Building

```bash
bun run build
```

## Architecture

The project follows hexagonal architecture:

- **`src/domain/`** — Pure business logic (`Workflow`, `Runner`, `Run`, `Step`, `StepOutcome`, ids).
- **`src/app/`** — CLI dispatcher and per-subcommand entry points under `src/app/commands/`.
- **`src/infra/`** — Adapters: `mcp/` (in-process MCP server), `acp/` (opencode subprocess + ACP), `tui/` (terminal UI), `daemon/` (UDS JSON-RPC daemon, run manager, event log, run store), `client/` (UDS JSON-RPC client with auto-spawn).

## Known Limitations

- Per-step startup latency (spawning a fresh `opencode acp` subprocess per step is visible).
- No interactive failure recovery from inside the TUI — use `workflow-runner retry-step` after a failure.
- Linux/macOS only (UDS + `fcntl` flock).
