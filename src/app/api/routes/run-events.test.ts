import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiApp } from "../app.js";
import { RunManager, RunManagerError } from "../../../infra/daemon/run-manager.js";
import { EventLog } from "../../../infra/daemon/event-log.js";
import { FixtureSessionFactory } from "../../../infra/daemon/test-helpers/fixture-session-factory.js";
import { asRunId, asRunSlug } from "../../../domain/run.js";
import { asStepId } from "../../../domain/ids.js";
import type { RunSnapshot } from "../../../domain/run.js";
import type { ActiveRun } from "../../../infra/daemon/run-manager.js";
import type { EventLogEntry } from "../../../infra/daemon/event-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000_000;

function fakeSnapshot(
  id: string,
  slug: string,
  status: RunSnapshot["status"] = "running",
): RunSnapshot {
  return {
    id: asRunId(id),
    slug: asRunSlug(slug),
    workflowPath: "/tmp/wf.json",
    status,
    currentStepId: status === "running" ? "step-1" : null,
    visitedStepIds: ["step-1"],
    kickoffPrompts: {},
    startedAt: BASE_TS,
    endedAt: status === "running" ? null : BASE_TS + 5000,
  };
}

function fakeEntry(seq: number, stepId: string | null = null): EventLogEntry {
  return {
    seq,
    ts: BASE_TS + seq * 100,
    stepId,
    event: { type: "log", message: `event-${seq}` },
  };
}

type ControlledLog = {
  closeCount: number;
  readEventsSince: (fromSeq: number) => Promise<{ entries: EventLogEntry[]; truncated: boolean }>;
  close: () => Promise<void>;
};

function makeControlledLog(entries: EventLogEntry[], truncated = false): ControlledLog {
  const log: ControlledLog = {
    closeCount: 0,
    readEventsSince: async (_fromSeq: number) => ({ entries, truncated }),
    close: async () => {
      log.closeCount++;
    },
  };
  return log;
}

