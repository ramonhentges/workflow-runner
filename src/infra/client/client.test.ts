import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asRunId } from "../../domain/run.js";
import { RpcErrorCode } from "../daemon/protocol.js";
import { bindSocket } from "../daemon/daemon.js";
import {
  connect,
  DaemonClient,
  DaemonConnectionClosedError,
  DaemonRpcError,
  type ClientDuplex,
} from "./client.js";

// ---------------------------------------------------------------------------
// In-memory duplex helper
// ---------------------------------------------------------------------------

interface DuplexPair {
  client: ClientDuplex;
  server: ClientDuplex;
}

function makeDuplexPair(): DuplexPair {
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

/** Read NDJSON frames from a `ReadableStream<Uint8Array>` into a parsed array. */
async function collectFrames(
  readable: ReadableStream<Uint8Array>,
  predicate?: (frames: unknown[]) => boolean,
): Promise<unknown[]> {
  const reader = readable.getReader();
  const frames: unknown[] = [];
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        frames.push(JSON.parse(trimmed));
      }
      if (predicate && predicate(frames)) break;
    }
  } finally {
    reader.releaseLock();
  }
  return frames;
}

/** Write a single JSON value as one NDJSON frame to the writable side. */
async function writeFrame(
  writable: WritableStream<Uint8Array>,
  obj: unknown,
): Promise<void> {
  const w = writable.getWriter();
  try {
    await w.write(encoder.encode(JSON.stringify(obj) + "\n"));
  } finally {
    w.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DaemonClient.call", () => {
  it("frames a request and resolves with the server-provided result", async () => {
    const pair = makeDuplexPair();
    const client = new DaemonClient(pair.client);

    // Receive the request frame, then reply.
    const serverReader = pair.server.readable.getReader();
    const serverWriter = pair.server.writable.getWriter();
    const recv = (async () => {
      const { value } = await serverReader.read();
      const line = decoder.decode(value!).trim();
      const req = JSON.parse(line);
      expect(req).toEqual({ jsonrpc: "2.0", id: 1, method: "run.ps", params: {} });
      await serverWriter.write(
        encoder.encode(
          JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { runs: [] } }) + "\n",
        ),
      );
    })();

    const result = await client.call("run.ps", {});
    expect(result).toEqual({ runs: [] });
    await recv;

    serverReader.releaseLock();
    serverWriter.releaseLock();
    await client.close();
  });

  it("correlates two concurrent calls by id", async () => {
    const pair = makeDuplexPair();
    const client = new DaemonClient(pair.client);

    const serverReader = pair.server.readable.getReader();
    const serverWriter = pair.server.writable.getWriter();

    // Pre-arrange to read two requests and reply out of order.
    const server = (async () => {
      const seen: Array<{ id: number; method: string }> = [];
      let buf = "";
      while (seen.length < 2) {
        const { value } = await serverReader.read();
        buf += decoder.decode(value!, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          const req = JSON.parse(line);
          seen.push({ id: req.id, method: req.method });
        }
      }
      // Reply to the second call first.
      const psId = seen.find((r) => r.method === "run.ps")!.id;
      const stopId = seen.find((r) => r.method === "run.stop")!.id;
      await serverWriter.write(
        encoder.encode(
          JSON.stringify({ jsonrpc: "2.0", id: stopId, result: { finalStatus: "aborted" } }) +
            "\n",
        ),
      );
      await serverWriter.write(
        encoder.encode(
          JSON.stringify({ jsonrpc: "2.0", id: psId, result: { runs: ["A"] } }) + "\n",
        ),
      );
    })();

    const callPs = client.call("run.ps", {});
    const callStop = client.call("run.stop", { runId: asRunId("abc") });

    const [ps, stop] = await Promise.all([callPs, callStop]);
    expect(ps).toEqual({ runs: ["A"] } as unknown as Awaited<typeof callPs>);
    expect(stop).toEqual({ finalStatus: "aborted" } as Awaited<typeof callStop>);

    await server;
    serverReader.releaseLock();
    serverWriter.releaseLock();
    await client.close();
  });

  it("rejects with a typed DaemonRpcError on a JSON-RPC error response", async () => {
    const pair = makeDuplexPair();
    const client = new DaemonClient(pair.client);
    const serverReader = pair.server.readable.getReader();
    const serverWriter = pair.server.writable.getWriter();

    const server = (async () => {
      const { value } = await serverReader.read();
      const req = JSON.parse(decoder.decode(value!).trim());
      await serverWriter.write(
        encoder.encode(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: RpcErrorCode.UNKNOWN_RUN, message: "unknown", data: { runId: "x" } },
          }) + "\n",
        ),
      );
    })();

    let caught: unknown;
    try {
      await client.call("run.stop", { runId: asRunId("x") });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DaemonRpcError);
    const e = caught as DaemonRpcError;
    expect(e.code).toBe(RpcErrorCode.UNKNOWN_RUN);
    expect(e.message).toBe("unknown");
    expect(e.data).toEqual({ runId: "x" });

    await server;
    serverReader.releaseLock();
    serverWriter.releaseLock();
    await client.close();
  });
});

