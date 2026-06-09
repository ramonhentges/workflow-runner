import { expect, describe, it } from "bun:test";

import type { ToolCallStatus, ToolCallView } from "../../domain/runner.js";
import { C } from "./theme.js";
import {
  SPINNER_FRAMES,
  formatToolCallContent,
  toolCallColor,
  toolCallIcon,
} from "./tool-call-format.js";

function view(overrides: Partial<ToolCallView> = {}): ToolCallView {
  return {
    toolCallId: "tc-1",
    status: "completed",
    kind: "execute",
    title: "Bash: npm test",
    ...overrides,
  };
}

describe("toolCallIcon", () => {
  it("returns the success glyph for completed and the failure glyph for failed", () => {
    expect(toolCallIcon("completed")).toBe("✓");
    expect(toolCallIcon("failed")).toBe("✗");
  });

  it("returns the neutral affordance for pending (no spinner frame)", () => {
    expect(toolCallIcon("pending")).toBe("○");
  });

  it("returns the static affordance for in_progress when no frame is supplied", () => {
    // Fast calls that settle before the appearance delay never see a frame.
    expect(toolCallIcon("in_progress")).toBe("○");
  });

  it("renders the supplied spinner frame only for in_progress", () => {
    const frame = SPINNER_FRAMES[3];
    expect(toolCallIcon("in_progress", frame)).toBe(frame);
    // A stray frame on a settled status must not override its terminal glyph.
    expect(toolCallIcon("completed", frame)).toBe("✓");
    expect(toolCallIcon("failed", frame)).toBe("✗");
    expect(toolCallIcon("pending", frame)).toBe("○");
  });
});

describe("toolCallColor", () => {
  it("maps each status to its theme color", () => {
    const expected: Record<ToolCallStatus, string> = {
      pending: C.dim,
      in_progress: C.blue,
      completed: C.green,
      failed: C.red,
    };
    for (const status of Object.keys(expected) as ToolCallStatus[]) {
      expect(toolCallColor(status)).toBe(expected[status]);
    }
  });
});

describe("formatToolCallContent", () => {
  it("renders the success icon + title for a completed call", () => {
    expect(formatToolCallContent(view({ status: "completed" }))).toBe(
      "✓ Bash: npm test",
    );
  });

  it("renders the failure icon + 'title — errorText' for a failed call", () => {
    const content = formatToolCallContent(
      view({ status: "failed", errorText: "exit code 1" }),
    );
    expect(content).toBe("✗ Bash: npm test — exit code 1");
  });

  it("omits the error suffix when a failed call has no errorText", () => {
    expect(formatToolCallContent(view({ status: "failed" }))).toBe(
      "✗ Bash: npm test",
    );
  });

  it("does not append errorText for non-failed statuses", () => {
    // errorText is only meaningful on failure; a stray value is ignored.
    const content = formatToolCallContent(
      view({ status: "completed", errorText: "stale" }),
    );
    expect(content).toBe("✓ Bash: npm test");
  });

  it("renders the static affordance for in_progress without a frame", () => {
    expect(formatToolCallContent(view({ status: "in_progress" }))).toBe(
      "○ Bash: npm test",
    );
  });

  it("substitutes the spinner frame for an animating in_progress call", () => {
    const frame = SPINNER_FRAMES[5];
    expect(
      formatToolCallContent(view({ status: "in_progress" }), frame),
    ).toBe(`${frame} Bash: npm test`);
  });
});
