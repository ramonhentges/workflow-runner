import { describe, expect, it } from "bun:test";

import * as daemon from "./daemon.js";

function makeStream() {
  const chunks: string[] = [];
  return { chunks, write: (s: string) => chunks.push(s) };
}

describe("daemon.run", () => {
  it("invokes the injected runDaemon exactly once and returns 0 by default", async () => {
    let calls = 0;
    const stderr = makeStream();

    const code = await daemon.run([], {
      runDaemon: async () => {
        calls += 1;
      },
      stderr,
    });

    expect(code).toBe(0);
    expect(calls).toBe(1);
    expect(stderr.chunks.join("")).toBe("");
  });

  it("propagates a numeric exit code returned by runDaemon", async () => {
    const stderr = makeStream();
    const code = await daemon.run([], {
      runDaemon: async () => 42,
      stderr,
    });
    expect(code).toBe(42);
    expect(stderr.chunks.join("")).toBe("");
  });

  it("on runDaemon throwing: prints the error to stderr and returns 1", async () => {
    const stderr = makeStream();
    const code = await daemon.run([], {
      runDaemon: async () => {
        throw new Error("lock contested");
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("lock contested");
  });

  it("forwards --api-port and --storage-root to runDaemon", async () => {
    let received: { apiPort?: number; storageRoot?: string } | undefined;
    const stderr = makeStream();
    const code = await daemon.run(
      ["--api-port", "5005", "--storage-root", "/var/store"],
      {
        runDaemon: async (opts) => {
          received = opts;
        },
        stderr,
      },
    );
    expect(code).toBe(0);
    expect(received).toEqual({ apiPort: 5005, storageRoot: "/var/store" });
  });

  it("rejects unexpected arguments without spinning up the daemon", async () => {
    let calls = 0;
    const stderr = makeStream();
    const code = await daemon.run(["--bogus"], {
      runDaemon: async () => {
        calls += 1;
      },
      stderr,
    });
    expect(code).toBe(1);
    expect(calls).toBe(0);
    expect(stderr.chunks.join("")).toContain("--bogus");
  });
});

// ---------------------------------------------------------------------------
// Lifecycle subcommands: start / stop / status / restart
// ---------------------------------------------------------------------------

interface FakeClient {
  call: (method: string, params: unknown) => Promise<unknown>;
  close: () => Promise<void>;
}

const REC = { pid: 4242, apiPort: 4517, socket: "/x/daemon.sock" } as const;

/** A runningDaemon stub that returns each queued value on successive calls. */
function queuedRunning(values: Array<typeof REC | null>) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? null;
}

describe("daemon start", () => {
  it("reports already-running and does not connect", async () => {
    const stdout = makeStream();
    let connected = false;
    const code = await daemon.run(["start"], {
      runningDaemon: () => REC,
      connect: (async () => {
        connected = true;
        return {} as never;
      }) as never,
      stdout,
    });
    expect(code).toBe(0);
    expect(connected).toBe(false);
    expect(stdout.chunks.join("")).toContain("already running (pid 4242, port 4517)");
  });

  it("connects (auto-spawns) when down and reports the started daemon", async () => {
    const stdout = makeStream();
    let closed = false;
    const client: FakeClient = {
      call: async () => ({}),
      close: async () => {
        closed = true;
      },
    };
    const code = await daemon.run(["start"], {
      runningDaemon: queuedRunning([null, REC]),
      connect: (async () => client) as never,
      stdout,
    });
    expect(code).toBe(0);
    expect(closed).toBe(true);
    expect(stdout.chunks.join("")).toContain("daemon started (pid 4242, port 4517)");
  });

  it("returns 1 when the daemon never becomes reachable", async () => {
    const stderr = makeStream();
    const code = await daemon.run(["start"], {
      runningDaemon: () => null,
      connect: (async () => {
        throw new Error("did not become reachable");
      }) as never,
      stderr,
    });
    expect(code).toBe(1);
    expect(stderr.chunks.join("")).toContain("failed to start daemon");
  });
});

describe("daemon stop", () => {
  it("is a no-op when no daemon is running", async () => {
    const stdout = makeStream();
    let connected = false;
    const code = await daemon.run(["stop"], {
      runningDaemon: () => null,
      connect: (async () => {
        connected = true;
        return {} as never;
      }) as never,
      stdout,
    });
    expect(code).toBe(0);
    expect(connected).toBe(false);
    expect(stdout.chunks.join("")).toContain("not running");
  });

  it("requests graceful shutdown over the socket and waits for exit", async () => {
    const stdout = makeStream();
    const calls: string[] = [];
    const client: FakeClient = {
      call: async (method) => {
        calls.push(method);
        return {};
      },
      close: async () => {},
    };
    // Alive for the running() pre-check is via runningDaemon; the poll uses
    // isProcessAlive — return false so the process is considered already exited.
    const code = await daemon.run(["stop"], {
      runningDaemon: () => REC,
      connect: (async () => client) as never,
      isProcessAlive: () => false,
      stdout,
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["daemon.shutdown"]);
    expect(stdout.chunks.join("")).toContain("daemon stopped (pid 4242)");
  });

  it("falls back to SIGTERM when the socket is unreachable", async () => {
    const stdout = makeStream();
    const signals: Array<[number, string]> = [];
    let aliveChecks = 0;
    const code = await daemon.run(["stop"], {
      runningDaemon: () => REC,
      connect: (async () => {
        throw new Error("ECONNREFUSED");
      }) as never,
      // Alive once (triggers the SIGTERM fallback), then exited.
      isProcessAlive: () => aliveChecks++ < 1,
      kill: (pid, signal) => {
        signals.push([pid, signal]);
      },
      sleep: async () => {},
      stdout,
    });
    expect(code).toBe(0);
    expect(signals).toEqual([[4242, "SIGTERM"]]);
    expect(stdout.chunks.join("")).toContain("daemon stopped (pid 4242)");
  });

  it("escalates to SIGKILL and returns 1 if the daemon never exits", async () => {
    const stderr = makeStream();
    const signals: string[] = [];
    let clock = 0;
    const code = await daemon.run(["stop"], {
      runningDaemon: () => REC,
      connect: (async () => ({ call: async () => ({}), close: async () => {} })) as never,
      isProcessAlive: () => true, // never dies
      kill: (_pid, signal) => {
        signals.push(signal);
      },
      sleep: async () => {},
      now: () => (clock += 5000), // crosses the 10s grace window
      stderr,
    });
    expect(code).toBe(1);
    expect(signals).toContain("SIGKILL");
    expect(stderr.chunks.join("")).toContain("did not stop");
  });
});

describe("daemon status", () => {
  it("reports a running daemon and exits 0", async () => {
    const stdout = makeStream();
    const code = await daemon.run(["status"], { runningDaemon: () => REC, stdout });
    expect(code).toBe(0);
    expect(stdout.chunks.join("")).toContain("daemon running (pid 4242, port 4517)");
  });

  it("reports a stopped daemon and exits 3", async () => {
    const stdout = makeStream();
    const code = await daemon.run(["status"], { runningDaemon: () => null, stdout });
    expect(code).toBe(3);
    expect(stdout.chunks.join("")).toContain("daemon not running");
  });
});

describe("daemon restart", () => {
  it("stops (no-op when down) then starts the daemon", async () => {
    const stdout = makeStream();
    const client: FakeClient = { call: async () => ({}), close: async () => {} };
    // stop sees nothing running; start sees nothing, then the freshly started daemon.
    const code = await daemon.run(["restart"], {
      runningDaemon: queuedRunning([null, null, REC]),
      connect: (async () => client) as never,
      stdout,
    });
    expect(code).toBe(0);
    const out = stdout.chunks.join("");
    expect(out).toContain("not running");
    expect(out).toContain("daemon started (pid 4242, port 4517)");
  });
});
