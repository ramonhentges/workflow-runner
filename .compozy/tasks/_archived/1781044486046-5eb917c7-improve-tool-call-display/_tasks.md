# Improved Tool-Call Display (CLI + Web) — Task List

## Tasks

| # | Title | Status | Complexity | Dependencies |
|---|-------|--------|------------|--------------|
| 01 | Domain tool_call event, ToolCallView types & sink.toolCall | completed | medium | — |
| 02 | summarizeToolCall pure domain helper | completed | medium | task_01 |
| 03 | ACP emission: per-session accumulator to sink.toolCall | completed | medium | task_01, task_02 |
| 04 | Web Zod schema and types for tool_call event | completed | low | task_01 |
| 05 | Web reducer: fold transcript by toolCallId | completed | medium | task_04 |
| 06 | Web Transcript: status icon/spinner, title and error | completed | medium | task_05 |
| 07 | TUI: in-place map render and braille spinner | completed | medium | task_01 |
