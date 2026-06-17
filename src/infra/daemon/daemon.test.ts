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
  DEFAULT_BIND_HOST,
  acquireLock,
  assertLoopbackBind,
  bindSocket,
  makeShutdown,
  releaseLock,
  resolveApiPort,
  resolveBindHost,
  warnNonLoopbackBind,
  writeDiscoveryFile,
  type AcquiredLock,
} from "./daemon.js";
import type { DaemonLogRecord } from "./daemon-log.js";
import { DEFAULT_API_PORT } from "../../app/api/security.js";

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
// resolveApiPort
// ---------------------------------------------------------------------------

describe("resolveApiPort", () => {
  it("returns the explicit opt.apiPort when provided, ignoring env", () => {
    const port = resolveApiPort({ apiPort: 5000 }, { WORKFLOW_RUNNER_API_PORT: "9999" });
    expect(port).toBe(5000);
  });

  it("returns the WORKFLOW_RUNNER_API_PORT env value when no opt is given", () => {
    const port = resolveApiPort({}, { WORKFLOW_RUNNER_API_PORT: "6000" });
    expect(port).toBe(6000);
  });

  it("falls back to DEFAULT_API_PORT when neither opt nor env is set", () => {
    const port = resolveApiPort({}, {});
    expect(port).toBe(DEFAULT_API_PORT);
  });

  it("ignores a non-numeric env value and falls back to DEFAULT_API_PORT", () => {
    const port = resolveApiPort({}, { WORKFLOW_RUNNER_API_PORT: "not-a-port" });
    expect(port).toBe(DEFAULT_API_PORT);
  });

  it("accepts port 0 from env (OS-assigned)", () => {
    const port = resolveApiPort({}, { WORKFLOW_RUNNER_API_PORT: "0" });
    expect(port).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// resolveBindHost
// ---------------------------------------------------------------------------

describe("resolveBindHost", () => {
  it("returns the explicit opts.bindHost when provided, ignoring env", () => {
    const host = resolveBindHost({ bindHost: "0.0.0.0" }, { WORKFLOW_RUNNER_HOST: "192.168.1.1" });
    expect(host).toBe("0.0.0.0");
  });

  it("returns the WORKFLOW_RUNNER_HOST env value when no opt is given", () => {
    const host = resolveBindHost({}, { WORKFLOW_RUNNER_HOST: "192.168.1.100" });
    expect(host).toBe("192.168.1.100");
  });

  it("falls back to DEFAULT_BIND_HOST when neither opt nor env is set", () => {
    const host = resolveBindHost({}, {});
    expect(host).toBe(DEFAULT_BIND_HOST);
  });

  it("ignores an empty-string env value and falls back to default", () => {
    const host = resolveBindHost({}, { WORKFLOW_RUNNER_HOST: "" });
    expect(host).toBe(DEFAULT_BIND_HOST);
  });

  it("accepts 0.0.0.0 as a valid bind host", () => {
    const host = resolveBindHost({ bindHost: "0.0.0.0" }, {});
    expect(host).toBe("0.0.0.0");
  });

  it("accepts an IPv6 address like :: as a valid bind host", () => {
    const host = resolveBindHost({ bindHost: "::" }, {});
    expect(host).toBe("::");
  });
});

// ---------------------------------------------------------------------------
// assertLoopbackBind (no-op since ADR-001)
// ---------------------------------------------------------------------------

describe("assertLoopbackBind", () => {
  it("is a no-op for loopback address", () => {
    expect(() => assertLoopbackBind("127.0.0.1")).not.toThrow();
  });

  it("is a no-op for non-loopback address", () => {
    expect(() => assertLoopbackBind("0.0.0.0")).not.toThrow();
  });

  it("is a no-op for IPv6 address", () => {
    expect(() => assertLoopbackBind("::")).not.toThrow();
  });

  it("is a no-op for empty string", () => {
    expect(() => assertLoopbackBind("")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// warnNonLoopbackBind
// ---------------------------------------------------------------------------

describe("warnNonLoopbackBind", () => {
  it("does not log when bound to 127.0.0.1", () => {
    const logged: DaemonLogRecord[] = [];
    const logger = { log: (rec: DaemonLogRecord) => { logged.push(rec); } };
    warnNonLoopbackBind("127.0.0.1", logger);
    expect(logged.length).toBe(0);
  });

  it("does not log when bound to localhost", () => {
    const logged: DaemonLogRecord[] = [];
    const logger = { log: (rec: DaemonLogRecord) => { logged.push(rec); } };
    warnNonLoopbackBind("localhost", logger);
    expect(logged.length).toBe(0);
  });

  it("does not log when bound to IPv6 loopback ::1", () => {
    const logged: DaemonLogRecord[] = [];
    const logger = { log: (rec: DaemonLogRecord) => { logged.push(rec); } };
    warnNonLoopbackBind("::1", logger);
    expect(logged.length).toBe(0);
  });

  it("logs WARN level for non-loopback hostname", () => {
    const logged: DaemonLogRecord[] = [];
    const logger = { log: (rec: DaemonLogRecord) => { logged.push(rec); } };
    warnNonLoopbackBind("0.0.0.0", logger);
    expect(logged.length).toBe(1);
    expect(logged[0].level).toBe("WARN");
    expect(logged[0].event).toBe("api.bindNonLoopback");
    expect(logged[0].address).toBe("0.0.0.0");
  });

  it("logs WARN level for specific LAN IP", () => {
    const logged: DaemonLogRecord[] = [];
    const logger = { log: (rec: DaemonLogRecord) => { logged.push(rec); } };
    warnNonLoopbackBind("192.168.1.100", logger);
    expect(logged.length).toBe(1);
    expect(logged[0].level).toBe("WARN");
    expect(logged[0].address).toBe("192.168.1.100");
  });

  it("logs WARN level for IPv6 non-loopback", () => {
    const logged: DaemonLogRecord[] = [];
    const logger = { log: (rec: DaemonLogRecord) => { logged.push(rec); } };
    warnNonLoopbackBind("::", logger);
    expect(logged.length).toBe(1);
    expect(logged[0].level).toBe("WARN");
    expect(logged[0].address).toBe("::");
  });

  it("includes a descriptive msg field", () => {
    const logged: DaemonLogRecord[] = [];
    const logger = { log: (rec: DaemonLogRecord) => { logged.push(rec); } };
    warnNonLoopbackBind("0.0.0.0", logger);
    expect(logged[0].msg).toBe("Binding to 0.0.0.0 exposes the daemon to your local network");
  });
});

// ---------------------------------------------------------------------------
// writeDiscoveryFile
// ---------------------------------------------------------------------------

describe("writeDiscoveryFile", () => {
  it("writes daemon.json with the expected content and 0600 permissions", async () => {
    const root = await tempRoot("wfr-discovery-");
    const filePath = join(root, "daemon.json");

    writeDiscoveryFile(filePath, {
      pid: 12345,
      apiPort: 4517,
      socket: "/tmp/daemon.sock",
    });

    expect(existsSync(filePath)).toBe(true);

    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    expect(parsed.pid).toBe(12345);
    expect(parsed.apiPort).toBe(4517);
    expect(parsed.socket).toBe("/tmp/daemon.sock");

    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("overwrites an existing file", async () => {
    const root = await tempRoot("wfr-discovery-overwrite-");
    const filePath = join(root, "daemon.json");

    writeDiscoveryFile(filePath, { pid: 1, apiPort: 4517, socket: "/old" });
    writeDiscoveryFile(filePath, { pid: 2, apiPort: 5000, socket: "/new" });

    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    expect(parsed.pid).toBe(2);
    expect(parsed.apiPort).toBe(5000);
    expect(parsed.socket).toBe("/new");
  });
});

// ---------------------------------------------------------------------------
// makeShutdown — apiServer + discoveryFilePath extensions
// ---------------------------------------------------------------------------

describe("makeShutdown with apiServer and discoveryFilePath", () => {
  it("stops apiServer before the UDS listener and removes the discovery file", async () => {
    const root = await tempRoot("wfr-shutdown-api-");
    const lockPath = join(root, "daemon.lock");
    const socketPath = join(root, "daemon.sock");
    const discoveryFilePath = join(root, "daemon.json");

    const lock = acquireLock(lockPath);
    writeFileSync(socketPath, "", { mode: 0o600 });
    writeFileSync(discoveryFilePath, "{}", { mode: 0o600 });

    const order: string[] = [];

    const apiServer = {
      stop(_closeActiveConnections?: boolean) {
        order.push("apiServer.stop");
      },
    };
    const listener = {
      stop(_closeActiveConnections?: boolean) {
        order.push("listener.stop");
      },
    };
    const runManager = {
      shutdown: async () => {
        order.push("runManager.shutdown");
      },
    };

    const shutdown = makeShutdown({
      listener,
      apiServer,
      discoveryFilePath,
      runManager,
      lock,
      socketPath,
      logger: null,
    });

    await shutdown("SIGTERM");

    // API server must be stopped before the UDS listener.
    expect(order.indexOf("apiServer.stop")).toBeLessThan(order.indexOf("listener.stop"));
    expect(existsSync(discoveryFilePath)).toBe(false);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// makeShutdown — wsDrain ordering and fast-path
// ---------------------------------------------------------------------------

describe("makeShutdown with wsDrain", () => {
  it("calls wsDrain before apiServer.stop and before listener.stop", async () => {
    const root = await tempRoot("wfr-shutdown-wsdrain-");
    const lockPath = join(root, "daemon.lock");
    const socketPath = join(root, "daemon.sock");
    const discoveryFilePath = join(root, "daemon.json");

    const lock = acquireLock(lockPath);
    writeFileSync(socketPath, "", { mode: 0o600 });
    writeFileSync(discoveryFilePath, "{}", { mode: 0o600 });

    const order: string[] = [];
    const logged: Array<Record<string, unknown>> = [];

    const wsDrain = async (_graceMs?: number): Promise<number> => {
      order.push("wsDrain");
      return 3; // simulate 3 connections drained
    };
    const apiServer = {
      stop(_closeActiveConnections?: boolean) {
        order.push("apiServer.stop");
      },
    };
    const listener = {
      stop(_closeActiveConnections?: boolean) {
        order.push("listener.stop");
      },
    };
    const runManager = {
      shutdown: async () => {
        order.push("runManager.shutdown");
      },
    };
    const logger = {
      log: (rec: Record<string, unknown>) => {
        logged.push(rec);
      },
      close: () => {},
    } as unknown as Parameters<typeof makeShutdown>[0]["logger"];

    const shutdown = makeShutdown({
      listener,
      apiServer,
      wsDrain,
      discoveryFilePath,
      runManager,
      lock,
      socketPath,
      logger,
    });

    await shutdown("SIGTERM");

    expect(order.indexOf("wsDrain")).toBeLessThan(order.indexOf("apiServer.stop"));
    expect(order.indexOf("wsDrain")).toBeLessThan(order.indexOf("listener.stop"));
    expect(order.indexOf("apiServer.stop")).toBeLessThan(order.indexOf("listener.stop"));
    expect(order.indexOf("listener.stop")).toBeLessThan(order.indexOf("runManager.shutdown"));

    // api.shutdownDrain must be logged with the returned count.
    const drainLog = logged.find((r) => r.event === "api.shutdownDrain");
    expect(drainLog).toBeDefined();
    expect(drainLog?.drainedCount).toBe(3);

    expect(existsSync(discoveryFilePath)).toBe(false);
    expect(existsSync(socketPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("completes without any grace-period wait when wsDrain returns 0", async () => {
    const root = await tempRoot("wfr-shutdown-wsdrain-zero-");
    const lockPath = join(root, "daemon.lock");
    const socketPath = join(root, "daemon.sock");

    const lock = acquireLock(lockPath);
    writeFileSync(socketPath, "", { mode: 0o600 });

    let drainCalled = false;
    const wsDrain = async (_graceMs?: number): Promise<number> => {
      drainCalled = true;
      return 0;
    };
    const listener = { stop(_?: boolean) {} };
    const runManager = { shutdown: async () => {} };

    const shutdown = makeShutdown({
      listener,
      wsDrain,
      runManager,
      lock,
      socketPath,
      logger: null,
    });

    const t0 = Date.now();
    await shutdown("SIGTERM");
    const elapsed = Date.now() - t0;

    expect(drainCalled).toBe(true);
    // The drain mock returns 0 immediately — no 200ms grace wait.
    expect(elapsed).toBeLessThan(150);
  });

  it("is idempotent when wsDrain is provided", async () => {
    const root = await tempRoot("wfr-shutdown-wsdrain-idem-");
    const lockPath = join(root, "daemon.lock");
    const socketPath = join(root, "daemon.sock");

    const lock = acquireLock(lockPath);

    let drainCalls = 0;
    const wsDrain = async (_graceMs?: number): Promise<number> => {
      drainCalls++;
      return 0;
    };
    const listener = { stop(_?: boolean) {} };
    const runManager = { shutdown: async () => {} };

    const shutdown = makeShutdown({
      listener,
      wsDrain,
      runManager,
      lock,
      socketPath,
      logger: null,
    });

    await shutdown("SIGTERM");
    await shutdown("SIGINT"); // second invocation must be a no-op

    expect(drainCalls).toBe(1);
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
