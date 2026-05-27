import { describe, expect, it, mock } from "bun:test";
import { asRunId, asRunSlug } from "../../../domain/run.js";
import { asStepId } from "../../../domain/ids.js";
import { RpcServer } from "./server.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create an in-memory duplex pair using TransformStream.
 * Returns { client, server } where:
 *   client.writable → server.readable  (client writes, server reads)
 *   server.writable → client.readable  (server writes, client reads)
 */
function makeInMemoryDuplex(): {
  client: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
  server: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
} {
  const clientToServer = new TransformStream<Uint8Array, Uint8Array>();
  const serverToClient = new TransformStream<Uint8Array, Uint8Array>();
  return {
    client: {
      readable: serverToClient.readable,
      writable: clientToServer.writable,
    },
    server: {
      readable: clientToServer.readable,
      writable: serverToClient.writable,
    },
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Write a JSON-RPC request to the client writer and close the stream. */
function makeClientPair(
  requests: string[],
): {
  server: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> };
  readResponses: () => Promise<unknown[]>;
} {
  const { client, server } = makeInMemoryDuplex();

  // Write all requests then close the writable.
  (async () => {
    const cw = client.writable.getWriter();
    for (const req of requests) {
      await cw.write(encoder.encode(req + "\n"));
    }
    await cw.close();
  })();

  const readResponses = async (): Promise<unknown[]> => {
    const results: unknown[] = [];
    const reader = client.readable.getReader();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) results.push(JSON.parse(trimmed));
      }
    }
    if (buf.trim()) results.push(JSON.parse(buf.trim()));
    return results;
  };

  return { server, readResponses };
}

