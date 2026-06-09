import { describe, it, expect } from "bun:test";
import { summarizeToolCall, type ToolCallInput } from "./tool-call.js";

const CWD = "/home/user/project";

function input(overrides: Partial<ToolCallInput> = {}): ToolCallInput {
  return {
    toolCallId: "tc-1",
    status: "in_progress",
    cwd: CWD,
    ...overrides,
  };
}

// Mirror of the ACP ToolCallContent text shape, used for error extraction.
function textContent(text: string) {
  return { type: "content", content: { type: "text", text } };
}

describe("summarizeToolCall — per-kind titles", () => {
  it("formats execute as 'Bash: <command>' from rawInput.command", () => {
    const view = summarizeToolCall(
      input({ kind: "execute", title: "Run", rawInput: { command: "npm test" } }),
    );
    expect(view.title).toBe("Bash: npm test");
    expect(view.kind).toBe("execute");
  });

  it("formats read as 'Read <relpath>' with the cwd prefix stripped", () => {
    const view = summarizeToolCall(
      input({
        kind: "read",
        title: "Reading",
        locations: [{ path: `${CWD}/src/index.ts` }],
      }),
    );
    expect(view.title).toBe("Read src/index.ts");
  });

  it("formats edit/delete/move with the matching verb", () => {
    const edit = summarizeToolCall(
      input({ kind: "edit", locations: [{ path: `${CWD}/a.ts` }] }),
    );
    const del = summarizeToolCall(
      input({ kind: "delete", locations: [{ path: `${CWD}/b.ts` }] }),
    );
    const move = summarizeToolCall(
      input({ kind: "move", locations: [{ path: `${CWD}/c.ts` }] }),
    );
    expect(edit.title).toBe("Edit a.ts");
    expect(del.title).toBe("Delete b.ts");
    expect(move.title).toBe("Move c.ts");
  });

  it("leaves an absolute path outside cwd readable (no crash, no '../')", () => {
    const view = summarizeToolCall(
      input({ kind: "edit", locations: [{ path: "/etc/hosts" }] }),
    );
    expect(view.title).toBe("Edit /etc/hosts");
    expect(view.title).not.toContain("..");
  });

  it("renders other/search/fetch kinds with the title verbatim", () => {
    expect(
      summarizeToolCall(input({ kind: "search", title: "Searching for foo" })).title,
    ).toBe("Searching for foo");
    expect(
      summarizeToolCall(input({ kind: "fetch", title: "Fetch https://x.dev" })).title,
    ).toBe("Fetch https://x.dev");
  });
});

describe("summarizeToolCall — fallback chain", () => {
  it("falls back to title when execute has no rawInput.command", () => {
    const view = summarizeToolCall(input({ kind: "execute", title: "Run the suite" }));
    expect(view.title).toBe("Run the suite");
  });

  it("falls back to title when read/edit have no locations", () => {
    expect(summarizeToolCall(input({ kind: "read", title: "Open file" })).title).toBe(
      "Open file",
    );
    expect(summarizeToolCall(input({ kind: "edit", title: "Patch file" })).title).toBe(
      "Patch file",
    );
  });

  it("falls back to the kind label when title is missing", () => {
    const view = summarizeToolCall(input({ kind: "search" }));
    expect(view.title).toBe("Search");
  });

  it("falls back to 'Tool call' when title and kind are both absent", () => {
    const view = summarizeToolCall(input({}));
    expect(view.kind).toBe("other");
    expect(view.title).toBe("Tool call");
  });

  it("treats an empty/whitespace title as missing", () => {
    expect(summarizeToolCall(input({ kind: "other", title: "   " })).title).toBe(
      "Tool call",
    );
  });
});

describe("summarizeToolCall — truncation", () => {
  it("truncates an over-length command to the configured maximum", () => {
    const command = "x".repeat(500);
    const view = summarizeToolCall(
      input({ kind: "execute", rawInput: { command } }),
    );
    const rendered = view.title.replace(/^Bash: /, "");
    expect(rendered.length).toBe(120);
    expect(rendered.endsWith("…")).toBe(true);
  });

  it("truncates an over-length path to the configured maximum", () => {
    const path = `${CWD}/${"d/".repeat(200)}file.ts`;
    const view = summarizeToolCall(
      input({ kind: "read", locations: [{ path }] }),
    );
    const rendered = view.title.replace(/^Read /, "");
    expect(rendered.length).toBe(120);
    expect(rendered.endsWith("…")).toBe(true);
  });
});

