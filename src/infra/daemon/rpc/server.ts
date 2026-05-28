import type { RpcMethods, RpcNotification } from "../protocol.js";
import { ndjsonLines } from "./ndjson.js";
import { parseEnvelope, type RpcId } from "./envelope.js";

/** Throw this in an RpcHandler to send a specific JSON-RPC error code instead of -32603. */
export class RpcError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.data = data;
  }
}

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000;

export interface RpcContext {
  notify<M extends RpcNotification["method"]>(
    method: M,
    params: Extract<RpcNotification, { method: M }>["params"],
  ): Promise<void>;
  onClose(cb: () => void): void;
}

export type RpcHandler<M extends keyof RpcMethods> = (
  params: RpcMethods[M]["params"],
  ctx: RpcContext,
) => Promise<RpcMethods[M]["result"]>;

export interface RpcServerOptions {
  drainTimeoutMs?: number;
}

export interface RpcDuplex {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

export class RpcServer {
  private readonly handlers = new Map<
    string,
    (params: unknown, ctx: RpcContext) => Promise<unknown>
  >();

  handle<M extends keyof RpcMethods>(method: M, handler: RpcHandler<M>): void {
    this.handlers.set(
      method,
      handler as (params: unknown, ctx: RpcContext) => Promise<unknown>,
    );
  }

  /**
   * Accept a single connection and process all JSON-RPC messages on it.
   * Resolves when the connection closes (EOF or error).
   */
  async accept(duplex: RpcDuplex, opts?: RpcServerOptions): Promise<void> {
    const drainTimeoutMs = opts?.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    const encoder = new TextEncoder();
    const writer = duplex.writable.getWriter();
    const closeCallbacks: Array<() => void> = [];
    let connectionClosed = false;

    // --- Serialized write queue ---
    // All writes funnel through a promise chain so frames are never interleaved.
    let writeChain: Promise<void> = Promise.resolve();

    const enqueueWrite = (obj: unknown): Promise<void> => {
      const data = encoder.encode(JSON.stringify(obj) + "\n");

      const doWrite = async (): Promise<void> => {
        if (connectionClosed) return;

        if (drainTimeoutMs > 0) {
          let timer!: ReturnType<typeof setTimeout>;
          try {
            await Promise.race([
              writer.ready,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () => reject(new Error("backpressure drain timeout")),
                  drainTimeoutMs,
                );
              }),
            ]);
          } catch {
            // Slow consumer: close the connection.
            closeConnection();
            return;
          } finally {
            clearTimeout(timer!);
          }
        } else {
          await writer.ready;
        }

        if (connectionClosed) return;
        await writer.write(data);
      };

      const result = writeChain.then(doWrite);
      // Absorb errors from the chain so a failed write does not stall subsequent enqueues.
      writeChain = result.catch(() => {});
      return result;
    };

    const closeConnection = (): void => {
      if (connectionClosed) return;
      connectionClosed = true;
      for (const cb of closeCallbacks) {
        try {
          cb();
        } catch {}
      }
    };

    const ctx: RpcContext = {
      notify: (method, params) => {
        return enqueueWrite({ jsonrpc: "2.0", method, params });
      },
      onClose: (cb) => {
        closeCallbacks.push(cb);
      },
    };

    const sendError = (
      id: RpcId | null,
      code: number,
      message: string,
      data?: unknown,
    ): Promise<void> => {
      const error: Record<string, unknown> = { code, message };
      if (data !== undefined) error.data = data;
      return enqueueWrite({ jsonrpc: "2.0", id: id ?? null, error });
    };

    const sendResult = (id: RpcId, result: unknown): Promise<void> => {
      return enqueueWrite({ jsonrpc: "2.0", id, result });
    };

    try {
      for await (const line of ndjsonLines(duplex.readable)) {
        if (connectionClosed) break;

        const parsed = parseEnvelope(line);

        if (parsed.kind === "error") {
          await sendError(parsed.id, parsed.code, parsed.message);
          continue;
        }

        if (parsed.kind === "batch") {
          // JSON-RPC batch requests are explicitly not supported by this server.
          await sendError(null, -32600, "Batch requests are not supported");
          continue;
        }

        if (parsed.kind === "notification") {
          // Client-to-server notification: dispatch but never send a response.
          const handler = this.handlers.get(parsed.method);
          if (handler) {
            handler(parsed.params, ctx).catch(() => {});
          }
          continue;
        }

        // Request: dispatch and reply.
        const { id, method, params } = parsed;
        const handler = this.handlers.get(method);
        if (!handler) {
          await sendError(id, -32601, `Method not found: ${method}`);
          continue;
        }

        try {
          const result = await handler(params, ctx);
          await sendResult(id as RpcId, result);
        } catch (e) {
          if (e instanceof RpcError) {
            await sendError(id, e.code, e.message, e.data);
          } else {
            const msg = e instanceof Error ? e.message : String(e);
            await sendError(id, -32603, "Internal error", { message: msg });
          }
        }
      }
    } catch {
      // Read error — connection dropped.
    } finally {
      closeConnection();
      try {
        await writer.close();
      } catch {}
    }
  }
}
