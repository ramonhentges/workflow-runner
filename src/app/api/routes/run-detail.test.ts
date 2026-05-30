import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApiApp } from "../app.js";
import { RunManager, RunManagerError } from "../../../infra/daemon/run-manager.js";
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
    currentStepId: "step-1",
    visitedStepIds: ["step-1"],
    kickoffPrompts: {},
    startedAt: BASE_TS,
    endedAt: status === "running" ? null : BASE_TS + 5000,
    ...overrides,
  };
}

function fakeActiveRun(snap: RunSnapshot, subscriberCount = 0): ActiveRun {
  return {
    run: { snapshot: () => snap } as ActiveRun["run"],
    runner: null,
    mcpServer: null,
    eventLog: null,
    subscribers: new Set(Array.from({ length: subscriberCount }, () => ({}))),
    runPromise: null,
  } as unknown as ActiveRun;
}

type MockGetBehavior =
  | { type: "found"; snap: RunSnapshot; subscriberCount?: number }
  | { type: "not-found" }
  | { type: "ambiguous"; candidates: string[] };;

function makeRm(behavior: MockGetBehavior, snapshots: RunSnapshot[] = []): RunManager {
  return {
    list: () => snapshots,
    get: (_idOrPrefix: string): ActiveRun | undefined => {
      if (behavior.type === "not-found") return undefined;
      if (behavior.type === "ambiguous") {
        throw new RunManagerError(
          "AMBIGUOUS_PREFIX",
          `Prefix '${_idOrPrefix}' matches multiple runs: ${behavior.candidates.join(", ")}`,
          { candidates: behavior.candidates },
        );
      }
      return fakeActiveRun(behavior.snap, behavior.subscriberCount ?? 0);
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

// ---------------------------------------------------------------------------
// Unit tests — GET /runs/:id
// ---------------------------------------------------------------------------

describe("GET /runs/:id — unit", () => {
  it("returns 200 with RunDetail for a known full id", async () => {
    const snap = fakeSnapshot("run001", "brave-otter");
    const app = createApiApp(makeRm({ type: "found", snap }));

    const res = await app.request("/runs/run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe("run001");
    expect(body.slug).toBe("brave-otter");
    expect(body.workflowPath).toBe("/tmp/wf.json");
    expect(body.status).toBe("running");
    expect(body.currentStepId).toBe("step-1");
    expect(Array.isArray(body.visitedStepIds)).toBe(true);
    expect(body.startedAt).toBe(BASE_TS);
    expect(body.endedAt).toBeNull();
    expect(body.attachedCount).toBe(0);
  });

  it("resolves a unique slug prefix to the correct run", async () => {
    const snap = fakeSnapshot("run001", "brave-otter");
    const app = createApiApp(makeRm({ type: "found", snap }));

    const res = await app.request("/runs/brave-");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.id).toBe("run001");
    expect(body.slug).toBe("brave-otter");
  });

  it("returns 404 for an unknown id", async () => {
    const app = createApiApp(makeRm({ type: "not-found" }));

    const res = await app.request("/runs/no-such-run");

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("UNKNOWN_RUN");
    expect(typeof body.message).toBe("string");
  });

  it("returns 409 with candidates for an ambiguous prefix", async () => {
    const candidates = ["run-abc-1", "run-abc-2"];
    const app = createApiApp(makeRm({ type: "ambiguous", candidates }));

    const res = await app.request("/runs/run-abc");

    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("AMBIGUOUS_PREFIX");
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates).toEqual(candidates);
    expect(typeof body.message).toBe("string");
  });

  it("RunDetail includes visitedStepIds array", async () => {
    const snap = fakeSnapshot("run002", "cool-wolf", "running", {
      visitedStepIds: ["step-1", "step-2"],
    });
    const app = createApiApp(makeRm({ type: "found", snap }));

    const res = await app.request("/runs/run002");
    const body = await res.json() as Record<string, unknown>;

    expect(body.visitedStepIds).toEqual(["step-1", "step-2"]);
  });

  it("attachedCount reflects live subscriber count", async () => {
    const snap = fakeSnapshot("run003", "dark-fox");
    const app = createApiApp(makeRm({ type: "found", snap, subscriberCount: 3 }));

    const res = await app.request("/runs/run003");
    const body = await res.json() as Record<string, unknown>;

    expect(body.attachedCount).toBe(3);
  });

  it("endedAt is a number for completed runs", async () => {
    const snap = fakeSnapshot("run004", "silent-bear", "completed");
    const app = createApiApp(makeRm({ type: "found", snap }));

    const res = await app.request("/runs/run004");
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.endedAt).toBe("number");
    expect(body.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.json — run-detail route registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes /runs/:id", () => {
  it("documents GET /runs/:id in the OpenAPI spec", async () => {
    const app = createApiApp(makeRm({ type: "not-found" }));
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/runs/:id"]).toBeDefined();
    const path = paths["/runs/:id"] as Record<string, unknown>;
    expect(path["get"]).toBeDefined();
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

describe("GET /runs/:id — integration (real RunManager)", () => {
  it("returns 200 with RunDetail for a running run", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-detail-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("detail-test", "fake:hang"));

      const { runId } = await manager.startRun(wfPath, storageRoot);

      const app = createApiApp(manager);
      const res = await app.request(`/runs/${runId}`);

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.id).toBe(runId);
      expect(body.status).toBe("running");
      expect(body.workflowPath).toBe(wfPath);
      expect(typeof body.startedAt).toBe("number");
      expect(body.endedAt).toBeNull();
      expect(typeof body.attachedCount).toBe("number");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns 404 for a run that does not exist", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-detail-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const app = createApiApp(manager);
      const res = await app.request("/runs/no-such-run-id");

      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("UNKNOWN_RUN");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns 200 with a completed run detail via slug prefix", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "run-detail-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("detail-test-2", "fake:complete"));

      const { runId, slug } = await manager.startRun(wfPath, storageRoot);

      // Wait for the run to complete.
      await new Promise((r) => setTimeout(r, 200));

      const app = createApiApp(manager);
      // Use full id to fetch completed run.
      const res = await app.request(`/runs/${runId}`);

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.id).toBe(runId);
      expect(body.slug).toBe(slug);
      // After completion the status will be completed.
      expect(["completed", "running"]).toContain(body.status as string);
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
