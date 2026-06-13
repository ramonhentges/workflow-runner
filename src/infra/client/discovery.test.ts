import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DISCOVERY_FILENAME,
  isProcessAlive,
  readDiscoveryFile,
  runningDaemon,
} from "./discovery.js";

function withTmp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "wfr-discovery-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function writeDiscovery(dir: string, content: unknown): void {
  writeFileSync(join(dir, DISCOVERY_FILENAME), JSON.stringify(content), "utf8");
}

describe("readDiscoveryFile", () => {
  it("returns the parsed record for a valid daemon.json", () => {
    withTmp((dir) => {
      writeDiscovery(dir, { pid: 1234, apiPort: 4517, socket: "/x/daemon.sock" });
      expect(readDiscoveryFile(dir)).toEqual({
        pid: 1234,
        apiPort: 4517,
        socket: "/x/daemon.sock",
      });
    });
  });

  it("returns null when the file is missing", () => {
    withTmp((dir) => {
      expect(readDiscoveryFile(dir)).toBeNull();
    });
  });

  it("returns null for malformed JSON or a schema mismatch", () => {
    withTmp((dir) => {
      writeFileSync(join(dir, DISCOVERY_FILENAME), "{ not json", "utf8");
      expect(readDiscoveryFile(dir)).toBeNull();
    });
    withTmp((dir) => {
      writeDiscovery(dir, { pid: "nope" });
      expect(readDiscoveryFile(dir)).toBeNull();
    });
  });
});

describe("isProcessAlive", () => {
  it("is true for the current process", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("is false for an almost-certainly-dead pid", () => {
    expect(isProcessAlive(2_147_483_646)).toBe(false);
  });
});

describe("runningDaemon", () => {
  it("returns the record when the recorded pid is alive", () => {
    withTmp((dir) => {
      writeDiscovery(dir, { pid: process.pid, apiPort: 4517, socket: "/x" });
      expect(runningDaemon(dir)?.pid).toBe(process.pid);
    });
  });

  it("returns null when the recorded pid is dead (stale file)", () => {
    withTmp((dir) => {
      writeDiscovery(dir, { pid: 2_147_483_646, apiPort: 4517, socket: "/x" });
      expect(runningDaemon(dir)).toBeNull();
    });
  });
});
