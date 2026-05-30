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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    currentStepId: null,
    visitedStepIds: [],
    kickoffPrompts: {},
    startedAt: 1_700_000_000_000,
    endedAt: null,
  };
}

function makePartialRm(snapshots: RunSnapshot[] = []): RunManager {
  return {
    list: () => snapshots,
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
// Unit tests — mocked RunManager
// ---------------------------------------------------------------------------

describe("GET /health — unit", () => {
  it("returns 200 with status:ok and numeric activeRuns", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.activeRuns).toBe("number");
  });

  it("activeRuns is 0 when no runs exist", async () => {
    const app = createApiApp(makePartialRm([]));
    const res = await app.request("/health");
    const body = await res.json() as Record<string, unknown>;

    expect(body.activeRuns).toBe(0);
  });

  it("activeRuns equals the running-run count when runs are present", async () => {
    const snapshots = [
      fakeSnapshot("run001", "brave-otter", "running"),
      fakeSnapshot("run002", "cool-fox", "completed"),
      fakeSnapshot("run003", "dark-wolf", "running"),
    ];
    const app = createApiApp(makePartialRm(snapshots));
    const res = await app.request("/health");
    const body = await res.json() as Record<string, unknown>;

    expect(body.activeRuns).toBe(2);
  });

  it("response body contains no run ids, slugs, or workflow paths", async () => {
    const snapshots = [fakeSnapshot("run001", "brave-otter", "running")];
    const app = createApiApp(makePartialRm(snapshots));
    const res = await app.request("/health");
    const body = await res.json() as Record<string, unknown>;
    const bodyStr = JSON.stringify(body);

    expect(bodyStr).not.toContain("run001");
    expect(bodyStr).not.toContain("brave-otter");
    expect(bodyStr).not.toContain("/tmp/wf.json");
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["status", "pid", "uptimeMs", "activeRuns", "version"]),
    );
    expect(Object.keys(body)).toHaveLength(5);
  });

  it("pid is a positive integer", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/health");
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.pid).toBe("number");
    expect((body.pid as number) > 0).toBe(true);
  });

  it("uptimeMs is a non-negative number", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/health");
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.uptimeMs).toBe("number");
    expect((body.uptimeMs as number) >= 0).toBe(true);
  });

  it("version is a non-empty string", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/health");
    const body = await res.json() as Record<string, unknown>;

    expect(typeof body.version).toBe("string");
    expect((body.version as string).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.json — health route registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes /health", () => {
  it("documents GET /health in the OpenAPI spec", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/health"]).toBeDefined();
    const healthPath = paths["/health"] as Record<string, unknown>;
    expect(healthPath["get"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — real RunManager with FixtureSessionFactory
// ---------------------------------------------------------------------------

describe("GET /health — integration (real RunManager)", () => {
  it("reports activeRuns:1 with one running fixture run", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "health-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(
        wfPath,
        JSON.stringify({
          id: "health-test",
          name: "health-test",
          description: "health-test",
          version: "1",
          steps: [
            {
              id: "s1",
              agent: "fake/AGENT",
              model: "fake/model",
              mode: "autonomous",
              ide: "fake",
              description: "fake:hang",
              edges: [],
            },
          ],
        }),
      );

      await manager.startRun(wfPath, storageRoot);

      const app = createApiApp(manager);
      const res = await app.request("/health");

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(body.activeRuns).toBe(1);
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("reports activeRuns:0 with no runs", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "health-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const app = createApiApp(manager);
      const res = await app.request("/health");

      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.activeRuns).toBe(0);
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
