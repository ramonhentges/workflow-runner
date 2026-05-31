import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { Socket, UnixSocketListener } from "bun";

import type { RunnerAgentSessionFactory } from "../../domain/runner.js";
import { AcpAgentSessionFactory } from "../acp/agent-session.js";
import { createApiApp } from "../../app/api/app.js";
import { websocket, createWsConnectionRegistry } from "../../app/api/routes/ws-attach.js";
import { DEFAULT_API_PORT } from "../../app/api/security.js";
import type { DiscoveryFile } from "../../app/api/schema.js";
import { DaemonLogger } from "./daemon-log.js";
import { RunManager } from "./run-manager.js";
import { RunStore } from "./run-store.js";
import { RpcServer, type RpcDuplex } from "./rpc/server.js";

import { createDaemonDoctorHandler } from "./handlers/daemon-doctor.js";
import { createDaemonShutdownHandler } from "./handlers/daemon-shutdown.js";
import { createRunAttachHandler } from "./handlers/run-attach.js";
import { createRunPsHandler } from "./handlers/run-ps.js";
import { createRunRetryStepHandler } from "./handlers/run-retry-step.js";
import { createRunSendHandler } from "./handlers/run-send.js";
import { createRunStartHandler } from "./handlers/run-start.js";
import { createRunStopHandler } from "./handlers/run-stop.js";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SOCKET_FILENAME = "daemon.sock";
const LOCKFILE_FILENAME = "daemon.lock";
const DAEMON_LOG_FILENAME = "daemon.log";
const DISCOVERY_FILE_FILENAME = "daemon.json";

export interface RunDaemonOptions {
  storageRoot?: string;
  /** API server port. Overrides WORKFLOW_RUNNER_API_PORT env and the 4517 default. */
  apiPort?: number;
}

/**
 * Resolves the API port: explicit opt > WORKFLOW_RUNNER_API_PORT env > DEFAULT_API_PORT.
 * Exported for unit testing.
 */
export function resolveApiPort(
  opts: RunDaemonOptions,
  env: NodeJS.ProcessEnv = process.env,
): number {
  if (opts.apiPort !== undefined) return opts.apiPort;
  const envVal = env.WORKFLOW_RUNNER_API_PORT;
  if (envVal) {
    const n = parseInt(envVal, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 65535) return n;
  }
  return DEFAULT_API_PORT;
}

/**
 * Asserts the bound hostname is IPv4 loopback. Aborts daemon startup if not.
 * Exported for unit testing.
 */
export function assertLoopbackBind(hostname: string): void {
  if (hostname !== "127.0.0.1") {
    throw new Error(
      `API listener bound to non-loopback address '${hostname}'; daemon startup aborted`,
    );
  }
}

/**
 * Writes the discovery file (daemon.json) with 0600 permissions.
 * Exported for unit testing.
 */
export function writeDiscoveryFile(filePath: string, content: DiscoveryFile): void {
  const json = JSON.stringify(content);
  const fd = openSync(filePath, "w", FILE_MODE);
  try {
    writeSync(fd, json);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    chmodSync(filePath, FILE_MODE);
  } catch {}
}

export class DaemonAlreadyRunningError extends Error {
  readonly pid: number;
  constructor(pid: number) {
    super(`daemon already running with pid ${pid}`);
    this.name = "DaemonAlreadyRunningError";
    this.pid = pid;
  }
}

export interface AcquiredLock {
  fd: number;
  pid: number;
  path: string;
}

/**
 * Atomically take the daemon PID lockfile. If the file already exists and the
 * recorded PID is alive, throws `DaemonAlreadyRunningError`. If the recorded
 * PID is dead (or the file is malformed), the stale lockfile is unlinked and
 * the lock is re-attempted.
 */
