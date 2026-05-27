import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";

import { startDaemonHarness } from "./harness.js";

describe("harness", () => {
  test("spawns daemon, client connects, cleanup removes temp dir", async () => {
    const h = await startDaemonHarness();
    expect(existsSync(h.socketPath)).toBe(true);

    const psResult = await h.client.call("run.ps", {});
    expect(psResult.runs).toEqual([]);

    await h.cleanup();

    expect(existsSync(h.storageRoot)).toBe(false);
    expect(h.daemon.exitCode).not.toBeNull();
  });
});