/** Run the server and collect all output frames. */
async function runAndCollect(
  setup: (srv: RpcServer) => void,
  requests: string[],
  opts?: { drainTimeoutMs?: number },
): Promise<unknown[]> {
  const { server, readResponses } = makeClientPair(requests);
  const srv = new RpcServer();
  setup(srv);
  const [, responses] = await Promise.all([
    srv.accept(server, { drainTimeoutMs: opts?.drainTimeoutMs ?? 0 }),
    readResponses(),
  ]);
  return responses;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RpcServer", () => {
  it("dispatches run.ps and returns a well-formed response", async () => {
    const frames = await runAndCollect(
      (srv) => {
        srv.handle("run.ps", async () => ({ runs: [] }));
      },
      ['{"jsonrpc":"2.0","id":1,"method":"run.ps","params":{}}'],
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { runs: [] },
    });
  });

  it("returns -32601 for an unknown method", async () => {
    const frames = await runAndCollect(
      () => {},
      ['{"jsonrpc":"2.0","id":1,"method":"foo.bar","params":{}}'],
    );

    expect(frames).toHaveLength(1);
    const frame = frames[0] as { error: { code: number; message: string } };
    expect(frame).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(frame.error.code).toBe(-32601);
    expect(frame.error.message).toMatch(/method not found/i);
  });

  it("returns -32700 for malformed JSON", async () => {
    const frames = await runAndCollect(
      () => {},
      ["not json at all {{{"],
    );

    expect(frames).toHaveLength(1);
    const frame = frames[0] as { error: { code: number } };
    expect(frame.error.code).toBe(-32700);
  });

  it("returns -32600 for a payload missing the jsonrpc field", async () => {
    const frames = await runAndCollect(
      () => {},
      ['{"id":1,"method":"run.ps","params":{}}'],
    );

    expect(frames).toHaveLength(1);
    const frame = frames[0] as { error: { code: number } };
    expect(frame.error.code).toBe(-32600);
  });

  it("returns -32603 with error data when a handler throws", async () => {
    const frames = await runAndCollect(
      (srv) => {
        srv.handle("run.ps", async () => {
          throw new Error("boom");
        });
      },
      ['{"jsonrpc":"2.0","id":1,"method":"run.ps","params":{}}'],
    );

    expect(frames).toHaveLength(1);
    const frame = frames[0] as {
      error: { code: number; data: { message: string } };
    };
    expect(frame.error.code).toBe(-32603);
    expect(frame.error.data.message).toBe("boom");
  });

  it("writes no response for a Notification (message without id)", async () => {
    const handled = mock(async () => {});
    const frames = await runAndCollect(
      (srv) => {
        // Notifications don't have methods in RpcMethods — use a raw handler map approach.
        // We access the private handlers map indirectly by casting.
        (srv as unknown as { handlers: Map<string, unknown> }).handlers.set(
          "run.ps",
          handled,
        );
      },
      ['{"jsonrpc":"2.0","method":"run.ps","params":{}}'],
    );

    expect(frames).toHaveLength(0);
    // Give the async handler a moment to run.
    await new Promise((r) => setTimeout(r, 10));
    expect(handled).toHaveBeenCalledTimes(1);
  });

  it("writes a Notification frame from ctx.notify and still sends the Response", async () => {
    const runId = asRunId("run00001");
    const slug = asRunSlug("brave-otter");
    const frames = await runAndCollect(
      (srv) => {
        srv.handle("run.ps", async (_params, ctx) => {
          await ctx.notify("event.run.statusChanged", {
            runId,
            status: "running",
          });
          return { runs: [] };
        });
      },
      ['{"jsonrpc":"2.0","id":1,"method":"run.ps","params":{}}'],
    );

    expect(frames).toHaveLength(2);
    // First frame: notification
    expect(frames[0]).toMatchObject({
      jsonrpc: "2.0",
      method: "event.run.statusChanged",
      params: { runId, status: "running" },
    });
    // Second frame: response to the original request
    expect(frames[1]).toEqual({ jsonrpc: "2.0", id: 1, result: { runs: [] } });
  });

  it("returns -32600 with an explanatory message for batch requests", async () => {
    const frames = await runAndCollect(
      () => {},
      ['[{"jsonrpc":"2.0","id":1,"method":"run.ps","params":{}},{"jsonrpc":"2.0","id":2,"method":"run.ps","params":{}}]'],
    );

    expect(frames).toHaveLength(1);
    const frame = frames[0] as { error: { code: number; message: string } };
    expect(frame.error.code).toBe(-32600);
    expect(frame.error.message).toMatch(/batch/i);
  });

  it("correlates ids correctly for two pipelined requests", async () => {
    const frames = await runAndCollect(
      (srv) => {
        srv.handle("run.ps", async () => ({ runs: [] }));
      },
      [
        '{"jsonrpc":"2.0","id":1,"method":"run.ps","params":{}}',
        '{"jsonrpc":"2.0","id":2,"method":"run.ps","params":{}}',
      ],
    );

    expect(frames).toHaveLength(2);
    expect((frames[0] as { id: number }).id).toBe(1);
    expect((frames[1] as { id: number }).id).toBe(2);
  });

  it("calls onClose callbacks exactly once when the connection ends", async () => {
    const cb = mock(() => {});
    const { server, readResponses } = makeClientPair([
      '{"jsonrpc":"2.0","id":1,"method":"run.ps","params":{}}',
    ]);
    const srv = new RpcServer();
    srv.handle("run.ps", async (_params, ctx) => {
      ctx.onClose(cb);
      return { runs: [] };
    });

    await Promise.all([
      srv.accept(server, { drainTimeoutMs: 0 }),
      readResponses(),
    ]);

    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("parses a request split across two chunks (partial-line scenario)", async () => {
    const { client, server } = makeInMemoryDuplex();

    // Write the request in two separate chunks
    (async () => {
      const cw = client.writable.getWriter();
      await cw.write(encoder.encode('{"jsonrpc":"2.0","id":1,"method":'));
      await cw.write(encoder.encode('"run.ps","params":{}}\n'));
      await cw.close();
    })();

    const srv = new RpcServer();
    srv.handle("run.ps", async () => ({ runs: [] }));

    const readResponses = async (): Promise<unknown[]> => {
      const results: unknown[] = [];
      const reader = client.readable.getReader();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) results.push(JSON.parse(trimmed));
        }
      }
      if (buf.trim()) results.push(JSON.parse(buf.trim()));
      return results;
    };

    const [, frames] = await Promise.all([
      srv.accept(server, { drainTimeoutMs: 0 }),
      readResponses(),
    ]);

    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual({ jsonrpc: "2.0", id: 1, result: { runs: [] } });
  });

  it("calls onClose when connection closes via EOF even without a request", async () => {
    const cb = mock(() => {});
    let capturedCtx!: { onClose: (cb: () => void) => void };

    const { server, readResponses } = makeClientPair([
      '{"jsonrpc":"2.0","id":1,"method":"run.ps","params":{}}',
    ]);
    const srv = new RpcServer();
    srv.handle("run.ps", async (_params, ctx) => {
      capturedCtx = ctx;
      ctx.onClose(cb);
      return { runs: [] };
    });

    await Promise.all([
      srv.accept(server, { drainTimeoutMs: 0 }),
      readResponses(),
    ]);

    // Connection is closed by EOF after readResponses drains all frames.
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
