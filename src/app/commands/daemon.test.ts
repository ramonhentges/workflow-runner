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
