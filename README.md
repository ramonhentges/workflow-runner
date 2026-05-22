# Workflow Runner

A terminal application that executes multi-step agent workflows defined in JSON config files.

## Quick Start

### Prerequisites

- `opencode` CLI installed and authenticated
- `big-pickle` model available in opencode
- Node.js and Bun installed

### Running a Workflow

```bash
bun src/index.ts workflows/who-is.json
```

To start from a specific step:

```bash
bun src/index.ts workflows/who-is.json --start step-2
```

## Manual E2E Testing Procedure

This is the integration test procedure for the workflow runner using the `workflows/who-is.json` fixture.

### Test Case 1: Full workflow run from entry step

**Command:**
```bash
bun src/index.ts workflows/who-is.json
```

**Expected behavior:**

1. **Initialization:** TUI appears with "Initializing..." status, connects to opencode, shows "Connected (protocol v1)"
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
   - Shows finish message
   - Shows duration
   - Status shows "Workflow completed" in green
   - TUI stays open (user can scroll and review)
   - Ctrl+C exits

**Verification:**
- Check that `./agent.txt`, `./agent-2.txt` (or `./agent-3.txt`) were created
- Verify step order is correct based on user's choice
- Process exits with status code 0

### Test Case 2: Start from mid-workflow

**Command:**
```bash
bun src/index.ts workflows/who-is.json --start step-2
```

**Expected behavior:**

1. TUI connects and initializes
2. Step 2 (autonomous, devils-advocate) begins immediately
   - Step banner: "Step 1/3: step-2 [devils-advocate / big-pickle]"
   - Input field is hidden (autonomous mode)
   - Agent streams its work and writes `./agent-2.txt`
   - Agent calls `finish`
3. Summary shows only step-2 visited
4. Process exits with status 0

**Verification:**
- Step-1 is NOT executed
- Step-2 is the first and only step visited
- File `./agent-2.txt` is created

### Test Case 3: Invalid config path

**Command:**
```bash
bun src/index.ts nonexistent.json
```

**Expected behavior:**

1. Error message appears in console: "Config error: Cannot read workflow file 'nonexistent.json'..."
2. No TUI is displayed
3. No `opencode acp` subprocess is spawned
4. Process exits with status code 1 immediately

**Verification:**
- No files are created
- Process exits non-zero

### Test Case 4: Start with non-existent step

**Command:**
```bash
bun src/index.ts workflows/who-is.json --start step-99
```

**Expected behavior:**

1. Error message in console: "Error: Step 'step-99' not found in workflow"
2. No TUI is displayed
3. No subprocess is spawned
4. Process exits with status 1

**Verification:**
- Process exits non-zero before any workflow execution

### Test Case 5: Step with invalid agent

This would require modifying `workflows/who-is.json` to include an invalid agent name that is not in `availableModes`. For example, changing step-1's agent to "nonexistent-agent".

**Expected behavior:**

1. Workflow loads successfully
2. TUI initializes and connects
3. Step 1 begins
4. Error: "Step 'step-1': agent 'nonexistent-agent' is not a valid mode..."
5. Summary shows failure
6. Process exits with status 1

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
bun build ./src/index.ts --outdir ./build --target=node
```

## Architecture

- **src/index.ts** - CLI entry point, TUI construction, and RunnerUi implementation
- **src/workflow.ts** - Workflow config types and loader with validation
- **src/mcp.ts** - In-process HTTP MCP server for `handoff` and `finish` tools
- **src/runner.ts** - Step orchestration loop and lifecycle management
- **src/client.ts** - ACP client handler (unchanged from original)

## Features

- ✅ Parse workflow JSON from command line
- ✅ Optional `--start <step-id>` flag to begin from mid-workflow
- ✅ Interactive steps (user converses with agent)
- ✅ Autonomous steps (agent works independently, streams output)
- ✅ Step banners for clear step transitions
- ✅ End-of-run summary with visited steps
- ✅ Proper exit codes (0 on success, non-zero on failure)
- ✅ Halt-and-report failure handling

## Known Limitations

- Per-step startup latency (spawning fresh subprocess per step is visible)
- Session pooling not yet implemented
- No interactive failure recovery (retry/skip)
- No workflow graph visualization