export function acquireLock(lockPath: string): AcquiredLock {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(lockPath, "wx", FILE_MODE);
      try {
        writeSync(fd, `${process.pid}\n`);
        fsyncSync(fd);
      } catch (err) {
        try {
          closeSync(fd);
        } catch {}
        throw err;
      }
      return { fd, pid: process.pid, path: lockPath };
    } catch (err) {
      lastError = err;
      if (!isErrno(err) || err.code !== "EEXIST") {
        throw err;
      }
    }

    let pidText: string | null = null;
    try {
      pidText = readFileSync(lockPath, "utf8");
    } catch {
      // Lockfile vanished between create attempt and read — retry create.
      continue;
    }

    const existingPid = Number.parseInt(pidText.trim(), 10);
    if (Number.isFinite(existingPid) && existingPid > 0) {
      if (isProcessAlive(existingPid)) {
        throw new DaemonAlreadyRunningError(existingPid);
      }
    }

    try {
      unlinkSync(lockPath);
    } catch (err) {
      if (isErrno(err) && err.code !== "ENOENT") {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("failed to acquire daemon lockfile");
}

/** Release a lock acquired with `acquireLock`. Safe to call multiple times. */
export function releaseLock(lock: AcquiredLock | null): void {
  if (!lock) return;
  try {
    closeSync(lock.fd);
  } catch {}
  try {
    if (existsSync(lock.path)) {
      const text = readFileSync(lock.path, "utf8");
      const pid = Number.parseInt(text.trim(), 10);
      if (pid === lock.pid) {
        unlinkSync(lock.path);
      }
    }
  } catch {}
}

interface ConnState {
  controller: ReadableStreamDefaultController<Uint8Array> | null;
  closed: boolean;
}

export interface BindSocketOptions {
  socketPath: string;
  onConnection: (duplex: RpcDuplex) => Promise<void>;
  onError?: (err: unknown) => void;
}

/**
 * Bind a Unix domain socket listener at `socketPath`, removing any stale
 * leftover file first, then `chmod 0600` after bind. Each incoming connection
 * is converted into an `RpcDuplex` pair and handed to `onConnection`.
 */
export function bindSocket(opts: BindSocketOptions): UnixSocketListener<ConnState | undefined> {
  if (existsSync(opts.socketPath)) {
    try {
      unlinkSync(opts.socketPath);
    } catch (err) {
      if (isErrno(err) && err.code !== "ENOENT") {
        throw err;
      }
    }
  }

  const listener = Bun.listen<ConnState | undefined>({
    unix: opts.socketPath,
    socket: {
      open(socket: Socket<ConnState | undefined>) {
        const state: ConnState = { controller: null, closed: false };
        const readable = new ReadableStream<Uint8Array>({
          start(controller) {
            state.controller = controller;
          },
          cancel() {
            state.closed = true;
          },
        });
        const writable = new WritableStream<Uint8Array>({
          write(chunk) {
            if (state.closed) return;
            try {
              socket.write(chunk);
            } catch {}
          },
          close() {
            try {
              socket.end();
            } catch {}
          },
          abort() {
            try {
              socket.end();
            } catch {}
          },
        });
        socket.data = state;
        Promise.resolve(opts.onConnection({ readable, writable }))
          .catch((err) => {
            opts.onError?.(err);
          })
          .finally(() => {
            try {
              socket.end();
            } catch {}
          });
      },
      data(socket, data: Buffer) {
        const state = socket.data;
        if (!state || state.closed || state.controller === null) return;
        try {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          state.controller.enqueue(copy);
        } catch {}
      },
      close(socket) {
        const state = socket.data;
        if (!state) return;
        state.closed = true;
        if (state.controller) {
          try {
            state.controller.close();
          } catch {}
          state.controller = null;
        }
      },
      error(socket, err) {
        const state = socket.data;
        if (state && state.controller) {
          try {
            state.controller.error(err);
          } catch {}
          state.controller = null;
        }
        if (state) state.closed = true;
        opts.onError?.(err);
      },
    },
  });

  try {
    chmodSync(opts.socketPath, FILE_MODE);
  } catch {}

  return listener;
}

const WS_DRAIN_GRACE_MS = 200;

export interface ShutdownDeps {
  listener: { stop(closeActiveConnections?: boolean): void };
  /** HTTP/WS API server — stopped after WS drain, before UDS listener. */
  apiServer?: { stop(closeActiveConnections?: boolean): void };
  /** Path to daemon.json — removed on shutdown after socket cleanup. */
  discoveryFilePath?: string;
  /**
   * Drains open WebSocket connections before the API server stops.
   * Returns the number of connections that were sent a close frame.
   * Zero connections → returns 0 immediately (no grace-period wait).
   */
  wsDrain?: (graceMs?: number) => Promise<number>;
  runManager: { shutdown(): Promise<void> };
  lock: AcquiredLock | null;
  socketPath: string;
  logger: DaemonLogger | null;
}

/**
 * Build the SIGTERM/SIGINT graceful-shutdown callback. The returned function
 * is idempotent — subsequent invocations are no-ops.
 *
 * Shutdown order:
 *  1. Drain open WS clients (close frame + brief grace period).
 *  2. Stop the HTTP/WS API server.
 *  3. Stop the UDS listener.
 *  4. RunManager.shutdown().
 *  5. Remove socket / lockfile / daemon.json.
 */
export function makeShutdown(deps: ShutdownDeps): (reason: string) => Promise<void> {
  let invoked = false;
  return async (reason: string) => {
    if (invoked) return;
    invoked = true;
    deps.logger?.log({ level: "INFO", event: "daemon.shutdown", reason });

    // 1. Drain open WS connections (send close frame + brief grace period).
    if (deps.wsDrain) {
      const drainedCount = await deps.wsDrain(WS_DRAIN_GRACE_MS).catch(() => 0);
      deps.logger?.log({ level: "INFO", event: "api.shutdownDrain", drainedCount });
    }

    // 2. Stop the HTTP/WS API server.
    if (deps.apiServer) {
      try {
        deps.apiServer.stop(true);
      } catch {}
    }

    // 3. Stop the UDS listener.
    try {
      deps.listener.stop(true);
    } catch {}

    // 4. RunManager shutdown.
    try {
      await deps.runManager.shutdown();
    } catch (err) {
      deps.logger?.log({
        level: "ERROR",
        event: "daemon.shutdownError",
        msg: err instanceof Error ? err.message : String(err),
      });
    }

    // 5. Remove socket / lockfile / daemon.json.
    try {
      if (existsSync(deps.socketPath)) unlinkSync(deps.socketPath);
    } catch {}
    // Remove discovery file after socket so consumers fail-safe to "not running".
    if (deps.discoveryFilePath) {
      try {
        if (existsSync(deps.discoveryFilePath)) unlinkSync(deps.discoveryFilePath);
      } catch {}
    }
    releaseLock(deps.lock);
    await deps.logger?.close();
  };
}

function ensureStorageRoot(storageRoot: string): void {
  if (!existsSync(storageRoot)) {
    mkdirSync(storageRoot, { recursive: true, mode: DIR_MODE });
  }
  try {
    chmodSync(storageRoot, DIR_MODE);
  } catch {}
}

function countActiveRunners(rm: RunManager): number {
  // One agent subprocess per active running run.
  return rm.list().filter((s) => s.status === "running").length;
}

function registerHandlers(
  server: RpcServer,
  runManager: RunManager,
  storageRoot: string,
  triggerExit: (reason: string) => void,
): void {
  server.handle("run.start", createRunStartHandler(runManager));
  server.handle("run.ps", createRunPsHandler(runManager));
  server.handle("run.attach", createRunAttachHandler(runManager));
  server.handle("run.send", createRunSendHandler(runManager));
  server.handle("run.retryStep", createRunRetryStepHandler(runManager));
  server.handle("run.stop", createRunStopHandler(runManager));
  server.handle(
    "daemon.doctor",
    createDaemonDoctorHandler(runManager, {
      storageRoot,
      countActiveSubprocesses: () => countActiveRunners(runManager),
      countOrphanPorts: () => 0,
    }),
  );
  server.handle("daemon.shutdown", createDaemonShutdownHandler(triggerExit));
}

/**
 * Daemon entry point. Acquires the lockfile, binds the UDS socket, mounts the
 * HTTP/WS API listener, instantiates the RunManager, runs startup discovery,
 * registers every JSON-RPC handler, and serves connections until SIGTERM/SIGINT.
 */
export async function runDaemon(opts: RunDaemonOptions = {}): Promise<void> {
  const storageRoot = opts.storageRoot ?? RunStore.resolveStorageRoot();
  ensureStorageRoot(storageRoot);

  const socketPath = join(storageRoot, SOCKET_FILENAME);
  const lockPath = join(storageRoot, LOCKFILE_FILENAME);
  const logPath = join(storageRoot, DAEMON_LOG_FILENAME);
  const discoveryFilePath = join(storageRoot, DISCOVERY_FILE_FILENAME);

  let lock: AcquiredLock;
  try {
    lock = acquireLock(lockPath);
  } catch (err) {
    if (err instanceof DaemonAlreadyRunningError) {
      process.stderr.write(`daemon already running with pid ${err.pid}\n`);
      process.exit(1);
    }
    throw err;
  }

  const logger = await DaemonLogger.open(logPath);
  let listener: UnixSocketListener<ConnState | undefined> | null = null;
  let apiServer: ReturnType<typeof Bun.serve> | null = null;

  const sessionFactory = await resolveSessionFactory();
  const runManager = new RunManager(storageRoot, sessionFactory, { logger });
  const wsRegistry = createWsConnectionRegistry();

  let triggerExit: (reason: string) => void = () => {};

  const configuredPort = resolveApiPort(opts);

  try {
    await runManager.discoverOnStartup();

    // Bind the HTTP/WS API server first so we know the actual port before
    // signalling readiness via the UDS socket. This ordering guarantees that
    // when the harness/client sees the socket, daemon.json already exists.
    //
    // Deferred fetch container: lets us pass the actual bound port to createApiApp
    // after Bun.serve returns (port 0 → OS-assigned; also needed for testing).
    // JavaScript is single-threaded so appFetch is always updated before any
    // HTTP request can be dispatched.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let appFetch: ((req: Request, srv: any) => Response | Promise<Response>) = () =>
      new Response("Service Starting", { status: 503 });

    try {
      apiServer = Bun.serve({
        port: configuredPort,
        hostname: "127.0.0.1",
        fetch: (req, srv) => appFetch(req, srv),
        websocket,
      });
    } catch (bindErr) {
      const msg = bindErr instanceof Error ? bindErr.message : String(bindErr);
      logger.log({ level: "ERROR", event: "api.bindFailed", port: configuredPort, msg });
      throw new Error(`Failed to bind API listener on port ${configuredPort}: ${msg}`);
    }

    // Post-listen loopback assertion — aborts startup if Bun bound to a non-loopback address.
    const boundHostname = apiServer.hostname ?? "";
    try {
      assertLoopbackBind(boundHostname);
    } catch (assertErr) {
      logger.log({
        level: "ERROR",
        event: "api.bindRejected",
        address: boundHostname,
        msg: assertErr instanceof Error ? assertErr.message : String(assertErr),
      });
      apiServer.stop(true);
      apiServer = null;
      throw assertErr;
    }

    // Create the Hono app with the ACTUAL bound port so the allowlist is correct.
    const actualPort = apiServer.port ?? 0;
    const app = createApiApp(runManager, actualPort, wsRegistry);
    appFetch = app.fetch as typeof appFetch;

    // Write discovery file (0600) before binding the UDS socket so that
    // any client that sees the socket can safely read daemon.json.
    writeDiscoveryFile(discoveryFilePath, {
      pid: process.pid,
      apiPort: actualPort,
      socket: socketPath,
    });

    logger.log({ level: "INFO", event: "api.started", port: actualPort });

    // Bind the UDS socket last — this is the readiness signal for CLI clients.
    listener = bindSocket({
      socketPath,
      onConnection: async (duplex) => {
        const server = new RpcServer();
        registerHandlers(server, runManager, storageRoot, (reason) =>
          triggerExit(reason),
        );
        await server.accept(duplex);
      },
      onError: (err) => {
        logger.log({
          level: "WARN",
          event: "rpc.connectionError",
          msg: err instanceof Error ? err.message : String(err),
        });
      },
    });
  } catch (err) {
    releaseLock(lock);
    await logger.close();
    throw err;
  }

  logger.log({
    level: "INFO",
    event: "daemon.started",
    pid: process.pid,
    socket: socketPath,
  });

  process.stderr.write(
    `workflow-runner: daemon started (pid ${process.pid}, socket ${socketPath})\n`,
  );

  const exit = new Promise<void>((resolve) => {
    const shutdown = makeShutdown({
      listener: listener!,
      apiServer: apiServer ?? undefined,
      wsDrain: (graceMs) => wsRegistry.drain(graceMs),
      discoveryFilePath,
      runManager,
      lock,
      socketPath,
      logger,
    });

    triggerExit = (reason: string) => {
      void shutdown(reason).then(resolve);
    };

    process.once("SIGTERM", () => triggerExit("SIGTERM"));
    process.once("SIGINT", () => triggerExit("SIGINT"));
  });

  await exit;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (isErrno(err) && err.code === "EPERM") return true;
    return false;
  }
}

function isErrno(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

async function resolveSessionFactory(): Promise<RunnerAgentSessionFactory> {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.WORKFLOW_RUNNER_FAKE_FACTORY === "1"
  ) {
    const mod = await import("./test-helpers/fixture-session-factory.js");
    return new mod.FixtureSessionFactory();
  }
  return new AcpAgentSessionFactory();
}

/** Returns the size of the live daemon log file, or 0 if missing. */
export function daemonLogSize(storageRoot: string): number {
  try {
    return statSync(join(storageRoot, DAEMON_LOG_FILENAME)).size;
  } catch {
    return 0;
  }
}
