import type { ToolCallStatus, ToolCallView } from "../../domain/runner.js";
import { C } from "./theme.js";

/**
 * Pure formatting for tool-call lines in the TUI.
 *
 * Kept free of `@opentui/core` so the icon/title/color logic is unit-testable
 * without spinning up a renderer. The TUI (`tui.ts`) owns the `TextRenderable`
 * lifecycle and feeds these strings/colors into it.
 */

// Braille frames advanced by the shared spinner interval. Each frame is a
// single-width glyph so the line width stays stable as it animates.
export const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

// Static glyphs for each lifecycle state. `in_progress` resolves to a spinner
// frame once the appearance delay elapses; until then (and for the unanimated
// case) it shows the same neutral affordance as `pending`, so a fast call
// settles straight to ✓/✗ without ever flashing a braille frame.
const ICONS: Record<ToolCallStatus, string> = {
  pending: "○",
  in_progress: "○",
  completed: "✓",
  failed: "✗",
};

const COLORS: Record<ToolCallStatus, string> = {
  pending: C.dim,
  in_progress: C.blue,
  completed: C.green,
  failed: C.red,
};

/**
 * Status glyph. For `in_progress`, an optional `spinnerFrame` (supplied by the
 * shared interval after its appearance delay) overrides the static affordance
 * so the line animates while the call is running.
 */
export function toolCallIcon(
  status: ToolCallStatus,
  spinnerFrame?: string,
): string {
  if (status === "in_progress" && spinnerFrame) return spinnerFrame;
  return ICONS[status];
}

/** Theme color for a tool-call line, keyed by lifecycle status. */
export function toolCallColor(status: ToolCallStatus): string {
  return COLORS[status];
}

/**
 * The full line content for a tool call: `icon + title`, plus ` — errorText`
 * when the call failed and carries an error message.
 */
export function formatToolCallContent(
  view: ToolCallView,
  spinnerFrame?: string,
): string {
  const icon = toolCallIcon(view.status, spinnerFrame);
  let line = `${icon} ${view.title}`;
  if (view.status === "failed" && view.errorText) {
    line += ` — ${view.errorText}`;
  }
  return line;
}
