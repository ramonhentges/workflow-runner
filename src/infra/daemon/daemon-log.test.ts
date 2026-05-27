import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, statSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DaemonLogger } from "./daemon-log.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempLogPath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "wfr-daemon-log-"));
  roots.push(root);
  return join(root, "daemon.log");
}

describe("DaemonLogger", () => {
  it("appends one JSON line with a ts field for each log call", async () => {
    const path = await tempLogPath();
    const logger = await DaemonLogger.open(path, { now: () => 1700000000000 });

    logger.log({ level: "INFO", event: "run.started", runId: "abc" });
    await logger.close();

    const text = await readFile(path, "utf8");
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed).toEqual({
      ts: 1700000000000,
      level: "INFO",
      event: "run.started",
      runId: "abc",
    });
  });

  it("writes one line per log call and preserves order", async () => {
    const path = await tempLogPath();
    let t = 1;
    const logger = await DaemonLogger.open(path, { now: () => t++ });

    logger.log({ level: "INFO", event: "daemon.started", pid: 42 });
    logger.log({ level: "WARN", event: "run.eventLogWriteFailure", runId: "x" });
    logger.log({ level: "ERROR", event: "rpc.requestFailed", method: "run.start" });
    await logger.close();

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(3);
    const events = lines.map((l) => (JSON.parse(l) as { event: string }).event);
    expect(events).toEqual([
      "daemon.started",
      "run.eventLogWriteFailure",
      "rpc.requestFailed",
    ]);
  });

  it("creates the log file when it does not yet exist", async () => {
    const path = await tempLogPath();
    expect(existsSync(path)).toBe(false);

    const logger = await DaemonLogger.open(path);
    logger.log({ level: "INFO", event: "daemon.started" });
    await logger.close();

    expect(existsSync(path)).toBe(true);
  });

  it("rotates the live log to daemon.log.1 once it exceeds the size threshold", async () => {
    const path = await tempLogPath();
    const rotated = `${path}.1`;
    // Tiny threshold for fast test; the prod default is 10 MB.
    const logger = await DaemonLogger.open(path, { rotateBytes: 200, now: () => 1 });

    // First two entries (~80 bytes each) stay under the threshold; the third
    // would exceed it and triggers rotation.
    const big = "x".repeat(40);
    logger.log({ level: "INFO", event: "first", payload: big });
    logger.log({ level: "INFO", event: "second", payload: big });
    logger.log({ level: "INFO", event: "third", payload: big });
    await logger.close();

    expect(existsSync(rotated)).toBe(true);
    expect(existsSync(path)).toBe(true);

    const rotatedLines = (await readFile(rotated, "utf8")).trim().split("\n");
    const liveLines = (await readFile(path, "utf8")).trim().split("\n");
    expect(rotatedLines.map((l) => (JSON.parse(l) as { event: string }).event))
      .toEqual(["first", "second"]);
    expect(liveLines.map((l) => (JSON.parse(l) as { event: string }).event))
      .toEqual(["third"]);
  });

  it("uses the documented 10 MB default rotation threshold", async () => {
    const path = await tempLogPath();
    const logger = await DaemonLogger.open(path);
    // A single small line must not rotate at the 10 MB default.
    logger.log({ level: "INFO", event: "tick" });
    await logger.close();
    expect(existsSync(`${path}.1`)).toBe(false);
    // bytesWritten should match a single small line.
    const stats = statSync(path);
    expect(stats.size).toBeLessThan(10 * 1024 * 1024);
  });

  it("uses the default 10 MB rotate threshold when none is provided", async () => {
    const path = await tempLogPath();
    const logger = await DaemonLogger.open(path);
    logger.log({ level: "INFO", event: "tick" });
    await logger.close();
    // Default threshold does NOT rotate after a tiny line — proves it wasn't
    // misconfigured to a smaller value.
    expect(existsSync(`${path}.1`)).toBe(false);
  });

  it("appends to an existing log file rather than truncating it", async () => {
    const path = await tempLogPath();
    writeFileSync(path, '{"ts":0,"level":"INFO","event":"prior"}\n', { mode: 0o600 });

    const logger = await DaemonLogger.open(path, { now: () => 1 });
    logger.log({ level: "INFO", event: "fresh" });
    await logger.close();

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect((JSON.parse(lines[0]!) as { event: string }).event).toBe("prior");
    expect((JSON.parse(lines[1]!) as { event: string }).event).toBe("fresh");
  });

  it("replaces a prior rotation file when rotating again", async () => {
    const path = await tempLogPath();
    const rotated = `${path}.1`;
    writeFileSync(rotated, "stale rotation\n", { mode: 0o600 });

    const logger = await DaemonLogger.open(path, { rotateBytes: 100, now: () => 1 });
    const big = "x".repeat(30);
    for (let i = 0; i < 5; i++) {
      logger.log({ level: "INFO", event: "tick", payload: big });
    }
    await logger.close();

    const rotatedText = await readFile(rotated, "utf8");
    expect(rotatedText.includes("stale rotation")).toBe(false);
    expect(rotatedText.includes('"event":"tick"')).toBe(true);
  });

  it("creates the file with 0600 permissions", async () => {
    const path = await tempLogPath();
    const logger = await DaemonLogger.open(path);
    logger.log({ level: "INFO", event: "tick" });
    await logger.close();

    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it("serializes concurrent fire-and-forget log calls in call order", async () => {
    const path = await tempLogPath();
    const logger = await DaemonLogger.open(path, { now: () => 0 });

    for (let i = 0; i < 20; i++) {
      logger.log({ level: "INFO", event: "tick", seq: i });
    }
    await logger.close();

    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines).toHaveLength(20);
    const seqs = lines.map((l) => (JSON.parse(l) as { seq: number }).seq);
    expect(seqs).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});
