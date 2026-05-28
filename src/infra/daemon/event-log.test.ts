import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { asStepId, type StepId } from "../../domain/ids.js";
import type { RunnerEvent } from "../../domain/runner.js";
import type { Step } from "../../domain/workflow.js";
import {
  EVENT_LOG_RING_LIMIT,
  EVENT_LOG_ROTATE_BYTES,
  EventLog,
  EventLogWriteError,
  type EventLogEntry,
} from "./event-log.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("EventLog", () => {
  it("filters thought streams without writing to disk or ring buffer", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    const result = await log.append(
      { type: "stream", kind: "thought", chunk: "x" },
      asStepId("step-1"),
    );

    expect(result).toBeNull();
    expect(await lines(runDir)).toEqual([]);
    expect(log.currentStepBacklog(asStepId("step-1"))).toBeNull();
    await log.close();
  });

  it("appends message stream events with seq 1 and writes one JSONL line", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    const entry = await log.append(
      { type: "stream", kind: "message", chunk: "x" },
      asStepId("step-1"),
    );

    expect(entry).toMatchObject({
      seq: 1,
      stepId: "step-1",
      event: { type: "stream", kind: "message", chunk: "x" },
    });
    expect(entry?.ts).toBeNumber();
    expect(await lines(runDir)).toHaveLength(1);
    expect(JSON.parse((await lines(runDir))[0]!)).toEqual(entry);
    await log.close();
  });

  it("assigns monotonic sequence numbers", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    const entries = await Promise.all([
      log.append(logEvent("one"), asStepId("step-1")),
      log.append(logEvent("two"), asStepId("step-1")),
      log.append(logEvent("three"), asStepId("step-1")),
    ]);

    expect(entries.map((entry) => entry?.seq)).toEqual([1, 2, 3]);
    await log.close();
  });

  it("keeps the newest 1000 entries in memory while disk keeps all appended entries", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);
    await log.append(bannerEvent("step-1"), asStepId("step-1"));

    for (let index = 1; index < EVENT_LOG_RING_LIMIT; index++) {
      await log.append(logEvent(`log-${index}`), asStepId("step-1"));
    }

    expect(log.currentStepBacklog(asStepId("step-1"))).toHaveLength(
      EVENT_LOG_RING_LIMIT,
    );

    await log.append(logEvent("log-1000"), asStepId("step-1"));

    expect(log.currentStepBacklog(asStepId("step-1"))).toBeNull();
    expect(await lines(runDir)).toHaveLength(EVENT_LOG_RING_LIMIT + 1);
    await log.close();
  });

  it("resets the ring buffer when a banner is appended while preserving disk history", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    await log.append(bannerEvent("step-1"), asStepId("step-1"));
    await log.append(logEvent("old"), asStepId("step-1"));
    const banner = expectEntry(
      await log.append(bannerEvent("step-2"), asStepId("step-2")),
    );

    expect(log.currentStepBacklog(asStepId("step-2"))).toEqual([banner]);
    expect(log.currentStepBacklog(asStepId("step-1"))).toBeNull();
    expect(await lines(runDir)).toHaveLength(3);
    await log.close();
  });

  it("returns the current step backlog from the latest matching banner", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    await log.append(bannerEvent("step-1"), asStepId("step-1"));
    await log.append(logEvent("step-1 a"), asStepId("step-1"));
    await log.append(logEvent("step-1 b"), asStepId("step-1"));
    const banner = expectEntry(
      await log.append(bannerEvent("step-2"), asStepId("step-2")),
    );
    const trailing = expectEntry(
      await log.append(logEvent("step-2 a"), asStepId("step-2")),
    );

    expect(log.currentStepBacklog(asStepId("step-2"))).toEqual([
      banner,
      trailing,
    ]);
    expect(log.currentStepBacklog(asStepId("step-1"))).toBeNull();
    await log.close();
  });

  it("reads the current step backlog from disk fallback in forward order", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    await log.append(bannerEvent("step-1"), asStepId("step-1"));
    await log.append(logEvent("step-1 a"), asStepId("step-1"));
    const banner = expectEntry(
      await log.append(bannerEvent("step-2"), asStepId("step-2")),
    );
    const trailing = expectEntry(
      await log.append(logEvent("step-2 a"), asStepId("step-2")),
    );

    expect(await log.readBackwardForCurrentStep(asStepId("step-2"))).toEqual([
      banner,
      trailing,
    ]);
    await log.close();
  });

  it("reads current step backlog across a rotation boundary", async () => {
    const runDir = await tempRunDir();
    // Use a tiny threshold so the first append fills it; rotation fires before step-2 banner.
    const log = await EventLog.open(runDir, 1);

    await log.append(bannerEvent("step-1"), asStepId("step-1"));
    await log.append(logEvent("old"), asStepId("step-1"));
    const banner = expectEntry(
      await log.append(bannerEvent("step-2"), asStepId("step-2")),
    );
    const trailing = expectEntry(
      await log.append(logEvent("new"), asStepId("step-2")),
    );

    expect(await log.readBackwardForCurrentStep(asStepId("step-2"))).toEqual([
      banner,
      trailing,
    ]);
    expect(existsSync(join(runDir, "events.1.jsonl"))).toBe(true);
    await log.close();
  });

  it("continues sequence numbering after close and reopen", async () => {
    const runDir = await tempRunDir();
    const first = await EventLog.open(runDir);
    await first.append(logEvent("one"), asStepId("step-1"));
    await first.append(logEvent("two"), asStepId("step-1"));
    await first.close();

    const second = await EventLog.open(runDir);
    const entry = await second.append(logEvent("three"), asStepId("step-1"));

    expect(entry?.seq).toBe(3);
    await second.close();
  });

  it("rotates active events.jsonl to the lowest unused rotation before appending", async () => {
    const runDir = await tempRunDir();
    await writeFile(join(runDir, "events.1.jsonl"), "");

    // Pre-populate events.jsonl with a valid entry so the byte counter is non-zero on reopen.
    const firstLog = await EventLog.open(runDir);
    await firstLog.append(logEvent("pre"), asStepId("step-1"));
    await firstLog.close();

    // Reopen with a tiny threshold; stat on open sees the non-empty file and rotation fires.
    const log = await EventLog.open(runDir, 1);
    const entry = await log.append(logEvent("fresh"), asStepId("step-1"));

    expect(existsSync(join(runDir, "events.1.jsonl"))).toBe(true);
    expect(existsSync(join(runDir, "events.2.jsonl"))).toBe(true);
    const activeLines = await lines(runDir);
    expect(activeLines).toHaveLength(1);
    expect(JSON.parse(activeLines[0]!)).toEqual(entry);
    await log.close();
  });

  it("throws a typed error when append cannot rotate the active log", async () => {
    const runDir = await tempRunDir();

    // Pre-populate so the byte counter is non-zero on reopen with tiny threshold.
    const firstLog = await EventLog.open(runDir);
    await firstLog.append(logEvent("pre"), asStepId("step-1"));
    await firstLog.close();

    const log = await EventLog.open(runDir, 1);
    await chmod(runDir, 0o500);

    try {
      await expect(
        log.append(logEvent("cannot rotate"), asStepId("step-1")),
      ).rejects.toBeInstanceOf(EventLogWriteError);
    } finally {
      await chmod(runDir, 0o700);
    }
    await log.close();
  });

  it("throws a typed error when appending after close", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);
    await log.close();

    await expect(
      log.append(logEvent("closed"), asStepId("step-1")),
    ).rejects.toBeInstanceOf(EventLogWriteError);
  });
});

async function tempRunDir(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "workflow-runner-event-log-"));
  roots.push(root);
  await chmod(root, 0o700);
  return root;
}

async function lines(runDir: string): Promise<string[]> {
  const text = await Bun.file(join(runDir, "events.jsonl")).text();
  return text.split("\n").filter(Boolean);
}

function logEvent(message: string): RunnerEvent {
  return { type: "log", message };
}

function bannerEvent(stepId: StepId): RunnerEvent {
  return { type: "banner", step: step(stepId), index: 1 };
}

function step(id: StepId): Step {
  return {
    id,
    agent: "agent/AGENT",
    model: "opencode/model",
    mode: "autonomous",
    description: `Step ${id}`,
    ide: "opencode",
    edges: [],
  };
}

function expectEntry(entry: EventLogEntry | null): EventLogEntry {
  expect(entry).not.toBeNull();
  return entry!;
}
