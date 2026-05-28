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

export interface RunDaemonOptions {
  storageRoot?: string;
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

export interface ShutdownDeps {
  listener: { stop(closeActiveConnections?: boolean): void };
  runManager: { shutdown(): Promise<void> };
  lock: AcquiredLock | null;
  socketPath: string;
  logger: DaemonLogger | null;
}

/**
 * Build the SIGTERM/SIGINT graceful-shutdown callback. The returned function
 * is idempotent — subsequent invocations are no-ops.
 */
export function makeShutdown(deps: ShutdownDeps): (reason: string) => Promise<void> {
  let invoked = false;
  return async (reason: string) => {
    if (invoked) return;
    invoked = true;
    deps.logger?.log({ level: "INFO", event: "daemon.shutdown", reason });
    try {
      deps.listener.stop(true);
    } catch {}
    try {
      await deps.runManager.shutdown();
    } catch (err) {
      deps.logger?.log({
        level: "ERROR",
        event: "daemon.shutdownError",
        msg: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      if (existsSync(deps.socketPath)) unlinkSync(deps.socketPath);
    } catch {}
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
 * Daemon entry point. Acquires the lockfile, binds the UDS socket, instantiates
 * the RunManager, runs startup discovery, registers every JSON-RPC handler,
 * and serves connections until SIGTERM/SIGINT.
 */
export async function runDaemon(opts: RunDaemonOptions = {}): Promise<void> {
  const storageRoot = opts.storageRoot ?? RunStore.resolveStorageRoot();
  ensureStorageRoot(storageRoot);

  const socketPath = join(storageRoot, SOCKET_FILENAME);
  const lockPath = join(storageRoot, LOCKFILE_FILENAME);
  const logPath = join(storageRoot, DAEMON_LOG_FILENAME);

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

  const sessionFactory = await resolveSessionFactory();
  const runManager = new RunManager(storageRoot, sessionFactory);

  let triggerExit: (reason: string) => void = () => {};

  try {
    await runManager.discoverOnStartup();

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
