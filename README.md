# Workflow Runner

A terminal application that supervises multi-step agent workflows defined in JSON config files. Runs as a background daemon; one CLI is used to start, attach to, list, message, retry, and stop runs.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) installed (the `bin` entry resolves to `./src/index.ts` and is launched via `workflow-runner` after link)
- At least one agent CLI installed, authenticated, and ACP-reachable. The four supported agents and their ACP entrypoints are:

| `ide` value   | Required CLI            | ACP entrypoint (how the runner spawns it) | Notes                                                                                                                    |
| ------------- | ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `opencode`    | `opencode`              | `opencode acp`                            | `OPENCODE_ENABLE_QUESTION_TOOL=1` set automatically                                                                      |
| `claude-code` | `claude` + `node`/`npx` | `npx -y @zed-industries/claude-code-acp`  | No native ACP; driven through the adapter (fetched/cached by npx). The `claude` CLI must be installed and authenticated. |
| `codex`       | `codex` + `node`/`npx`  | `npx -y @zed-industries/codex-acp`        | No native ACP; driven through the adapter (fetched/cached by npx). The `codex` CLI must be installed and authenticated.  |
| `gemini`      | `gemini`                | `gemini --experimental-acp`               | Native ACP behind the experimental flag                                                                                  |

The basic fixture workflow (`workflows/who-is.json`) requires `claude-code` (step 1) and `opencode` (steps 2–3). The multi-agent fixture (`workflows/multi-agent.json`) requires all four agents.

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

To create a fresh run at an exact workflow step, pass its case-sensitive ID:

```bash
workflow-runner start workflows/who-is.json --step step-2
```

Steps before `step-2` are not executed or marked visited. Omitting `--step` starts at the first configured step as usual.

## CLI Surface

| Command                                                | Description                                                                                |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `workflow-runner start <workflow.json> [--step <step-id>] [--detach\|-d]` | Start a new run, optionally at an exact step ID. Auto-attaches the TUI on a TTY. |
| `workflow-runner attach [<run-id>]`                    | Attach the TUI to a running run. Resolves an unambiguous prefix of id or slug.             |
| `workflow-runner ps [--all\|-a]`                       | List runs. Active first, then terminal-state runs from the last 24h.                       |
| `workflow-runner send <run-id> <message\|->`           | Queue a user message for an interactive run. `-` reads from stdin.                         |
| `workflow-runner retry-step <run-id>`                  | Re-spawn the failing step of a `crashed`/`failed`/`aborted` run.                           |
| `workflow-runner stop <run-id>`                        | Graceful-then-forceful stop; run reaches `aborted`.                                        |
| `workflow-runner doctor`                               | Print the daemon health report (socket, lockfile, active runs, disk usage).                |
| `workflow-runner daemon`                               | Run the daemon process in the foreground (normally auto-spawned, exposed for diagnostics). |

Detach from an attached TUI with the `/detach` slash command inside the TUI; Ctrl-C kills the TUI only and leaves the run alive.

Global flags: `--help`/`-h`, `--version`.

## Web Interface

The daemon also hosts a web UI at `http://127.0.0.1:<port>` (default **4517**; read `daemon.json` for the live port). The sidebar provides a **Workflows** link alongside the run dashboard.

The **Start a Run** form can start a listed workflow at any configured step. Selecting a listed workflow loads an ordered step picker; manual workflow paths accept an optional exact step ID. Leaving the field at **Default (first step)** preserves normal entry behavior.

### Workflow Management

Workflow authoring (create, edit, delete) is available exclusively in the web UI — there is no CLI command for these operations. The web pages are:

| Page | URL path | Purpose |
|------|----------|---------|
| List | `/workflows` | All `*.json` files in `<cwd>/workflows`. Edit or delete each entry. |
| Create | `/workflows/new` | Form-based workflow editor. Supports `?from=<name>` to pre-fill from an existing workflow. |
| Edit | `/workflows/$name/edit` | Edit an existing workflow by bare name. |

**Bare-name addressing:** workflow names in URLs omit the `.json` extension — the server appends it. The list page returns filenames with the extension; the web client strips it when building edit and delete links.

