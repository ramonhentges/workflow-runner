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
  EVENT_LOG_BACKLOG_LIMIT,
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

  it("persists tool_call events and replays them via backlog after a banner", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    const banner = expectEntry(
      await log.append(bannerEvent("step-1"), asStepId("step-1")),
    );
    const pending = expectEntry(
      await log.append(toolCallEvent("call-1", "pending"), asStepId("step-1")),
    );
    const inProgress = expectEntry(
      await log.append(
        toolCallEvent("call-1", "in_progress"),
        asStepId("step-1"),
      ),
    );
    const completed = expectEntry(
      await log.append(toolCallEvent("call-1", "completed"), asStepId("step-1")),
    );

    // All three lifecycle events persist alongside the banner (no filtering).
    expect(await lines(runDir)).toHaveLength(4);
    expect(log.currentStepBacklog(asStepId("step-1"))).toEqual([
      banner,
      pending,
      inProgress,
      completed,
    ]);
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

  it("rotates to max index + 1 when older rotated files have been deleted (non-contiguous gaps)", async () => {
    const runDir = await tempRunDir();
    // Pre-populate with non-contiguous rotation files: skip events.2.jsonl
    await writeFile(join(runDir, "events.1.jsonl"), "");
    await writeFile(join(runDir, "events.3.jsonl"), "");

    // Pre-populate events.jsonl with a valid entry so the byte counter is non-zero on reopen.
    const firstLog = await EventLog.open(runDir);
    await firstLog.append(logEvent("pre"), asStepId("step-1"));
    await firstLog.close();

    // Reopen with a tiny threshold; rotation should use index 4 (max 3 + 1), not 2 (first gap).
    const log = await EventLog.open(runDir, 1);
    const entry = await log.append(logEvent("fresh"), asStepId("step-1"));

    expect(existsSync(join(runDir, "events.1.jsonl"))).toBe(true);
    expect(existsSync(join(runDir, "events.3.jsonl"))).toBe(true);
    expect(existsSync(join(runDir, "events.4.jsonl"))).toBe(true);
    expect(existsSync(join(runDir, "events.2.jsonl"))).toBe(false);
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

  it("reads all events with seq > fromSeq for resume", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    await log.append(logEvent("one"), asStepId("step-1"));
    await log.append(logEvent("two"), asStepId("step-1"));
    const fromSeq = 2;
    const entry3 = expectEntry(
      await log.append(logEvent("three"), asStepId("step-1")),
    );
    const entry4 = expectEntry(
      await log.append(logEvent("four"), asStepId("step-1")),
    );

    const { entries: resumed, truncated } = await log.readEventsSince(fromSeq);

    expect(resumed).toEqual([entry3, entry4]);
    expect(resumed.map((e) => e.seq)).toEqual([3, 4]);
    expect(truncated).toBe(false);
    await log.close();
  });

  it("returns empty array when fromSeq >= latest seq", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    await log.append(logEvent("one"), asStepId("step-1"));
    await log.append(logEvent("two"), asStepId("step-1"));

    const { entries, truncated } = await log.readEventsSince(2);

    expect(entries).toEqual([]);
    expect(truncated).toBe(false);
    await log.close();
  });

  it("reads events from rotated files for resume across rotation boundary", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir, 1);

    const entry1 = expectEntry(
      await log.append(logEvent("one"), asStepId("step-1")),
    );
    const entry2 = expectEntry(
      await log.append(logEvent("two"), asStepId("step-1")),
    );

    const { entries: resumed, truncated } = await log.readEventsSince(1);

    expect(resumed.map((e) => e.seq)).toEqual([2]);
    expect(resumed[0]).toEqual(entry2);
    expect(truncated).toBe(false);
    await log.close();
  });

  it("uses fast path when fromSeq is within the ring buffer", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    // Append initial entries to warm up the log.
    for (let i = 1; i <= 100; i++) {
      await log.append(logEvent(`log-${i}`), asStepId("step-1"));
    }

    // Banner clears the ring; subsequent entries start fresh.
    const banner = expectEntry(
      await log.append(bannerEvent("step-2"), asStepId("step-2")),
    );
    const postBannerEntries = [banner];

    // Append a handful of new entries after the banner.
    for (let i = 1; i <= 10; i++) {
      const entry = expectEntry(
        await log.append(logEvent(`new-${i}`), asStepId("step-2")),
      );
      postBannerEntries.push(entry);
    }

    // fromSeq=100 is below the ring (ring starts at seq 101).
    // Fast path condition: ring[0].seq (101) <= fromSeq + 1 (101) → true.
    // This should return only entries from the ring that are > 100.
    const { entries: resumed, truncated } = await log.readEventsSince(100);

    // The result should be the banner and the 10 post-banner entries (seqs 101-111).
    expect(resumed.map((e) => e.seq)).toEqual(postBannerEntries.map((e) => e.seq));
    expect(truncated).toBe(false);
    await log.close();
  });

  it("uses slow path when fromSeq is below evicted ring entries", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    const allEntries = [];
    // Append >1000 entries to cause ring eviction; ring only keeps the last 1000.
    for (let i = 1; i <= EVENT_LOG_RING_LIMIT + 100; i++) {
      const entry = await log.append(logEvent(`log-${i}`), asStepId("step-1"));
      if (entry) allEntries.push(entry);
    }

    // Ring now holds seqs 101-1100; try to read from seq 50 (evicted to disk).
    // Fast path condition: ring[0].seq (101) <= fromSeq + 1 (51) → false.
    // This forces the slow path to read from disk.
    const fromSeq = 50;
    const { entries: resumed, truncated } = await log.readEventsSince(fromSeq);

    // Verify we get ALL entries after 50, including disk-resident ones (51-100).
    expect(resumed.length).toBe(1050); // seqs 51..1100
    expect(resumed[0]!.seq).toBe(51);
    expect(resumed[resumed.length - 1]!.seq).toBe(1100);
    expect(truncated).toBe(false); // 1050 entries is well below the 10000 cap

    // Verify contiguity: each seq increases by 1.
    for (let i = 1; i < resumed.length; i++) {
      expect(resumed[i]!.seq).toBe(resumed[i - 1]!.seq + 1);
    }
    await log.close();
  });

  it("correctly reads evicted entries from disk when fromSeq precedes ring", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    const allEntries = [];
    // Append >1000 entries to cause ring eviction; ring only keeps the last 1000.
    for (let i = 1; i <= 1500; i++) {
      const entry = await log.append(logEvent(`log-${i}`), asStepId("step-1"));
      if (entry) allEntries.push(entry);
    }

    // Ring now holds seqs 501-1500; try to read from seq 100 (evicted to disk).
    // This would incorrectly return ring[501..1500] if the condition were inverted.
    const fromSeq = 100;
    const { entries: resumed, truncated } = await log.readEventsSince(fromSeq);

    // Verify we get ALL entries after 100, not just the ring entries.
    expect(resumed.length).toBe(1400); // seqs 101..1500
    expect(resumed[0]!.seq).toBe(101);
    expect(resumed[resumed.length - 1]!.seq).toBe(1500);
    expect(truncated).toBe(false); // 1400 entries is well below the 10000 cap
    // Verify contiguity: each seq increases by 1.
    for (let i = 1; i < resumed.length; i++) {
      expect(resumed[i]!.seq).toBe(resumed[i - 1]!.seq + 1);
    }
    await log.close();
  });

  it("skips rotated files with entries older than fromSeq", async () => {
    const runDir = await tempRunDir();
    // Tiny threshold to trigger rotation after first append.
    const log = await EventLog.open(runDir, 1);

    const entries = [];
    // First append triggers rotation; subsequent appends go to active file.
    for (let i = 1; i <= 10; i++) {
      const entry = await log.append(logEvent(`log-${i}`), asStepId("step-1"));
      if (entry) entries.push(entry);
    }

    // fromSeq is in the middle; should skip the rotated file and only read active.
    const { entries: resumed, truncated } = await log.readEventsSince(5);

    expect(resumed.length).toBeLessThanOrEqual(5); // seq 6-10
    expect(resumed.every((e) => e.seq > 5)).toBe(true);
    expect(truncated).toBe(false);
    await log.close();
  });

  it("flush awaits pending writes so they are visible to subsequent disk reads", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    // Fire an append without awaiting it — entry is queued on #writeChain.
    const appendPromise = log.append(logEvent("inflight"), asStepId("step-1"));

    // flush() must resolve only after the append completes.
    await log.flush();

    // The entry must now be on disk.
    const written = await lines(runDir);
    expect(written).toHaveLength(1);

    await appendPromise; // ensure no dangling promise
    await log.close();
  });

  it("applies the backlog cap during readEventsSince to prevent OOM", async () => {
    const runDir = await tempRunDir();
    const log = await EventLog.open(runDir);

    // Append entries up to and beyond the ring limit (which is small; the backlog cap is much larger).
    // This tests that the cap prevents unbounded growth without requiring 10k appends.
    for (let i = 1; i <= EVENT_LOG_RING_LIMIT + 100; i++) {
      await log.append(logEvent(`log-${i}`), asStepId("step-1"));
    }

    // 1100 entries is well below the cap; returned as-is with truncated: false.
    const { entries, truncated } = await log.readEventsSince(0);
    expect(entries.length).toBeLessThanOrEqual(EVENT_LOG_BACKLOG_LIMIT);
    expect(truncated).toBe(false);
    await log.close();
  });

  it("returns truncated:true when readEventsSince exceeds EVENT_LOG_BACKLOG_LIMIT", async () => {
    const runDir = await tempRunDir();

    // Write entries across two files so the cap fires cleanly at a file boundary:
    // - events.1.jsonl: exactly EVENT_LOG_BACKLOG_LIMIT entries  (triggers the cap)
    // - events.jsonl:   1 more entry                             (never reached)
    // The EventLog reads files fresh on each readEventsSince call, so externally
    // written entries are visible without going through the append path.
    function makeLines(from: number, to: number): string {
      const out: string[] = [];
      for (let i = from; i <= to; i++) {
        out.push(
          JSON.stringify({
            seq: i,
            ts: 1_000_000 + i,
            stepId: "step-1",
            event: { type: "log", message: `log-${i}` },
          }),
        );
      }
      return out.join("\n") + "\n";
    }

    await writeFile(
      join(runDir, "events.1.jsonl"),
      makeLines(1, EVENT_LOG_BACKLOG_LIMIT),
      "utf8",
    );
    await writeFile(
      join(runDir, "events.jsonl"),
      makeLines(EVENT_LOG_BACKLOG_LIMIT + 1, EVENT_LOG_BACKLOG_LIMIT + 1),
      "utf8",
    );

    const log = await EventLog.open(runDir);
    const { entries, truncated } = await log.readEventsSince(0);

    expect(entries.length).toBe(EVENT_LOG_BACKLOG_LIMIT);
    expect(truncated).toBe(true);
    await log.close();
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

function toolCallEvent(
  toolCallId: string,
  status: "pending" | "in_progress" | "completed" | "failed",
): RunnerEvent {
  return {
    type: "tool_call",
    call: { toolCallId, status, kind: "execute", title: "Bash: npm test" },
  };
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