describe("DaemonClient.subscribe", () => {
  it("invokes handler only on matching notifications and unsubscribes cleanly", async () => {
    const pair = makeDuplexPair();
    const client = new DaemonClient(pair.client);

    const received: unknown[] = [];
    const unsubscribe = client.subscribe(
      (n) => n.method === "event.run.event",
      (n) => received.push(n),
    );

    await writeFrame(pair.server.writable, {
      jsonrpc: "2.0",
      method: "event.run.statusChanged",
      params: { runId: "r1", status: "running" },
    });
    await writeFrame(pair.server.writable, {
      jsonrpc: "2.0",
      method: "event.run.event",
      params: { runId: "r1", entry: { seq: 1, ts: 0, stepId: null, event: { type: "log" } } },
    });

    // Allow the read loop a turn to dispatch.
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);
    expect((received[0] as { method: string }).method).toBe("event.run.event");

    unsubscribe();

    await writeFrame(pair.server.writable, {
      jsonrpc: "2.0",
      method: "event.run.event",
      params: { runId: "r1", entry: { seq: 2, ts: 0, stepId: null, event: { type: "log" } } },
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(received).toHaveLength(1);

    await client.close();
  });
});

describe("DaemonClient connection drop / close", () => {
  it("rejects in-flight calls with DaemonConnectionClosedError when the readable ends", async () => {
    const pair = makeDuplexPair();
    const client = new DaemonClient(pair.client);

    // The TransformStream-based pair applies backpressure if the server side
    // never reads; drain client-to-server frames in the background so the
    // client's writer.write does not hang.
    const drainTask = drainAll(pair.server.readable);

    const callOutcome = client
      .call("run.ps", {})
      .then(
        (v) => ({ ok: true as const, value: v }),
        (err: unknown) => ({ ok: false as const, err }),
      );

    // Close the server-to-client side so the client read loop reaches EOF.
    const serverWriter = pair.server.writable.getWriter();
    await serverWriter.close();
    serverWriter.releaseLock();

    const outcome = await callOutcome;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.err).toBeInstanceOf(DaemonConnectionClosedError);
    }

    await client.close();
    await drainTask;
  });

  it("close() ends the writable side and rejects any pending calls", async () => {
    const pair = makeDuplexPair();
    const client = new DaemonClient(pair.client);

    const drainTask = drainAll(pair.server.readable);

    const callOutcome = client
      .call("run.ps", {})
      .then(
        (v) => ({ ok: true as const, value: v }),
        (err: unknown) => ({ ok: false as const, err }),
      );

    await client.close();

    const outcome = await callOutcome;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.err).toBeInstanceOf(DaemonConnectionClosedError);
    }

    // Subsequent calls reject immediately.
    const secondOutcome = await client
      .call("run.ps", {})
      .then(
        () => ({ ok: true as const }),
        (err: unknown) => ({ ok: false as const, err }),
      );
    expect(secondOutcome.ok).toBe(false);
    if (!secondOutcome.ok) {
      expect(secondOutcome.err).toBeInstanceOf(DaemonConnectionClosedError);
    }

    await drainTask;
  });
});

