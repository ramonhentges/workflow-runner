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
  status: RunSnapshot["status"] = "failed",
  currentStepId: string | null = "step-1",
): RunSnapshot {
  return {
    id: asRunId(id),
    slug: asRunSlug(slug),
    workflowPath: "/tmp/wf.json",
    status,
    currentStepId,
    visitedStepIds: ["step-1"],
    kickoffPrompts: {},
    startedAt: BASE_TS,
    endedAt: status !== "running" ? BASE_TS + 5000 : null,
  };
}

function makeMockRm(opts: {
  status?: RunSnapshot["status"];
  currentStepId?: string | null;
  getBehavior?: "not-found" | "ambiguous";
  ambiguousCandidates?: string[];
  retryStepBehavior?: "not-retry-eligible" | "unknown-run";
}): RunManager {
  const status = opts.status ?? "failed";
  const currentStepId = opts.currentStepId !== undefined ? opts.currentStepId : "step-1";

  const active: ActiveRun = {
    run: {
      snapshot: () => fakeSnapshot("run001", "brave-otter", status, currentStepId),
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
    retryStep: async () => {
      if (opts.retryStepBehavior === "not-retry-eligible") {
        throw new RunManagerError(
          "RUN_NOT_RETRY_ELIGIBLE",
          `Run is not eligible for retry (status: ${status})`,
        );
      }
      if (opts.retryStepBehavior === "unknown-run") {
        throw new RunManagerError("UNKNOWN_RUN", "Unknown run");
      }
      // success: no-op
    },
    stop: async () => {},
    startRun: async () => { throw new Error("not impl"); },
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

async function postRetryStep(app: ReturnType<typeof createApiApp>, id: string) {
  return app.request(`/runs/${id}/retry-step`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Unit tests — POST /runs/:id/retry-step
// ---------------------------------------------------------------------------

describe("POST /runs/:id/retry-step — unit", () => {
  it("returns 200 with resumedStepId for a retry-eligible (failed) run", async () => {
    const app = createApiApp(makeMockRm({ status: "failed", currentStepId: "step-1" }));

    const res = await postRetryStep(app, "run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.resumedStepId).toBe("step-1");
  });

  it("returns 200 with resumedStepId for a retry-eligible (crashed) run", async () => {
    const app = createApiApp(makeMockRm({ status: "crashed", currentStepId: "step-2" }));

    const res = await postRetryStep(app, "run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.resumedStepId).toBe("step-2");
  });

  it("returns 200 with resumedStepId for a retry-eligible (aborted) run", async () => {
    const app = createApiApp(makeMockRm({ status: "aborted", currentStepId: "step-3" }));

    const res = await postRetryStep(app, "run001");

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.resumedStepId).toBe("step-3");
  });

  it("returns 409 RUN_NOT_RETRY_ELIGIBLE when retrying a running run", async () => {
    const app = createApiApp(
      makeMockRm({ status: "running", retryStepBehavior: "not-retry-eligible" }),
    );

    const res = await postRetryStep(app, "run001");

    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("RUN_NOT_RETRY_ELIGIBLE");
    expect(typeof body.message).toBe("string");
  });

  it("returns 409 RUN_NOT_RETRY_ELIGIBLE when retrying a completed run", async () => {
    const app = createApiApp(
      makeMockRm({ status: "completed", retryStepBehavior: "not-retry-eligible" }),
    );

    const res = await postRetryStep(app, "run001");

    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("RUN_NOT_RETRY_ELIGIBLE");
    expect(typeof body.message).toBe("string");
  });

  it("returns 404 for an unknown run id", async () => {
    const app = createApiApp(makeMockRm({ getBehavior: "not-found" }));

    const res = await postRetryStep(app, "no-such-run");

    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("UNKNOWN_RUN");
    expect(typeof body.message).toBe("string");
  });

  it("returns 409 with candidates for an ambiguous prefix", async () => {
    const candidates = ["run-abc-1", "run-abc-2"];
    const app = createApiApp(
      makeMockRm({ getBehavior: "ambiguous", ambiguousCandidates: candidates }),
    );

    const res = await postRetryStep(app, "run-abc");

    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("AMBIGUOUS_PREFIX");
    expect(Array.isArray(body.candidates)).toBe(true);
    expect(body.candidates).toEqual(candidates);
    expect(typeof body.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.json — retry-step route registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes POST /runs/:id/retry-step", () => {
  it("documents POST /runs/:id/retry-step in the OpenAPI spec", async () => {
    const app = createApiApp(makeMockRm({ getBehavior: "not-found" }));
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/runs/:id/retry-step"]).toBeDefined();
    const path = paths["/runs/:id/retry-step"] as Record<string, unknown>;
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

describe("POST /runs/:id/retry-step — integration (real RunManager)", () => {
  it(
    "retrying a failed run transitions it back to running (observable via GET /runs/:id)",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "retry-step-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      try {
        const wfPath = join(storageRoot, "test.json");
        await Bun.write(wfPath, makeWorkflowJson("retry-test", "fake:fail"));

        const { runId } = await manager.startRun(wfPath, storageRoot);

        // Wait for the run to reach "failed" state.
        await new Promise((r) => setTimeout(r, 200));

        const app = createApiApp(manager);

        // Verify the run is failed before retrying.
        const beforeRes = await app.request(`/runs/${runId}`);
        expect(beforeRes.status).toBe(200);
        const beforeBody = await beforeRes.json() as Record<string, unknown>;
        expect(beforeBody.status).toBe("failed");

        // Retry the step.
        const retryRes = await postRetryStep(app, runId);
        expect(retryRes.status).toBe(200);
        const retryBody = await retryRes.json() as Record<string, unknown>;
        expect(typeof retryBody.resumedStepId).toBe("string");
        expect(retryBody.resumedStepId).toBe("s1");

        // Immediately after retry the run should be running (fake:fail re-resolves after 50ms).
        const afterRes = await app.request(`/runs/${runId}`);
        expect(afterRes.status).toBe(200);
        const afterBody = await afterRes.json() as Record<string, unknown>;
        expect(afterBody.status).toBe("running");
      } finally {
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );

  it(
    "returns 409 RUN_NOT_RETRY_ELIGIBLE when retrying a completed run",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "retry-step-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      try {
        const wfPath = join(storageRoot, "test.json");
        await Bun.write(wfPath, makeWorkflowJson("retry-ineligible", "fake:complete"));

        const { runId } = await manager.startRun(wfPath, storageRoot);

        // Wait for the run to complete.
        await new Promise((r) => setTimeout(r, 200));

        const app = createApiApp(manager);

        const res = await postRetryStep(app, runId);
        expect(res.status).toBe(409);
        const body = await res.json() as Record<string, unknown>;
        expect(body.code).toBe("RUN_NOT_RETRY_ELIGIBLE");
        expect(typeof body.message).toBe("string");
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
      const tempDir = mkdtempSync(join(tmpdir(), "retry-step-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);
      try {
        const app = createApiApp(manager);

        const res = await postRetryStep(app, "no-such-run-id");
        expect(res.status).toBe(404);
        const body = await res.json() as Record<string, unknown>;
        expect(body.code).toBe("UNKNOWN_RUN");
      } finally {
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );
});
