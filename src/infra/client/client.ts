import { join } from "node:path";
import type { Socket } from "bun";

import { RpcErrorCode, type RpcMethods, type RpcNotification } from "../daemon/protocol.js";
import { RunStore } from "../daemon/run-store.js";
import { autoSpawnDaemon, type AutoSpawnOptions } from "./spawn.js";

const SOCKET_FILENAME = "daemon.sock";
const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_POLL_MS = 50;

/** Typed JSON-RPC error returned by the daemon. */
export class DaemonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "DaemonRpcError";
    this.code = code;
    this.data = data;
  }
}

/** Thrown into in-flight calls when the daemon connection drops. */
export class DaemonConnectionClosedError extends Error {
  constructor(message = "daemon connection closed") {
    super(message);
    this.name = "DaemonConnectionClosedError";
  }
}

export interface ClientDuplex {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

type Subscription = {
  predicate: (n: RpcNotification) => boolean;
  handler: (n: RpcNotification) => void;
};

/**
 * JSON-RPC 2.0 client speaking NDJSON over a duplex byte stream. The transport
 * is abstracted (`ClientDuplex`) so unit tests can drive it with an in-memory
 * `TransformStream` pair; `connect()` wires up a real Bun unix socket.
 */
export class DaemonClient {
  readonly #writer: ReturnType<WritableStream<Uint8Array>["getWriter"]>;
  readonly #cancelRead: () => Promise<void>;
  readonly #encoder = new TextEncoder();
  readonly #decoder = new TextDecoder();
  readonly #pending = new Map<number, PendingCall>();
  readonly #subscriptions = new Set<Subscription>();
  readonly #readLoop: Promise<void>;
  #nextId = 1;
  #closeReason: Error | null = null;

  constructor(duplex: ClientDuplex) {
    this.#writer = duplex.writable.getWriter();
    const reader =
      duplex.readable.getReader() as unknown as ReadableStreamDefaultReader<Uint8Array>;
    this.#cancelRead = async () => {
      try {
        await reader.cancel();
      } catch {
        // Already closed or aborted — ignore.
      }
    };
    this.#readLoop = this.#runReadLoop(reader);
  }

