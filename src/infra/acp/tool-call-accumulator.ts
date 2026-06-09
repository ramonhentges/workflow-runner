import type { ToolCall, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { ToolCallStatus, ToolCallView } from "../../domain/runner.js";
import { summarizeToolCall } from "../../domain/tool-call.js";

// The merged, last-known state for one tool call. Mirrors `ToolCallInput`
// minus the run `cwd`, which is supplied per emission.
interface AccumulatedFields {
  toolCallId: string;
  status: ToolCallStatus;
  kind?: string | null;
  title?: string | null;
  rawInput?: unknown;
  locations?: Array<{ path: string }>;
  content?: unknown;
  rawOutput?: unknown;
}

/**
 * Per-session merge buffer for ACP tool-call notifications.
 *
 * ACP reports a single call across several partial updates (an initial
 * `tool_call`, then one or more `tool_call_update`s that may omit fields such
 * as `kind`/`title`/`rawInput`). This buffer folds each update into the call's
 * full known state — last present field wins — so every emitted
 * {@link ToolCallView} is complete and consumers can stay purely last-wins.
 *
 * Scoped to one {@link AgentSession}/step: ids are unique per session, so the
 * buffer is discarded with the session.
 */
export class ToolCallAccumulator {
  #calls = new Map<string, AccumulatedFields>();

  /**
   * Merge an ACP `tool_call`/`tool_call_update` into known state and return the
   * complete display view to emit. A field is overlaid only when present
   * (ACP marks absent fields as `undefined`/`null`); otherwise the prior value
   * is retained.
   */
  apply(update: ToolCall | ToolCallUpdate, cwd: string): ToolCallView {
    const prev = this.#calls.get(update.toolCallId);
    const merged: AccumulatedFields = {
      toolCallId: update.toolCallId,
      status: update.status ?? prev?.status ?? "pending",
      kind: update.kind ?? prev?.kind,
      title: update.title ?? prev?.title,
      rawInput: update.rawInput ?? prev?.rawInput,
      locations: update.locations ?? prev?.locations,
      content: update.content ?? prev?.content,
      rawOutput: update.rawOutput ?? prev?.rawOutput,
    };
    this.#calls.set(update.toolCallId, merged);
    return summarizeToolCall({ ...merged, cwd });
  }
}
