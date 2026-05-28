# Daemon Mode — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Domain Run aggregate | completed | low | — |
| 02 | Run id and slug generation | completed | low | task_01 |
| 03 | Runner onStepBoundary callback | completed | medium | task_01 |
| 04 | Run store: meta.json persistence and discovery | completed | medium | task_01, task_02 |
| 05 | Event log: ring buffer plus events.jsonl plus rotation | completed | medium | task_01 |
| 06 | Daemon protocol shared types | completed | low | task_01, task_05 |
| 07 | JSON-RPC 2.0 server over NDJSON | completed | high | task_06 |
| 08 | RunManager: concurrent run lifecycle | completed | high | task_03, task_04, task_05 |
| 09 | JSON-RPC handlers — lifecycle | completed | medium | task_07, task_08 |
| 10 | JSON-RPC handlers — interaction and daemon | completed | medium | task_07, task_08 |
| 11 | Daemon entry: UDS bind, lockfile, startup wiring | completed | medium | task_09, task_10 |
| 12 | UDS JSON-RPC client with auto-spawn | completed | high | task_06 |
| 13 | CLI output formatting | completed | low | task_06 |
| 14 | TUI refactor to TuiEventSource | completed | high | task_06 |
| 15 | App commands — lifecycle | completed | medium | task_12, task_13, task_14 |
| 16 | App commands — interaction and daemon | completed | medium | task_12, task_13, task_14 |
| 17 | App CLI subcommand dispatcher | completed | low | task_15, task_16 |
| 18 | CLI parser refactor | completed | low | task_17 |
| 19 | Daemon integration test suite | completed | high | task_11, task_12, task_14 |
| 20 | Remove foreground path and add bin entry | completed | low | task_18, task_19 |
