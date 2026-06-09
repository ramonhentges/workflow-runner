# Task Memory: task_02.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot
Done. Added pure `summarizeToolCall(ToolCallInput) -> ToolCallView` in
`src/domain/tool-call.ts` + full unit/integration tests (100% coverage).

## Important Decisions
- Truncation caps chosen as constants: `MAX_TITLE_LEN = 120` (command/path
  inside title), `MAX_ERROR_LEN = 200`. Truncation appends single ellipsis "…"
  so the result length equals the cap exactly.
- Path relativization is implemented manually (no `node:path`) to keep the
  module dependency-free: strip `cwd` prefix when the path is under cwd,
  otherwise return the absolute path verbatim (no `../` walks for outside
  paths). `ToolCallInput.cwd` is the run cwd.
- `ToolCallInput` exposes only `content` (not `rawOutput`) per the TechSpec
  "Core Interfaces" block; error text is extracted from `content` (ACP
  `ToolCallContent` text blocks, bare `{type:"text"}` blocks, or a bare string).
- Verbatim `title` is NOT truncated (honors mapping-table "title verbatim");
  only extracted commands/paths are capped.

## Learnings
- ACP `ToolCallContent` "content" variant shape is `{ type: "content", content:
  { type: "text", text } }` — `content` is the ContentBlock directly (one level),
  not double-nested. (Verified in `@agentclientprotocol/sdk` types.gen.d.ts.)
- ACP `ToolKind` enum: read|edit|delete|move|search|execute|think|fetch|
  switch_mode|other. `kind` is optional on updates → normalize missing to
  "other".

## Files / Surfaces
- NEW `src/domain/tool-call.ts`
- NEW `src/domain/tool-call.test.ts` (24 tests)

## Errors / Corrections
- None.

## Ready for Next Run
- task_03 consumes `summarizeToolCall`: build per-session
  `Map<toolCallId, accumulatedFields>` in `AgentSession.sessionUpdate`, merge
  each ACP `tool_call`/`tool_call_update`, pass `{ kind, title, rawInput,
  locations, content, status, toolCallId, cwd }` to `summarizeToolCall`, emit
  via `sink.toolCall`. Add `toolCall` to infra `AgentSessionSink`. Replace the
  two `sink.log("Tool: …")` lines at agent-session.ts ~194-199.