  async #runReadLoop(
    reader: ReadableStreamDefaultReader<Uint8Array>,
  ): Promise<void> {
    let buffer = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          const trimmed = buffer.trim();
          if (trimmed) this.#dispatch(trimmed);
          break;
        }
        if (value) {
          buffer += this.#decoder.decode(value as Uint8Array, { stream: true });
        }
        const lines = buffer.split("\n");
        buffer = lines.pop()!;
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) this.#dispatch(trimmed);
        }
      }
    } catch {
      // Read error — treated as a connection drop below.
    } finally {
      this.#abort(new DaemonConnectionClosedError());
    }
  }

  #dispatch(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;

    if ("id" in m && m.id !== null && (typeof m.id === "number" || typeof m.id === "string")) {
      const id = typeof m.id === "number" ? m.id : Number.parseInt(m.id, 10);
      if (!Number.isFinite(id)) return;
      const pending = this.#pending.get(id);
      if (!pending) return;
      this.#pending.delete(id);
      const error = m.error as { code?: number; message?: string; data?: unknown } | undefined;
      if (error && typeof error === "object") {
        pending.reject(
          new DaemonRpcError(
            typeof error.code === "number" ? error.code : -32603,
            typeof error.message === "string" ? error.message : "unknown error",
            error.data,
          ),
        );
      } else {
        pending.resolve(m.result);
      }
      return;
    }

    if (typeof m.method === "string") {
      const notification = {
        method: m.method,
        params: m.params,
      } as unknown as RpcNotification;
      for (const sub of [...this.#subscriptions]) {
        let matched = false;
        try {
          matched = sub.predicate(notification);
        } catch {
          matched = false;
        }
        if (!matched) continue;
        try {
          sub.handler(notification);
        } catch {
          // Subscriber errors are isolated.
        }
      }
    }
  }

  #abort(error: Error): void {
    if (this.#closeReason) return;
    this.#closeReason = error;
    const pending = [...this.#pending.values()];
    this.#pending.clear();
    for (const p of pending) p.reject(error);
  }

  /**
   * Send a JSON-RPC request and await the typed result. Rejects with
   * `DaemonRpcError` on a JSON-RPC error response, or
   * `DaemonConnectionClosedError` if the connection drops first.
   */
  async call<M extends keyof RpcMethods>(
    method: M,
    params: RpcMethods[M]["params"],
  ): Promise<RpcMethods[M]["result"]> {
    if (this.#closeReason) throw this.#closeReason;
    const id = this.#nextId++;
    const frame = this.#encoder.encode(
      JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
    );

    const responsePromise = new Promise<RpcMethods[M]["result"]>((resolve, reject) => {
      this.#pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
    });
    // Attach an inert observer so the rejection is never flagged as unhandled
    // by the runtime — the real caller's handler is attached via the outer
    // async wrapper a few microticks later.
    responsePromise.catch(() => {});

    try {
      await this.#writer.ready;
      if (this.#closeReason) throw this.#closeReason;
      await this.#writer.write(frame);
    } catch (err) {
      this.#pending.delete(id);
      throw this.#closeReason ?? err;
    }

    return responsePromise;
  }

  /**
   * Subscribe to server-pushed notifications. Returns an unsubscribe function.
   * `predicate` is invoked for every notification; `handler` is invoked only
   * for those where the predicate returns `true`.
   */
  subscribe(
    predicate: (n: RpcNotification) => boolean,
    handler: (n: RpcNotification) => void,
  ): () => void {
    const sub: Subscription = { predicate, handler };
    this.#subscriptions.add(sub);
    return () => {
      this.#subscriptions.delete(sub);
    };
  }

  /** Close the connection cleanly. Pending calls are rejected. */
  async close(): Promise<void> {
    if (!this.#closeReason) {
      this.#abort(new DaemonConnectionClosedError("client closed"));
    }
    try {
      await this.#writer.close();
    } catch {
      // Already closed or aborted — ignore.
    }
    await this.#cancelRead();
    try {
      await this.#readLoop;
    } catch {
      // Read loop swallows its own errors.
    }
  }
}

export interface ConnectOptions {
  storageRoot?: string;
  /** Override the daemon spawn helper; useful for tests. */
  spawn?: (opts: AutoSpawnOptions) => void;
  /** Override the unix socket connector; useful for tests. */
  connectSocket?: (socketPath: string) => Promise<ClientDuplex>;
  /** Total budget for the post-spawn polling phase, in ms. */
  timeoutMs?: number;
  /** Interval between connect retries during polling, in ms. */
  pollIntervalMs?: number;
  /** Clock injection for tests. */
  now?: () => number;
  /** Sleep injection for tests. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Connect to the daemon over its Unix domain socket. If the socket is absent
 * or refuses the connection, auto-spawns the daemon and polls the socket until
 * it appears or the timeout elapses.
 */
export async function connect(opts: ConnectOptions = {}): Promise<DaemonClient> {
  const storageRoot = opts.storageRoot ?? RunStore.resolveStorageRoot();
  const socketPath = join(storageRoot, SOCKET_FILENAME);
  const spawnFn = opts.spawn ?? autoSpawnDaemon;
  const connectFn = opts.connectSocket ?? connectUnixSocket;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;

  const initial = await tryConnect(connectFn, socketPath);
  if (initial) return new DaemonClient(initial);

  try {
    spawnFn({ storageRoot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`workflow-runner: failed to spawn daemon: ${message}`);
  }

  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    await sleep(pollIntervalMs);
    const duplex = await tryConnect(connectFn, socketPath);
    if (duplex) return new DaemonClient(duplex);
  }

  throw new Error(
    `workflow-runner: daemon did not become reachable at ${socketPath} within ${timeoutMs}ms`,
  );
}

async function tryConnect(
  connector: (socketPath: string) => Promise<ClientDuplex>,
  socketPath: string,
): Promise<ClientDuplex | null> {
  try {
    return await connector(socketPath);
  } catch (err) {
    if (isUnreachable(err)) return null;
    throw err;
  }
}

function isUnreachable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (code === "ENOENT" || code === "ECONNREFUSED") return true;
  // Bun.connect rejects with a non-Error in some versions; fall back to message inspection.
  const message = err instanceof Error ? err.message : String(err);
  return /ENOENT|ECONNREFUSED|no such file|connection refused/i.test(message);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Real Unix-socket connector built on `Bun.connect`. */
async function connectUnixSocket(socketPath: string): Promise<ClientDuplex> {
  interface ConnState {
    controller: ReadableStreamDefaultController<Uint8Array> | null;
    closed: boolean;
  }

  const state: ConnState = { controller: null, closed: false };
  let socket: Socket<ConnState> | null = null;

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      state.controller = controller;
    },
    cancel() {
      state.closed = true;
      try {
        socket?.end();
      } catch {}
    },
  });

  socket = await Bun.connect<ConnState>({
    unix: socketPath,
    socket: {
      open(s) {
        s.data = state;
      },
      data(_s, data: Buffer) {
        if (state.closed || !state.controller) return;
        const copy = new Uint8Array(data.byteLength);
        copy.set(data);
        try {
          state.controller.enqueue(copy);
        } catch {}
      },
      close() {
        if (state.controller) {
          try {
            state.controller.close();
          } catch {}
          state.controller = null;
        }
        state.closed = true;
      },
      end() {
        if (state.controller) {
          try {
            state.controller.close();
          } catch {}
          state.controller = null;
        }
        state.closed = true;
      },
      error(_s, err) {
        if (state.controller) {
          try {
            state.controller.error(err);
          } catch {}
          state.controller = null;
        }
        state.closed = true;
      },
    },
  });

  const liveSocket = socket;
  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      if (state.closed) return;
      try {
        liveSocket.write(chunk);
      } catch {}
    },
    close() {
      try {
        liveSocket.end();
      } catch {}
    },
    abort() {
      try {
        liveSocket.end();
      } catch {}
    },
  });

  return { readable, writable };
}

export { RpcErrorCode };
export type { RpcMethods, RpcNotification };
