# Configurable Network Bind for External Access — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Add `bindHost` to `RunDaemonOptions` and implement `resolveBindHost()` | completed | low | — |
| 02 | Wire `--host` flag through CLI parser and daemon command | completed | medium | task_01 |
| 03 | Update `Bun.serve()` and replace loopback assertion with warning | completed | medium | task_01, task_02 |
| 04 | Parameterize security middleware with `bindHost` | completed | medium | task_01 |
