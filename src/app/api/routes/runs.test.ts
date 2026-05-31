import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiApp } from "../app.js";
import { RunManager } from "../../../infra/daemon/run-manager.js";
import { FixtureSessionFactory } from "../../../infra/daemon/test-helpers/fixture-session-factory.js";
import { asRunId, asRunSlug } from "../../../domain/run.js";
import type { RunSnapshot } from "../../../domain/run.js";
import type { ActiveRun } from "../../../infra/daemon/run-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000_000;

function fakeSnapshot(
  id: string,
  slug: string,
  status: RunSnapshot["status"] = "running",
  overrides: Partial<RunSnapshot> = {},
): RunSnapshot {
  return {
    id: asRunId(id),
    slug: asRunSlug(slug),
    workflowPath: "/tmp/wf.json",
    status,
    currentStepId: null,
    visitedStepIds: [],
    kickoffPrompts: {},
    startedAt: BASE_TS,
    endedAt: status === "running" ? null : BASE_TS + 5000,
    ...overrides,
  };
}

function makeRm(snapshots: RunSnapshot[], subscriberCounts: Map<string, number> = new Map()): RunManager {
  return {
    list: (opts?: { includeOldTerminal?: boolean }) => {
      if (!opts?.includeOldTerminal) {
        return snapshots;
      }
      return snapshots;
    },
    get: (idOrPrefix: string) => {
      const snap = snapshots.find((s) => s.id === idOrPrefix);
      if (!snap) return undefined;
      const count = subscriberCounts.get(snap.id) ?? 0;
      // Use unique objects so Set doesn't deduplicate them.
      return { subscribers: new Set(Array.from({ length: count }, () => ({}))) } as unknown as ActiveRun;
    },
    startRun: async () => { throw new Error("not impl"); },
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

function makeFilteringRm(allSnapshots: RunSnapshot[], recentSnapshots: RunSnapshot[]): RunManager {
  return {
    list: (opts?: { includeOldTerminal?: boolean }) =>
      opts?.includeOldTerminal ? allSnapshots : recentSnapshots,
    get: () => undefined,
    startRun: async () => { throw new Error("not impl"); },
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

// ---------------------------------------------------------------------------
// Unit tests — GET /runs
// ---------------------------------------------------------------------------

describe("GET /runs — unit", () => {
  it("returns 200 with runs array", async () => {
    const app = createApiApp(makeRm([]));
    const res = await app.request("/runs");

    expect(res.status).toBe(200);
    const body = await res.json() as { runs: unknown[] };
    expect(Array.isArray(body.runs)).toBe(true);
  });

  it("returns empty array when no runs exist", async () => {
    const app = createApiApp(makeRm([]));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: unknown[] };

    expect(body.runs).toHaveLength(0);
  });

  it("returns all runs without ?all query", async () => {
    const snapshots = [
      fakeSnapshot("run001", "brave-otter", "running"),
      fakeSnapshot("run002", "cool-fox", "completed"),
    ];
    const app = createApiApp(makeRm(snapshots));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: { id: string }[] };

    expect(body.runs).toHaveLength(2);
  });

  it("?all=true passes includeOldTerminal:true to RunManager.list", async () => {
    const recentSnap = fakeSnapshot("run001", "brave-otter", "completed");
    const oldSnap = fakeSnapshot("run002", "cool-fox", "completed");
    const app = createApiApp(makeFilteringRm([recentSnap, oldSnap], [recentSnap]));

    const resFalse = await app.request("/runs");
    const bodyFalse = await resFalse.json() as { runs: unknown[] };
    expect(bodyFalse.runs).toHaveLength(1);

    const resTrue = await app.request("/runs?all=true");
    const bodyTrue = await resTrue.json() as { runs: unknown[] };
    expect(bodyTrue.runs).toHaveLength(2);
  });

  it("?all=false does not include old terminal runs", async () => {
    const recentSnap = fakeSnapshot("run001", "brave-otter", "completed");
    const oldSnap = fakeSnapshot("run002", "cool-fox", "completed");
    const app = createApiApp(makeFilteringRm([recentSnap, oldSnap], [recentSnap]));

    const res = await app.request("/runs?all=false");
    const body = await res.json() as { runs: unknown[] };
    expect(body.runs).toHaveLength(1);
  });

  it("each run summary includes required fields", async () => {
    const snap = fakeSnapshot("run001", "brave-otter", "running");
    const app = createApiApp(makeRm([snap]));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: Record<string, unknown>[] };

    expect(body.runs).toHaveLength(1);
    const run = body.runs[0];
    expect(run.id).toBe("run001");
    expect(run.slug).toBe("brave-otter");
    expect(run.workflowPath).toBe("/tmp/wf.json");
    expect(run.status).toBe("running");
    expect(run.currentStepId).toBeNull();
    expect(typeof run.startedAt).toBe("number");
    expect(run.endedAt).toBeNull();
    expect(typeof run.attachedCount).toBe("number");
  });

  it("attachedCount reflects live subscribers", async () => {
    const snap = fakeSnapshot("run001", "brave-otter", "running");
    const subscribers = new Map([["run001", 3]]);
    const app = createApiApp(makeRm([snap], subscribers));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: { id: string; attachedCount: number }[] };

    expect(body.runs[0].attachedCount).toBe(3);
  });

  it("attachedCount is 0 when no subscribers", async () => {
    const snap = fakeSnapshot("run001", "brave-otter", "running");
    const app = createApiApp(makeRm([snap]));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: { attachedCount: number }[] };

    expect(body.runs[0].attachedCount).toBe(0);
  });

  it("active runs appear before terminal runs (matching RunManager.list ordering)", async () => {
    // RunManager.list returns active first then terminal; we just mirror that ordering
    const running = fakeSnapshot("run001", "brave-otter", "running", { startedAt: BASE_TS });
    const terminal = fakeSnapshot("run002", "cool-fox", "completed", { startedAt: BASE_TS - 10000 });
    const app = createApiApp(makeRm([running, terminal]));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: { id: string; status: string }[] };

    expect(body.runs[0].id).toBe("run001");
    expect(body.runs[0].status).toBe("running");
    expect(body.runs[1].id).toBe("run002");
    expect(body.runs[1].status).toBe("completed");
  });

  it("endedAt is a number for terminal runs", async () => {
    const snap = fakeSnapshot("run001", "brave-otter", "completed");
    const app = createApiApp(makeRm([snap]));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: { endedAt: unknown }[] };

    expect(typeof body.runs[0].endedAt).toBe("number");
  });

  it("cwd is present in run summary when snapshot has cwd", async () => {
    const snap = fakeSnapshot("run001", "brave-otter", "running", { cwd: "/projects/my-app" });
    const app = createApiApp(makeRm([snap]));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: Record<string, unknown>[] };

    expect(body.runs[0].cwd).toBe("/projects/my-app");
  });

  it("cwd is absent in run summary when snapshot has no cwd", async () => {
    const snap = fakeSnapshot("run001", "brave-otter", "running");
    const app = createApiApp(makeRm([snap]));
    const res = await app.request("/runs");
    const body = await res.json() as { runs: Record<string, unknown>[] };

    expect(body.runs[0].cwd).toBeUndefined();
  });

  it("?cwd filter returns only runs matching the given cwd", async () => {
    const snap1 = fakeSnapshot("run001", "brave-otter", "running", { cwd: "/projects/app-a" });
    const snap2 = fakeSnapshot("run002", "cool-fox", "running", { cwd: "/projects/app-b" });
    const snap3 = fakeSnapshot("run003", "dark-wolf", "running", { cwd: "/projects/app-a" });
    const app = createApiApp(makeRm([snap1, snap2, snap3]));
    const res = await app.request("/runs?cwd=/projects/app-a");
    const body = await res.json() as { runs: { id: string }[] };

    expect(body.runs).toHaveLength(2);
    const ids = body.runs.map((r) => r.id);
    expect(ids).toContain("run001");
    expect(ids).toContain("run003");
    expect(ids).not.toContain("run002");
  });

  it("?cwd filter excludes runs without a cwd", async () => {
    const snapWithCwd = fakeSnapshot("run001", "brave-otter", "running", { cwd: "/projects/app-a" });
    const snapNoCwd = fakeSnapshot("run002", "cool-fox", "running");
    const app = createApiApp(makeRm([snapWithCwd, snapNoCwd]));
    const res = await app.request("/runs?cwd=/projects/app-a");
    const body = await res.json() as { runs: { id: string }[] };

    expect(body.runs).toHaveLength(1);
    expect(body.runs[0].id).toBe("run001");
  });

  it("?cwd filter returns empty list when no runs match", async () => {
    const snap = fakeSnapshot("run001", "brave-otter", "running", { cwd: "/projects/app-a" });
    const app = createApiApp(makeRm([snap]));
    const res = await app.request("/runs?cwd=/projects/app-b");
    const body = await res.json() as { runs: unknown[] };

    expect(body.runs).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.json — runs route registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes /runs", () => {
  it("documents GET /runs in the OpenAPI spec", async () => {
    const app = createApiApp(makeRm([]));
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/runs"]).toBeDefined();
    const runsPath = paths["/runs"] as Record<string, unknown>;
    expect(runsPath["get"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — real RunManager with FixtureSessionFactory
// ---------------------------------------------------------------------------

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

describe("GET /runs — integration (real RunManager)", () => {
  it("lists one running run", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "runs-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("runs-test", "fake:hang"));

      await manager.startRun(wfPath, storageRoot);

      const app = createApiApp(manager);
      const res = await app.request("/runs");

      expect(res.status).toBe(200);
      const body = await res.json() as { runs: { status: string }[] };
      expect(body.runs).toHaveLength(1);
      expect(body.runs[0].status).toBe("running");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns empty list when no runs exist", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "runs-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const app = createApiApp(manager);
      const res = await app.request("/runs");

      expect(res.status).toBe(200);
      const body = await res.json() as { runs: unknown[] };
      expect(body.runs).toHaveLength(0);
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("lists a completed run with ?all=true", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "runs-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      // fake:complete resolves immediately so the run becomes terminal quickly.
      await Bun.write(wfPath, makeWorkflowJson("runs-test-2", "fake:complete"));

      const { runId } = await manager.startRun(wfPath, storageRoot);

      // Wait for the run to reach a terminal state.
      await new Promise((r) => setTimeout(r, 200));

      const app = createApiApp(manager);
      const res = await app.request("/runs?all=true");

      expect(res.status).toBe(200);
      const body = await res.json() as { runs: { id: string; status: string }[] };
      expect(body.runs.length).toBeGreaterThanOrEqual(1);
      const run = body.runs.find((r) => r.id === runId);
      expect(run).toBeDefined();
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
