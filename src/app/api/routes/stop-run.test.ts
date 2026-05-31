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

/**
 * Creates a mock RunManager whose `get()` returns an ActiveRun with a
 * mutable status (so `stop()` can transition it) or an error.
 */
function makeMutableRm(opts: {
  initialStatus?: RunSnapshot["status"];
  afterStopStatus?: RunSnapshot["status"];
  getBehavior?: "not-found" | "ambiguous";
  ambiguousCandidates?: string[];
}): RunManager {
  let currentStatus: RunSnapshot["status"] = opts.initialStatus ?? "running";

  const active: ActiveRun = {
    run: {
      snapshot: () =>
        fakeSnapshot("run001", "brave-otter", currentStatus),
    } as ActiveRun["run"],
    runner: null,
    mcpServer: null,
    eventLog: null,
    subscribers: new Set(),
    runPromise: null,
  } as unknown as ActiveRun;

  return {
    list: () => [],
    get: (_id: string): ActiveRun | undefined => {
      if (opts.getBehavior === "not-found") return undefined;
      if (opts.getBehavior === "ambiguous") {
        const candidates = opts.ambiguousCandidates ?? ["run-a", "run-b"];
        throw new RunManagerError(
          "AMBIGUOUS_PREFIX",
          `Prefix '${_id}' matches multiple runs: ${candidates.join(", ")}`,
          { candidates },
        );
      }
      return active;
    },
    stop: async () => {
      if (opts.afterStopStatus !== undefined) {
        currentStatus = opts.afterStopStatus;
      }
    },
    startRun: async () => { throw new Error("not impl"); },
    retryStep: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

async function postStop(app: ReturnType<typeof createApiApp>, id: string) {
  return app.request(`/runs/${id}/stop`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Unit tests — POST /runs/:id/stop
// ---------------------------------------------------------------------------

describe("POST /runs/:id/stop — unit", () => {
  it("returns 200 with terminal finalStatus when stopping a running run", async () => {
    const app = createApiApp(
      makeMutableRm({ initialStatus: "running", afterStopStatus: "aborted" }),
    );

    const res = await postStop(app, "run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.finalStatus).toBe("aborted");
  });

  it("returns 200 with completed finalStatus when run finishes during stop", async () => {
    const app = createApiApp(
      makeMutableRm({ initialStatus: "running", afterStopStatus: "completed" }),
    );

    const res = await postStop(app, "run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.finalStatus).toBe("completed");
  });

  it("returns 200 with existing status when stopping an already-terminal run (no-op)", async () => {
    // afterStopStatus is NOT set so stop() doesn't mutate — simulates no-op for terminal run.
    const app = createApiApp(
      makeMutableRm({ initialStatus: "completed" }),
    );

    const res = await postStop(app, "run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.finalStatus).toBe("completed");
  });

  it("returns 200 with failed status when stopping an already-failed run (no-op)", async () => {
    const app = createApiApp(
      makeMutableRm({ initialStatus: "failed" }),
    );

    const res = await postStop(app, "run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.finalStatus).toBe("failed");
  });

  it("returns 404 for an unknown run id", async () => {
    const app = createApiApp(makeMutableRm({ getBehavior: "not-found" }));

    const res = await postStop(app, "no-such-run");

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("UNKNOWN_RUN");
    expect(typeof body.message).toBe("string");
  });

  it("returns 409 with candidates for an ambiguous prefix", async () => {
    const candidates = ["run-abc-1", "run-abc-2"];
    const app = createApiApp(
      makeMutableRm({ getBehavior: "ambiguous", ambiguousCandidates: candidates }),
    );

    const res = await postStop(app, "run-abc");

    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("AMBIGUOUS_PREFIX");
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates).toEqual(candidates);
    expect(typeof body.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.json — stop-run route registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes POST /runs/:id/stop", () => {
  it("documents POST /runs/:id/stop in the OpenAPI spec", async () => {
    const app = createApiApp(makeMutableRm({ getBehavior: "not-found" }));
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/runs/:id/stop"]).toBeDefined();
    const path = paths["/runs/:id/stop"] as Record<string, unknown>;
    expect(path["post"]).toBeDefined();
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

describe("POST /runs/:id/stop — integration (real RunManager)", () => {
  it(
    "transitions a running fake:hang run to a terminal state and GET /runs/:id reflects it",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "stop-run-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      try {
        const wfPath = join(storageRoot, "test.json");
        await Bun.write(wfPath, makeWorkflowJson("stop-test", "fake:hang"));

        const { runId } = await manager.startRun(wfPath, storageRoot);

        // Give the run a moment to reach "running" state.
        await new Promise((r) => setTimeout(r, 100));

        const app = createApiApp(manager);

        const stopRes = await postStop(app, runId);
        expect(stopRes.status).toBe(200);
        const stopBody = await stopRes.json() as Record<string, unknown>;
        expect(typeof stopBody.finalStatus).toBe("string");
        const terminalStatuses = ["aborted", "completed", "failed", "crashed"];
        expect(terminalStatuses).toContain(stopBody.finalStatus as string);

        // Verify via GET /runs/:id that the run is now in a terminal state.
        const detailRes = await app.request(`/runs/${runId}`);
        expect(detailRes.status).toBe(200);
        const detailBody = await detailRes.json() as Record<string, unknown>;
        expect(terminalStatuses).toContain(detailBody.status as string);
        expect(detailBody.finalStatus ?? detailBody.status).toBe(stopBody.finalStatus);
      } finally {
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );

  it("returns 200 for an already-terminal (completed) run with its current status", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "stop-run-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("stop-test-terminal", "fake:complete"));

      const { runId } = await manager.startRun(wfPath, storageRoot);

      // Wait for the run to complete.
      await new Promise((r) => setTimeout(r, 200));

      const app = createApiApp(manager);

      const stopRes = await postStop(app, runId);
      expect(stopRes.status).toBe(200);
      const body = await stopRes.json() as Record<string, unknown>;
      expect(typeof body.finalStatus).toBe("string");
      // Completed run stop is a no-op; status should still be terminal.
      const terminalStatuses = ["aborted", "completed", "failed", "crashed"];
      expect(terminalStatuses).toContain(body.finalStatus as string);
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns 404 for a run that does not exist", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "stop-run-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const app = createApiApp(manager);

      const res = await postStop(app, "no-such-run-id");

      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("UNKNOWN_RUN");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
