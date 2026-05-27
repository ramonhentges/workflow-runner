export type RpcId = number | string | null;

export type ParsedMessage =
  | { kind: "request"; id: RpcId; method: string; params: unknown }
  | { kind: "notification"; method: string; params: unknown }
  | { kind: "batch" }
  | { kind: "error"; code: number; message: string; id: RpcId | null };

/**
 * Parse and type-narrow a single NDJSON line into a JSON-RPC 2.0 message.
 * Returns a discriminated union indicating Request, Notification, Batch, or parse/validation error.
 */
export function parseEnvelope(line: string): ParsedMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { kind: "error", code: -32700, message: "Parse error", id: null };
  }

  // JSON-RPC batch requests: explicitly not supported.
  if (Array.isArray(parsed)) {
    return { kind: "batch" };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { kind: "error", code: -32600, message: "Invalid Request", id: null };
  }

  const msg = parsed as Record<string, unknown>;
  const id = extractId(msg.id);

  if (msg.jsonrpc !== "2.0") {
    return { kind: "error", code: -32600, message: "Invalid Request", id };
  }

  if (typeof msg.method !== "string") {
    return { kind: "error", code: -32600, message: "Invalid Request", id };
  }

  // Notification: method present but no 'id' field at all.
  if (!("id" in msg)) {
    return { kind: "notification", method: msg.method, params: msg.params ?? null };
  }

  return { kind: "request", id, method: msg.method, params: msg.params ?? null };
}

function extractId(raw: unknown): RpcId {
  if (typeof raw === "number" || typeof raw === "string" || raw === null) {
    return raw;
  }
  return null;
}
