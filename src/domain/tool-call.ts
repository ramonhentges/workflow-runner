import type { ToolCallStatus, ToolCallView } from "./runner.js";

// Caps keep titles and error text bounded for both render surfaces. They are
// the "sensible cap" referenced by the TechSpec Data Models section.
const MAX_TITLE_LEN = 120;
const MAX_ERROR_LEN = 200;

// Display verbs for the file-mutating ACP kinds.
const KIND_VERBS: Record<string, string> = {
  edit: "Edit",
  delete: "Delete",
  move: "Move",
};

/**
 * ACP-derived inputs needed to compute a display-ready tool-call summary.
 * Optional fields are read defensively — any of them may be absent or
 * malformed depending on the IDE that produced the update.
 */
export interface ToolCallInput {
  toolCallId: string;
  status: ToolCallStatus;
  kind?: string | null;
  title?: string | null;
  rawInput?: unknown; // for "execute" command extraction
  locations?: Array<{ path: string }>; // for read/edit file
  content?: unknown; // for failure-reason extraction only
  rawOutput?: unknown; // failure-reason fallback (e.g. Bash stderr)
  cwd: string;
}

/**
 * Pure mapping from ACP-derived inputs to a complete {@link ToolCallView}.
 *
 * This is the single authoritative summary shared by the CLI and the web, so
 * both surfaces render identical titles. It owns command extraction, file-path
 * relativization/truncation, error-text extraction, and the title/kind
 * fallback. It performs no I/O and never throws on missing or malformed
 * optional fields.
 */
export function summarizeToolCall(input: ToolCallInput): ToolCallView {
  const kind = normalizeKind(input.kind);
  const view: ToolCallView = {
    toolCallId: input.toolCallId,
    status: input.status,
    kind,
    title: buildTitle(input, kind),
  };

  if (input.status === "failed") {
    const errorText = extractErrorText(input.content, input.rawOutput);
    if (errorText) view.errorText = errorText;
  }

  return view;
}

function buildTitle(input: ToolCallInput, kind: string): string {
  switch (kind) {
    case "execute": {
      const command = commandFromRawInput(input.rawInput);
      if (command) return `Bash: ${truncate(command, MAX_TITLE_LEN)}`;
      return fallbackTitle(input, kind);
    }
    case "read": {
      const path = firstRelPath(input);
      if (path) return `Read ${path}`;
      return fallbackTitle(input, kind);
    }
    case "edit":
    case "delete":
    case "move": {
      const path = firstRelPath(input);
      if (path) return `${KIND_VERBS[kind]} ${path}`;
      return fallbackTitle(input, kind);
    }
    default:
      return fallbackTitle(input, kind);
  }
}

// title -> kind label -> generic "Tool call".
function fallbackTitle(input: ToolCallInput, kind: string): string {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title) return title;
  const label = kindLabel(kind);
  if (label) return label;
  return "Tool call";
}

function normalizeKind(kind: string | null | undefined): string {
  return typeof kind === "string" && kind.trim() ? kind : "other";
}

function kindLabel(kind: string): string {
  if (!kind || kind === "other") return "";
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

function commandFromRawInput(rawInput: unknown): string | undefined {
  if (!isObject(rawInput)) return undefined;
  const command = rawInput.command;
  if (typeof command === "string" && command.trim()) return command.trim();
  return undefined;
}

function firstRelPath(input: ToolCallInput): string | undefined {
  const first = Array.isArray(input.locations) ? input.locations[0] : undefined;
  const path =
    isObject(first) && typeof first.path === "string" ? first.path : undefined;
  if (!path || !path.trim()) return undefined;
  return truncate(relativize(path, input.cwd), MAX_TITLE_LEN);
}

// Strip the run cwd prefix so paths under it render relative; leave paths
// outside cwd untouched so they stay readable (no "../../" walks).
function relativize(path: string, cwd: string): string {
  if (!cwd) return path;
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  if (path === base) return ".";
  if (path.startsWith(`${base}/`)) return path.slice(base.length + 1);
  return path;
}

// Prefer the human-readable `content` text; fall back to `rawOutput` (where
// the `execute`/Bash kind commonly reports a failing command's stderr) when no
// content text yields a reason. The terminal content shape carries only a
// `terminalId` — no inline text — so it is not a viable source here.
function extractErrorText(content: unknown, rawOutput: unknown): string | undefined {
  const text = collectText(content).trim() || textFromRawOutput(rawOutput).trim();
  if (!text) return undefined;
  return truncate(text, MAX_ERROR_LEN);
}

// String keys an agent might use to report a failing tool's output, most
// specific (the error/stderr) first so the rendered reason is the useful one.
const RAW_OUTPUT_TEXT_KEYS = ["stderr", "error", "message", "output", "stdout"];

function textFromRawOutput(rawOutput: unknown): string {
  if (typeof rawOutput === "string") return rawOutput;
  if (!isObject(rawOutput)) return "";
  for (const key of RAW_OUTPUT_TEXT_KEYS) {
    const value = rawOutput[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function collectText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    const text = textFromContentItem(item);
    if (text) parts.push(text);
  }
  return parts.join("\n");
}

// Reads ACP ToolCallContent ({ type: "content", content: { type: "text",
// text } }) plus a bare text block, ignoring diff/terminal shapes.
function textFromContentItem(item: unknown): string {
  if (!isObject(item)) return "";
  if (item.type === "content") {
    const block = item.content;
    if (isObject(block) && block.type === "text" && typeof block.text === "string") {
      return block.text;
    }
    return "";
  }
  if (item.type === "text" && typeof item.text === "string") return item.text;
  return "";
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
