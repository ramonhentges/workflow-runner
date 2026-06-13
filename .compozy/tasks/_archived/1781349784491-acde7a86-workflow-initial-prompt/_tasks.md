# Initial Prompt at Run Start — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Domain: entry-inbound kind + initialPrompt snapshot field | completed | medium | — |
| 02 | Daemon: thread initialPrompt + kind through RunManager and run.start RPC | completed | medium | task_01 |
| 03 | HTTP API: accept initialPrompt on POST /runs, expose on RunDetail | pending | medium | task_02 |
| 04 | CLI: --prompt flag (inline / stdin / file) | completed | medium | task_02 |
| 05 | Web: optional prompt field on both start forms | completed | medium | task_03 |
| 06 | Web: render initialPrompt in the run view | completed | low | task_03 |
| 07 | TUI: surface initialPrompt in the attached run view | completed | low | task_01 |