describe("summarizeToolCall — error text", () => {
  it("populates errorText from content only when status is failed", () => {
    const failed = summarizeToolCall(
      input({
        status: "failed",
        kind: "execute",
        rawInput: { command: "npm test" },
        content: [textContent("Command failed with exit code 1")],
      }),
    );
    expect(failed.errorText).toBe("Command failed with exit code 1");
  });

  it("omits errorText when status is not failed even if content is present", () => {
    const ok = summarizeToolCall(
      input({
        status: "completed",
        kind: "execute",
        content: [textContent("some output")],
      }),
    );
    expect(ok.errorText).toBeUndefined();
  });

  it("caps long error text to the configured maximum", () => {
    const view = summarizeToolCall(
      input({ status: "failed", content: [textContent("e".repeat(500))] }),
    );
    expect(view.errorText).toBeDefined();
    expect(view.errorText!.length).toBe(200);
    expect(view.errorText!.endsWith("…")).toBe(true);
  });

  it("accepts a bare string content for error extraction", () => {
    const view = summarizeToolCall(
      input({ status: "failed", content: "boom" }),
    );
    expect(view.errorText).toBe("boom");
  });

  it("extracts text from a bare text content block", () => {
    const view = summarizeToolCall(
      input({ status: "failed", content: [{ type: "text", text: "kaboom" }] }),
    );
    expect(view.errorText).toBe("kaboom");
  });

  it("leaves errorText undefined when failed content has no extractable text", () => {
    const view = summarizeToolCall(
      input({ status: "failed", content: [{ type: "diff", path: "/x" }] }),
    );
    expect(view.errorText).toBeUndefined();
  });

  it("falls back to a string rawOutput when content yields no reason", () => {
    const view = summarizeToolCall(
      input({
        status: "failed",
        kind: "execute",
        rawInput: { command: "npm test" },
        rawOutput: "npm ERR! Test failed.  See above for more details.",
      }),
    );
    expect(view.errorText).toBe("npm ERR! Test failed.  See above for more details.");
  });

  it("falls back to a structured rawOutput, preferring stderr", () => {
    const view = summarizeToolCall(
      input({
        status: "failed",
        kind: "execute",
        rawOutput: { stdout: "", stderr: "bash: foo: command not found", exitCode: 127 },
      }),
    );
    expect(view.errorText).toBe("bash: foo: command not found");
  });

  it("prefers content text over rawOutput when both are present", () => {
    const view = summarizeToolCall(
      input({
        status: "failed",
        content: [textContent("from content")],
        rawOutput: "from rawOutput",
      }),
    );
    expect(view.errorText).toBe("from content");
  });

  it("caps a long rawOutput reason to the configured maximum", () => {
    const view = summarizeToolCall(
      input({ status: "failed", rawOutput: "e".repeat(500) }),
    );
    expect(view.errorText!.length).toBe(200);
    expect(view.errorText!.endsWith("…")).toBe(true);
  });

  it("ignores a rawOutput without any string text fields", () => {
    const view = summarizeToolCall(
      input({ status: "failed", rawOutput: { exitCode: 1, durationMs: 42 } }),
    );
    expect(view.errorText).toBeUndefined();
  });
});

describe("summarizeToolCall — defensive against malformed input", () => {
  it("does not throw and falls back when rawInput is not an object", () => {
    const view = summarizeToolCall(
      input({ kind: "execute", title: "Run", rawInput: "not-an-object" }),
    );
    expect(view.title).toBe("Run");
  });

  it("falls back when rawInput is an object without a string command", () => {
    const view = summarizeToolCall(
      input({ kind: "execute", title: "Run", rawInput: { command: 42 } }),
    );
    expect(view.title).toBe("Run");
  });

  it("ignores non-text content blocks during error extraction", () => {
    const view = summarizeToolCall(
      input({
        status: "failed",
        content: [{ type: "content", content: { type: "image", data: "..." } }],
      }),
    );
    expect(view.errorText).toBeUndefined();
  });

  it("does not throw on malformed locations and falls back", () => {
    const view = summarizeToolCall(
      input({ kind: "read", title: "Open", locations: [{} as { path: string }] }),
    );
    expect(view.title).toBe("Open");
  });

  it("preserves toolCallId and status verbatim", () => {
    const view = summarizeToolCall(
      input({ toolCallId: "abc-123", status: "pending" }),
    );
    expect(view.toolCallId).toBe("abc-123");
    expect(view.status).toBe("pending");
  });
});

describe("summarizeToolCall — integration across ACP kinds", () => {
  // Representative tool_call / tool_call_update payloads per kind, mirroring
  // what AgentSession will pass through (task_03).
  it("maps a representative payload per kind to the expected ToolCallView", () => {
    expect(
      summarizeToolCall(
        input({
          toolCallId: "exec-1",
          status: "in_progress",
          kind: "execute",
          title: "Shell",
          rawInput: { command: "bun test" },
        }),
      ),
    ).toEqual({
      toolCallId: "exec-1",
      status: "in_progress",
      kind: "execute",
      title: "Bash: bun test",
    });

    expect(
      summarizeToolCall(
        input({
          toolCallId: "read-1",
          status: "completed",
          kind: "read",
          title: "Read file",
          locations: [{ path: `${CWD}/README.md` }],
        }),
      ),
    ).toEqual({
      toolCallId: "read-1",
      status: "completed",
      kind: "read",
      title: "Read README.md",
    });

    expect(
      summarizeToolCall(
        input({
          toolCallId: "edit-1",
          status: "completed",
          kind: "edit",
          title: "Edit file",
          locations: [{ path: `${CWD}/src/app.ts` }],
        }),
      ),
    ).toEqual({
      toolCallId: "edit-1",
      status: "completed",
      kind: "edit",
      title: "Edit src/app.ts",
    });

    expect(
      summarizeToolCall(
        input({
          toolCallId: "search-1",
          status: "in_progress",
          kind: "search",
          title: "Grep for TODO",
        }),
      ),
    ).toEqual({
      toolCallId: "search-1",
      status: "in_progress",
      kind: "search",
      title: "Grep for TODO",
    });

    expect(
      summarizeToolCall(
        input({
          toolCallId: "other-1",
          status: "failed",
          kind: "other",
          title: "Custom tool",
          content: [textContent("permission denied")],
        }),
      ),
    ).toEqual({
      toolCallId: "other-1",
      status: "failed",
      kind: "other",
      title: "Custom tool",
      errorText: "permission denied",
    });
  });
});