async function drainAll(readable: ReadableStream<Uint8Array>): Promise<void> {
  const reader = readable.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

describe("connect() — auto-spawn behavior", () => {
  let tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tempDirs = [];
  });

  function makeTempStorageRoot(): string {
    const dir = mkdtempSync(join(tmpdir(), "wfr-client-"));
    tempDirs.push(dir);
    return dir;
  }

  it("connects without spawning when the socket is already reachable", async () => {
    const storageRoot = makeTempStorageRoot();
    let spawnCalls = 0;
    const fakeDuplex: ClientDuplex = {
      readable: new ReadableStream<Uint8Array>({ start() {} }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
    };

    const client = await connect({
      storageRoot,
      spawn: () => {
        spawnCalls += 1;
      },
      connectSocket: async () => fakeDuplex,
    });

    expect(spawnCalls).toBe(0);
    expect(client).toBeInstanceOf(DaemonClient);
    await client.close();
  });

  it("auto-spawns and connects on a subsequent poll iteration", async () => {
    const storageRoot = makeTempStorageRoot();
    let spawnCalls = 0;
    let attempts = 0;
    const fakeDuplex: ClientDuplex = {
      readable: new ReadableStream<Uint8Array>({ start() {} }),
      writable: new WritableStream<Uint8Array>({ write() {} }),
    };

    const start = Date.now();
    const client = await connect({
      storageRoot,
      pollIntervalMs: 5,
      timeoutMs: 2000,
      spawn: () => {
        spawnCalls += 1;
      },
      connectSocket: async () => {
        attempts += 1;
        // 1st attempt = initial (pre-spawn) -> fail
        // 2nd attempt = first poll               -> still missing
        // 3rd attempt = second poll              -> success
        if (attempts < 3) {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        }
        return fakeDuplex;
      },
    });

    const elapsed = Date.now() - start;
    expect(spawnCalls).toBe(1);
    expect(attempts).toBe(3);
    expect(elapsed).toBeLessThan(2000);
    expect(client).toBeInstanceOf(DaemonClient);
    await client.close();
  });

  it("rejects with timeout error when the socket never appears", async () => {
    const storageRoot = makeTempStorageRoot();
    const socketPath = join(storageRoot, "daemon.sock");

    let caught: unknown;
    try {
      await connect({
        storageRoot,
        timeoutMs: 30,
        pollIntervalMs: 5,
        spawn: () => {},
        connectSocket: async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toContain("30ms");
    expect(message).toContain(socketPath);
  });

  it("rejects with a spawn-failure error when spawn throws", async () => {
    const storageRoot = makeTempStorageRoot();

    let caught: unknown;
    try {
      await connect({
        storageRoot,
        timeoutMs: 30,
        pollIntervalMs: 5,
        spawn: () => {
          throw new Error("boom — exec not found");
        },
        connectSocket: async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("failed to spawn daemon");
    expect((caught as Error).message).toContain("boom — exec not found");
  });
});

describe("real UDS round-trip", () => {
  it("connects, sends a request, receives a response, and closes via Bun.connect", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wfr-uds-"));
    const socketPath = join(dir, "daemon.sock");

    const listener = bindSocket({
      socketPath,
      onConnection: async (duplex) => {
        // Echo a canned response after reading one frame.
        const reader = duplex.readable.getReader();
        const writer = duplex.writable.getWriter();
        try {
          const { value } = await reader.read();
          const line = decoder.decode(value!).trim();
          const req = JSON.parse(line);
          await writer.write(
            encoder.encode(
              JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { runs: [] } }) + "\n",
            ),
          );
        } finally {
          reader.releaseLock();
          try {
            await writer.close();
          } catch {}
        }
      },
    });

    try {
      const client = await connect({ storageRoot: dir });
      const res = await client.call("run.ps", {});
      expect(res).toEqual({ runs: [] });
      await client.close();
    } finally {
      try {
        listener.stop(true);
      } catch {}
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
  });
});

// Type-level test (compile-time): mismatched params must be rejected.
// This function is never invoked at runtime; it exists purely to assert that
// the type checker catches a params shape mismatch between method and value.
async function _typeMismatchAssertions(c: DaemonClient): Promise<void> {
  // @ts-expect-error — run.start requires { workflowPath: string }, not a number
  await c.call("run.start", 123);
  // @ts-expect-error — run.start params shape mismatch
  await c.call("run.start", { wrongField: "x" });
  // @ts-expect-error — "not.a.method" is not a member of RpcMethods
  await c.call("not.a.method", {});
}
void _typeMismatchAssertions;