**Server-side validation:** every create and update passes the posted `workflow` through `Workflow.fromJson`. Structurally invalid workflows are rejected with `400 WORKFLOW_INVALID`. Authors cannot save an incomplete draft through the API.

### Agent and Model Discovery

When editing a step, selecting an IDE triggers a live catalog probe (`GET /ide/{ide}/catalog?cwd=`). The probe spawns the IDE subprocess over ACP, reads its available agents and models from one `newSession` response, then exits. The step editor's agent and model pickers are populated from the result.

If the IDE is unreachable (not installed, not authenticated, or the probe times out), the response is a normal `200` with `reachable: false` — the picker falls back to free-text entry. Discovery is best-effort and never blocks saving a workflow.

Discovery requires the IDE to be installed and authenticated locally (same prerequisites as running a step; see the table under [Prerequisites](#prerequisites)). Supported `ide` values: `opencode`, `claude-code`, `codex`, `gemini`.

### Delete Behavior

- **Active run present:** the delete is refused with `409 WORKFLOW_RUN_ACTIVE`. Stop the active run first.
- **No active run:** a standard confirmation is shown, then the file is removed. Finished-run history is not affected and does not gate cleanup.

The same active-run guard applies to rename operations (a `PUT` that supplies a new name). An in-place update (no rename) does not trigger the guard.

## Manual E2E Testing Procedure

Integration test procedure for the workflow runner using the `workflows/who-is.json` fixture.

### Test Case 1: Full workflow run from entry step

**Command:**

```bash
workflow-runner start workflows/who-is.json
```

**Expected behavior:**

1. **Initialization:** Daemon auto-spawns if not running. TUI appears with "Initializing..." status.
2. **Step 1 (interactive, architect-advisor on claude-code):**
   - Step banner appears: "Step 1/3: step-1 [architect-advisor / claude-haiku-4-5-20251001]"
   - IDE shown as `claude-code`; mode shows "interactive"
   - Input field is visible (user can type)
   - Agent asks to write name to `./agent.txt`
   - User enters intent like "step-2" or "critical analysis"
   - Agent calls `handoff` tool to route to next step
   - File `./agent.txt` is created with agent's name
3. **Step 2 or 3 (autonomous, opencode, depends on user choice):**
   - Step banner appears for the chosen step (step-2 or step-3)
   - IDE shown as `opencode`; input field is hidden (autonomous mode)
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

### Test Case 6: Multi-agent four-IDE workflow with cross-agent handoff

**Prerequisites:** `claude`, `opencode`, `codex`, and `gemini` CLIs installed, authenticated, and ACP-reachable.

**Command:**

```bash
workflow-runner start workflows/multi-agent.json
```

**Expected behavior:**

1. **Initialization:** Daemon auto-spawns if not running. TUI appears with "Initializing..." status.
2. **Step `plan` (interactive, claude-code):**
   - Step banner shows `plan` with IDE `claude-code`.
   - Input field is visible (interactive mode).
   - Agent writes a plan to `./plan.md`.
   - User types any message to approve the plan.
   - Agent calls `handoff` to route to `implement`.
   - File `./plan.md` is created.
3. **Step `implement` (autonomous, opencode):**
   - Step banner shows `implement` with IDE `opencode`.
   - Input field is hidden (autonomous mode).
   - Agent reads `./plan.md`, writes results to `./output.md`.
   - Agent calls `handoff` to route to `review`.
   - File `./output.md` is created.
4. **Step `review` (autonomous, codex):**
   - Step banner shows `review` with IDE `codex`.
   - Agent reads `./output.md`, writes review notes to `./review.md`.
   - Agent calls `handoff` to route to `summarize`.
   - File `./review.md` is created.
5. **Step `summarize` (autonomous, gemini):**
   - Step banner shows `summarize` with IDE `gemini`.
   - Agent reads `./plan.md`, `./output.md`, `./review.md`, writes `./summary.md`.
   - Agent calls `finish` with a completion message.
6. **Summary:**
   - End-of-run summary shows all four steps visited in order: `plan → implement → review → summarize`.
   - Status shows "Workflow completed" in green.

**Verification:**

- Check that `./plan.md`, `./output.md`, `./review.md`, and `./summary.md` were created.
- `workflow-runner ps` shows the run with status `completed` and all four steps listed.

**Run result:** This procedure must be run manually when all four agent CLIs are available and ACP-reachable. The sequence above documents the expected outcome when all prerequisites are met.

### Test Case 7: Unavailable-agent failure (fail-at-the-step)

This test verifies that a step naming an unavailable agent fails at that step — not at load time — while earlier steps' artifacts persist.

**Setup:** Use `workflows/multi-agent.json` with `codex` and/or `gemini` not installed or not ACP-reachable (remove those binaries from `PATH` or run on a machine without them).

**Command:**

```bash
workflow-runner start workflows/multi-agent.json
```

**Expected behavior:**

1. Steps `plan` and `implement` run and complete normally, creating `./plan.md` and `./output.md`.
2. When execution reaches step `review` (IDE `codex`), the daemon attempts to spawn `npx -y @zed-industries/codex-acp`.
3. Spawn fails (binary not found or ACP not supported). The step `review` transitions to `failed` with an error message naming the step id (`review`) and the `ide` value (`codex`).
4. The run transitions to `failed`. `workflow-runner ps` shows status `failed` with the last completed step.
5. Files `./plan.md` and `./output.md` created by earlier steps persist on disk.
6. `workflow-runner retry-step <run-id>` can restart the failing step after fixing the prerequisite (installing the agent CLI).

**Verification:**

- `./plan.md` and `./output.md` exist after the failure.
- `workflow-runner ps` shows the run as `failed`.
- The error log includes the step id (`review`) and the ide value (`codex`).

## HTTP + WebSocket API

The daemon exposes an HTTP/WS API on `127.0.0.1` (loopback only). The default port is **4517**,
overridable with `--api-port` or `WORKFLOW_RUNNER_API_PORT`. The live port is always written to
`daemon.json` in the storage root (see Discovery below).

### HTTP Endpoints

| Method | Path                   | Description                                                                      |
| ------ | ---------------------- | -------------------------------------------------------------------------------- |
| GET    | `/health`              | Daemon liveness snapshot (`status`, `pid`, `uptimeMs`, `activeRuns`, `version`). |
| GET    | `/runs`                | List active + recent runs. `?all=true` includes all terminal-state runs.         |
| GET    | `/runs/:id`            | Run detail snapshot (id or unambiguous slug-prefix). 404 unknown, 409 ambiguous. |
| GET    | `/runs/:id/events`     | Historical events page. `?fromSeq=N` and/or `?stepId=X`.                         |
| POST   | `/runs`                | Start a run. Body requires `workflowPath` and `cwd`; optional `startStepId` selects an exact entry step. |
| POST   | `/runs/:id/stop`       | Stop a run gracefully then forcefully.                                           |
| POST   | `/runs/:id/retry-step` | Retry the failing step of a crashed/failed/aborted run.                          |
| GET    | `/workflows?cwd=`      | List `*.json` workflow files in `<cwd>/workflows`.                               |
| GET    | `/workflows/:name?cwd=` | Read one workflow by bare name (`.json` appended by the server). 404 if not found. |
| POST   | `/workflows?cwd=`      | Create a workflow; body `{ name, workflow }`. Server-validates structure. 409 if name exists. |
| PUT    | `/workflows/:name?cwd=` | Update or rename; body `{ workflow, name? }`. 409 if a run is active (rename) or target exists. |
| DELETE | `/workflows/:name?cwd=` | Delete a workflow. 409 `WORKFLOW_RUN_ACTIVE` if a run is active.               |
| GET    | `/ide/:ide/catalog?cwd=` | Probe `ide` for available agents and models. Always 200; `reachable: false` if unreachable. 400 for unknown `ide`. |
| GET    | `/openapi.json`        | OpenAPI 3.0 document describing all endpoints.                                   |

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

- Per-step startup latency (spawning a fresh agent subprocess per step is visible, especially for agents with slower startup times).
- Spawn commands for each agent are hardcoded; no per-environment overrides yet. Ensure the binary is on `PATH` with the expected entrypoint.
- No interactive failure recovery from inside the TUI — use `workflow-runner retry-step` after a failure.
- Linux/macOS only (UDS + `fcntl` flock).