function makeRm(opts: {
  getBehavior?: "found" | "not-found" | "ambiguous";
  ambiguousCandidates?: string[];
  status?: RunSnapshot["status"];
  // null = terminal run (handler opens an owned log via openEventLog)
  // object = running run (handler uses directly, never closes)
  activeEventLog?: object | null;
  // returned by openEventLog when activeEventLog is null
  openedEventLog?: object | null;
}): RunManager {
  const snap = fakeSnapshot("run001", "brave-otter", opts.status ?? "running");
  return {
    list: () => [],
    get: (idOrPrefix: string): ActiveRun | undefined => {
      if (opts.getBehavior === "not-found") return undefined;
      if (opts.getBehavior === "ambiguous") {
        const candidates = opts.ambiguousCandidates ?? ["run-a", "run-b"];
        throw new RunManagerError(
          "AMBIGUOUS_PREFIX",
          `Prefix '${idOrPrefix}' matches: ${candidates.join(", ")}`,
          { candidates },
        );
      }
      return {
        run: { snapshot: () => snap } as ActiveRun["run"],
        eventLog: opts.activeEventLog ?? null,
        subscribers: new Set(),
        runner: null,
        mcpServer: null,
        runPromise: null,
      } as unknown as ActiveRun;
    },
    openEventLog: async () => (opts.openedEventLog ?? null) as unknown as EventLog | null,
    startRun: async () => { throw new Error("not impl"); },
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

function makeWorkflowJson(id: string, description: string): string {
  return JSON.stringify({
    id,
    name: id,
    description: id,
    version: "1",
    steps: [
      {
        id: "s1",
        agent: "fake/AGENT",
        model: "fake/model",
        mode: "autonomous",
        ide: "fake",
        description,
        edges: [],
      },
    ],
  });
}

// ---------------------------------------------------------------------------
// Unit tests — error responses
// ---------------------------------------------------------------------------

describe("GET /runs/:id/events — unit (error responses)", () => {
  it("returns 404 for an unknown run", async () => {
    const app = createApiApp(makeRm({ getBehavior: "not-found" }));
    const res = await app.request("/runs/no-such-run/events");

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("UNKNOWN_RUN");
    expect(typeof body.message).toBe("string");
  });

  it("returns 409 with candidate list for an ambiguous prefix", async () => {
    const candidates = ["run-abc-1", "run-abc-2"];
    const app = createApiApp(makeRm({ getBehavior: "ambiguous", ambiguousCandidates: candidates }));
    const res = await app.request("/runs/run-abc/events");

    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("AMBIGUOUS_PREFIX");
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates).toEqual(candidates);
    expect(typeof body.message).toBe("string");
  });

  it("returns 200 with empty entries when event log is unavailable", async () => {
    // activeEventLog null + openedEventLog null → no log available
    const app = createApiApp(makeRm({ activeEventLog: null, openedEventLog: null }));
    const res = await app.request("/runs/run001/events");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.entries).toEqual([]);
    expect(body.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — event log ownership (FD lifecycle)
// ---------------------------------------------------------------------------

describe("GET /runs/:id/events — unit (event log ownership)", () => {
  it("for terminal runs: opens an owned log and closes it after responding", async () => {
    const mockLog = makeControlledLog([fakeEntry(1)]);
    const app = createApiApp(makeRm({ activeEventLog: null, openedEventLog: mockLog }));

    const res = await app.request("/runs/run001/events");

    expect(res.status).toBe(200);
    // close() is called synchronously in the finally block before the handler returns
    expect(mockLog.closeCount).toBe(1);
  });

  it("for running runs: uses active.eventLog and does NOT close it", async () => {
    const activeLog = makeControlledLog([fakeEntry(1)]);
    const app = createApiApp(makeRm({ activeEventLog: activeLog }));

    const res = await app.request("/runs/run001/events");

    expect(res.status).toBe(200);
    expect(activeLog.closeCount).toBe(0);
  });

  it("propagates truncated: true from readEventsSince", async () => {
    const mockLog = makeControlledLog([fakeEntry(1), fakeEntry(2)], true);
    const app = createApiApp(makeRm({ activeEventLog: mockLog }));

    const res = await app.request("/runs/run001/events");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.truncated).toBe(true);
  });

  it("propagates truncated: true even after stepId filter narrows results", async () => {
    // `truncated` reflects the unfiltered window hitting the backlog cap. Even when the per-step
    // slice is small, the flag must pass through unchanged so callers know to page forward.
    const entries = [fakeEntry(1, "step-A"), fakeEntry(2, "step-B")];
    const mockLog = makeControlledLog(entries, true);
    const app = createApiApp(makeRm({ activeEventLog: mockLog }));

    const res = await app.request("/runs/run001/events?stepId=step-A");

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.entries as unknown[]).length).toBe(1);
    expect(body.truncated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — behavioral with real EventLog in temp dir
// ---------------------------------------------------------------------------

describe("GET /runs/:id/events — unit (behavioral, real EventLog)", () => {
  it("?fromSeq=N returns only entries with seq > N", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-events-ut-"));
    const runDir = join(tempDir, "run001");
    mkdirSync(runDir, { recursive: true });

    const log = await EventLog.open(runDir);
    try {
      await log.append({ type: "log", message: "one" }, asStepId("s1"));   // seq 1
      await log.append({ type: "log", message: "two" }, asStepId("s1"));   // seq 2
      await log.append({ type: "log", message: "three" }, asStepId("s1")); // seq 3
      await log.append({ type: "log", message: "four" }, asStepId("s1"));  // seq 4

      const app = createApiApp(makeRm({ activeEventLog: log }));
      const res = await app.request("/runs/run001/events?fromSeq=2");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: EventLogEntry[]; truncated: boolean };
      expect(body.entries.map((e) => e.seq)).toEqual([3, 4]);
      expect(body.truncated).toBe(false);
    } finally {
      await log.close();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("no ?fromSeq returns all entries (fromSeq defaults to 0)", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-events-ut-"));
    const runDir = join(tempDir, "run001");
    mkdirSync(runDir, { recursive: true });

    const log = await EventLog.open(runDir);
    try {
      await log.append({ type: "log", message: "one" }, asStepId("s1"));  // seq 1
      await log.append({ type: "log", message: "two" }, asStepId("s1"));  // seq 2

      const app = createApiApp(makeRm({ activeEventLog: log }));
      const res = await app.request("/runs/run001/events");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: EventLogEntry[]; truncated: boolean };
      expect(body.entries.map((e) => e.seq)).toEqual([1, 2]);
      expect(body.truncated).toBe(false);
    } finally {
      await log.close();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("?stepId=X returns only entries for that step", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-events-ut-"));
    const runDir = join(tempDir, "run001");
    mkdirSync(runDir, { recursive: true });

    const log = await EventLog.open(runDir);
    try {
      await log.append({ type: "log", message: "s1-a" }, asStepId("step-1")); // seq 1
      await log.append({ type: "log", message: "s2-a" }, asStepId("step-2")); // seq 2
      await log.append({ type: "log", message: "s1-b" }, asStepId("step-1")); // seq 3
      await log.append({ type: "log", message: "s2-b" }, asStepId("step-2")); // seq 4

      const app = createApiApp(makeRm({ activeEventLog: log }));
      const res = await app.request("/runs/run001/events?stepId=step-1");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: EventLogEntry[]; truncated: boolean };
      expect(body.entries.map((e) => e.seq)).toEqual([1, 3]);
      expect(body.entries.every((e) => e.stepId === "step-1")).toBe(true);
      expect(body.truncated).toBe(false);
    } finally {
      await log.close();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("?fromSeq=N&stepId=X combines both filters: step entries after N", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-events-ut-"));
    const runDir = join(tempDir, "run001");
    mkdirSync(runDir, { recursive: true });

    const log = await EventLog.open(runDir);
    try {
      await log.append({ type: "log", message: "s1-a" }, asStepId("step-1")); // seq 1
      await log.append({ type: "log", message: "s2-a" }, asStepId("step-2")); // seq 2
      await log.append({ type: "log", message: "s1-b" }, asStepId("step-1")); // seq 3
      await log.append({ type: "log", message: "s1-c" }, asStepId("step-1")); // seq 4

      const app = createApiApp(makeRm({ activeEventLog: log }));
      // fromSeq=2 → seq > 2 → [3, 4]; stepId=step-1 → [3, 4] (both are step-1)
      const res = await app.request("/runs/run001/events?fromSeq=2&stepId=step-1");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: EventLogEntry[]; truncated: boolean };
      expect(body.entries.map((e) => e.seq)).toEqual([3, 4]);
      expect(body.entries.every((e) => e.stepId === "step-1")).toBe(true);
    } finally {
      await log.close();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("entries are returned in ascending sequence order", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-events-ut-"));
    const runDir = join(tempDir, "run001");
    mkdirSync(runDir, { recursive: true });

    const log = await EventLog.open(runDir);
    try {
      await log.append({ type: "log", message: "a" }, asStepId("s1")); // seq 1
      await log.append({ type: "log", message: "b" }, asStepId("s1")); // seq 2
      await log.append({ type: "log", message: "c" }, asStepId("s1")); // seq 3

      const app = createApiApp(makeRm({ activeEventLog: log }));
      const res = await app.request("/runs/run001/events");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: EventLogEntry[] };
      const seqs = body.entries.map((e) => e.seq);
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    } finally {
      await log.close();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.json — route registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes GET /runs/:id/events", () => {
  it("documents GET /runs/:id/events in the OpenAPI spec", async () => {
    const app = createApiApp(makeRm({ getBehavior: "not-found" }));
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const spec = (await res.json()) as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/runs/:id/events"]).toBeDefined();
    const path = paths["/runs/:id/events"] as Record<string, unknown>;
    expect(path["get"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — real RunManager with FixtureSessionFactory
// ---------------------------------------------------------------------------

describe("GET /runs/:id/events — integration (real RunManager)", () => {
  it(
    "returns events for a completed run with entries in ascending sequence order",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "run-events-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      try {
        const wfPath = join(storageRoot, "test.json");
        await Bun.write(wfPath, makeWorkflowJson("events-test", "fake:complete"));

        const { runId } = await manager.startRun(wfPath, storageRoot);

        // Wait for the run to complete and events to be persisted.
        await new Promise((r) => setTimeout(r, 300));

        const app = createApiApp(manager);
        const res = await app.request(`/runs/${runId}/events`);

        expect(res.status).toBe(200);
        const body = (await res.json()) as { entries: EventLogEntry[]; truncated: boolean };

        expect(Array.isArray(body.entries)).toBe(true);
        expect(typeof body.truncated).toBe("boolean");

        if (body.entries.length > 1) {
          const seqs = body.entries.map((e) => e.seq);
          expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
        }

        // Each entry must have the required wire fields.
        for (const entry of body.entries) {
          expect(typeof entry.seq).toBe("number");
          expect(typeof entry.ts).toBe("number");
          expect(entry.seq).toBeGreaterThan(0);
        }
      } finally {
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );

  it(
    "returns 404 for a run that does not exist",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "run-events-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      try {
        const app = createApiApp(manager);
        const res = await app.request("/runs/no-such-run-id/events");

        expect(res.status).toBe(404);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body.code).toBe("UNKNOWN_RUN");
      } finally {
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );

  it(
    "?fromSeq filter applied to a completed run returns only events after the given seq",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "run-events-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      try {
        const wfPath = join(storageRoot, "test.json");
        await Bun.write(wfPath, makeWorkflowJson("events-fromseq-test", "fake:complete"));

        const { runId } = await manager.startRun(wfPath, storageRoot);
        await new Promise((r) => setTimeout(r, 300));

        const app = createApiApp(manager);

        // First fetch all events to discover the real seq numbers.
        const allRes = await app.request(`/runs/${runId}/events`);
        expect(allRes.status).toBe(200);
        const allBody = (await allRes.json()) as { entries: EventLogEntry[] };

        if (allBody.entries.length >= 2) {
          const firstSeq = allBody.entries[0]!.seq;

          const filteredRes = await app.request(`/runs/${runId}/events?fromSeq=${firstSeq}`);
          expect(filteredRes.status).toBe(200);
          const filteredBody = (await filteredRes.json()) as { entries: EventLogEntry[] };

          for (const entry of filteredBody.entries) {
            expect(entry.seq).toBeGreaterThan(firstSeq);
          }
        }
        // If fewer than 2 events, the fromSeq filter is trivially correct — skip assertion.
      } finally {
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );
});
