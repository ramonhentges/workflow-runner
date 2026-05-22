# Task Memory: task_03.md

Keep only task-local execution context here. Do not duplicate facts that are obvious from the repository, task file, PRD documents, or git history.

## Objective Snapshot

Implement in-process HTTP MCP server hosting `handoff` and `finish` tools for workflow step execution.

## Important Decisions

- Implemented HTTP server using Node's built-in `http` module directly instead of @modelcontextprotocol/sdk's transport wrapper, as a simpler and more straightforward approach for handling JSON-RPC 2.0 MCP protocol.
- Global mutable state (currentStep, currentResolve) is sufficient because steps run one at a time per ADR-001/TechSpec.
- Pure `resolveHandoffTarget` function extracted for testability; handles edge validation without server runtime.

## Learnings

- MCP protocol is JSON-RPC 2.0 over HTTP; `tools/list` and `tools/call` are the primary methods.
- Tool definitions are dynamic per step (tools regenerated per session since each step is a new session).
- ES modules require explicit `.js` extensions in relative imports with node16/nodenext module resolution.
- Bun test with `bun-types` in devDependencies works reliably; no additional test framework setup needed.

## Files / Surfaces

- Created: `src/mcp.ts` - Core implementation with HTTP server, tool handlers, and edge validation function.
- Created: `src/mcp.test.ts` - 9 test cases covering edge validation (unit) and server startup/tools/outcomes (integration).

## Errors / Corrections

- Initial implementation incorrectly imported unused items from @modelcontextprotocol/sdk; removed to simplify and use Node's http module directly.
- Fixed: Bun test callback type annotations and ES module import extensions (.js suffix required).

## Ready for Next Run

- `src/mcp.ts` fully implements WorkflowMcpServer interface with createWorkflowMcpServer(), beginStep(), and close().
- All 23 tests passing (9 for mcp, 14 for workflow from task_02).
- Test coverage for edge validation, tool listing, handoff/finish outcomes, and failure handling.
- Task 04 (runner.ts) can import `StepOutcome`, `StepContext`, `createWorkflowMcpServer`, and `resolveHandoffTarget` from mcp.ts.
