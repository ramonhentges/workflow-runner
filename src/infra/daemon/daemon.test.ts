import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DaemonAlreadyRunningError,
  acquireLock,
  bindSocket,
  makeShutdown,
  releaseLock,
  type AcquiredLock,
} from "./daemon.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

// ---------------------------------------------------------------------------
// acquireLock
// ---------------------------------------------------------------------------

describe("acquireLock", () => {
  it("creates a fresh lockfile containing the current pid", async () => {
    const root = await tempRoot("wfr-daemon-lock-");
    const lockPath = join(root, "daemon.lock");

    const lock = acquireLock(lockPath);
    try {
      expect(existsSync(lockPath)).toBe(true);
      expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
      expect(lock.pid).toBe(process.pid);
    } finally {
      releaseLock(lock);
    }
    expect(existsSync(lockPath)).toBe(false);
  });

  it("deletes a stale lockfile (dead pid) and acquires the lock", async () => {
    const root = await tempRoot("wfr-daemon-lock-");
    const lockPath = join(root, "daemon.lock");

    // PID 1 is reserved (init); but to guarantee "dead", reserve a transient
    // child process and reuse its exited pid. Use a large value that is
    // overwhelmingly unlikely to be alive on this system.
    const deadPid = pickLikelyDeadPid();
    writeFileSync(lockPath, `${deadPid}\n`, { mode: 0o600 });
    expect(existsSync(lockPath)).toBe(true);

    const lock = acquireLock(lockPath);
    try {
      expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
    } finally {
      releaseLock(lock);
    }
  });

  it("rejects with the recorded pid when the lockfile is held by a live process", async () => {
    const root = await tempRoot("wfr-daemon-lock-");
    const lockPath = join(root, "daemon.lock");

    // The current test process is always alive; use its own pid to simulate a
    // contested lockfile.
    writeFileSync(lockPath, `${process.pid}\n`, { mode: 0o600 });

    let caught: unknown;
    try {
      acquireLock(lockPath);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(DaemonAlreadyRunningError);
    const err = caught as DaemonAlreadyRunningError;
    expect(err.pid).toBe(process.pid);
    expect(err.message).toContain(String(process.pid));
    // Lockfile must remain intact when a live holder is detected.
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, "utf8").trim()).toBe(String(process.pid));
  });
});

// ---------------------------------------------------------------------------
// bindSocket
// ---------------------------------------------------------------------------

describe("bindSocket", () => {
  it("removes a stale socket file before binding and chmods 0600", async () => {
    const root = await tempRoot("wfr-daemon-sock-");
    const socketPath = join(root, "daemon.sock");
    // Drop a leftover file at the bind path to simulate a non-graceful exit.
    writeFileSync(socketPath, "stale", { mode: 0o600 });
    expect(existsSync(socketPath)).toBe(true);

    const listener = bindSocket({
      socketPath,
      onConnection: async () => {},
    });
    try {
      expect(existsSync(socketPath)).toBe(true);
      const mode = statSync(socketPath).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      listener.stop(true);
    }
  });

  it("accepts a client connection and routes its bytes through the duplex", async () => {
    const root = await tempRoot("wfr-daemon-sock-");
    const socketPath = join(root, "daemon.sock");

    const received: string[] = [];
    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    const listener = bindSocket({
      socketPath,
      onConnection: async (duplex) => {
        const reader = duplex.readable.getReader();
        try {
          while (true) {
            const { value, done: rdDone } = await reader.read();
            if (rdDone) break;
            received.push(new TextDecoder().decode(value));
          }
        } finally {
          reader.releaseLock();
          resolveDone();
        }
      },
    });

    try {
      const client = await Bun.connect({
        unix: socketPath,
        socket: {
          data() {},
          open() {},
          close() {},
        },
      });
      client.write("hello\n");
      // Allow the daemon to enqueue the chunk.
      await new Promise((r) => setTimeout(r, 50));
      client.end();
      await done;
      expect(received.join("")).toBe("hello\n");
    } finally {
      listener.stop(true);
    }
  });
});

// ---------------------------------------------------------------------------
// makeShutdown
// ---------------------------------------------------------------------------

describe("makeShutdown", () => {
  it("stops the listener, calls RunManager.shutdown, unlinks the socket, and releases the lock", async () => {
    const root = await tempRoot("wfr-daemon-shutdown-");
    const lockPath = join(root, "daemon.lock");
    const socketPath = join(root, "daemon.sock");

    const lock = acquireLock(lockPath);
    writeFileSync(socketPath, "", { mode: 0o600 });

    let stopCalled = 0;
    let stopArg: boolean | undefined;
    const listener = {
      stop(closeActiveConnections?: boolean) {
        stopCalled++;
        stopArg = closeActiveConnections;
      },
    };

    let shutdownCalled = 0;
    const runManager = {
      shutdown: async () => {
        shutdownCalled++;
      },
    };

    let logged: Array<Record<string, unknown>> = [];
    let logClosed = 0;
    const logger = {
      log: (rec: Record<string, unknown>) => {
        logged.push(rec);
      },
      close: () => {
        logClosed++;
      },
    } as unknown as Parameters<typeof makeShutdown>[0]["logger"];

    const shutdown = makeShutdown({
      listener,
      runManager,
      lock,
      socketPath,
      logger,
    });

    await shutdown("SIGTERM");

    expect(stopCalled).toBe(1);
    expect(stopArg).toBe(true);
    expect(shutdownCalled).toBe(1);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
    expect(logClosed).toBe(1);
    expect(logged.some((r) => r.event === "daemon.shutdown" && r.reason === "SIGTERM")).toBe(true);

    // Calling shutdown again must be a no-op (idempotent).
    await shutdown("SIGINT");
    expect(stopCalled).toBe(1);
    expect(shutdownCalled).toBe(1);
  });

  it("is idempotent across signals", async () => {
    const root = await tempRoot("wfr-daemon-shutdown-");
    const lockPath = join(root, "daemon.lock");
    const socketPath = join(root, "daemon.sock");
    const lock = acquireLock(lockPath);

    let stopCalled = 0;
    let shutdownCalled = 0;
    const listener = {
      stop() {
        stopCalled++;
      },
    };
    const runManager = {
      shutdown: async () => {
        shutdownCalled++;
      },
    };

    const shutdown = makeShutdown({
      listener,
      runManager,
      lock,
      socketPath,
      logger: null,
    });

    await Promise.all([shutdown("SIGTERM"), shutdown("SIGINT")]);
    expect(stopCalled).toBe(1);
    expect(shutdownCalled).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Probe a few large pids until one is not currently alive. There is no
 * portable way to guarantee a pid is dead, but pids near the kernel maximum
 * are overwhelmingly unlikely to be in use on a developer box and CI.
 */
function pickLikelyDeadPid(): number {
  for (const candidate of [4194300, 4194301, 4194302, 4194303]) {
    if (!isProcessAlive(candidate)) return candidate;
  }
  // Fallback: pid 0 is never valid and is always rejected by kill(0), but the
  // acquireLock code only treats positive pids as live, so a 0 here would be
  // mis-handled. Use a very high default instead.
  return 4194303;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "EPERM"
    )
      return true;
    return false;
  }
}
