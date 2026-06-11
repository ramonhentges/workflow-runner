import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findActiveRunForWorkflow } from "./workflow-run-guard.js";
import { asRunId, asRunSlug, type RunSnapshot } from "../../../domain/run.js";
import { RunManager } from "../../../infra/daemon/run-manager.js";
import {
  ControllableSessionFactory,
  FakeSessionFactory,
} from "../../../infra/daemon/test-helpers/fake-session-factory.js";

// ─── unit tests ──────────────────────────────────────────────────────────────

function makeSnap(opts: {
  id?: string;
  workflowPath: string;
  cwd?: string;
  status?: RunSnapshot["status"];
  endedAt?: number | null;
}): RunSnapshot {
  return {
    id: asRunId(opts.id ?? "run00001"),
    slug: asRunSlug("test-slug"),
    workflowPath: opts.workflowPath,
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    status: opts.status ?? "running",
    currentStepId: null,
    visitedStepIds: [],
    kickoffPrompts: {},
    startedAt: Date.now(),
    endedAt: opts.endedAt ?? null,
  };
}

describe("findActiveRunForWorkflow (unit)", () => {
  it("returns the run id when a running run matches the workflow path", () => {
    const snaps = [makeSnap({ id: "aabbccdd", workflowPath: "/proj/workflows/foo.json" })];
    const result = findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json");
    expect(result).toBe(asRunId("aabbccdd"));
  });

  it("returns null when the only matching run is completed", () => {
    const snaps = [
      makeSnap({
        workflowPath: "/proj/workflows/foo.json",
        status: "completed",
        endedAt: Date.now(),
      }),
    ];
    const result = findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json");
    expect(result).toBeNull();
  });

  it("returns null when the only matching run is failed", () => {
    const snaps = [
      makeSnap({
        workflowPath: "/proj/workflows/foo.json",
        status: "failed",
        endedAt: Date.now(),
      }),
    ];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBeNull();
  });

  it("returns null when the only matching run is crashed", () => {
    const snaps = [
      makeSnap({
        workflowPath: "/proj/workflows/foo.json",
        status: "crashed",
        endedAt: Date.now(),
      }),
    ];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBeNull();
  });

  it("returns null when the only matching run is aborted", () => {
    const snaps = [
      makeSnap({
        workflowPath: "/proj/workflows/foo.json",
        status: "aborted",
        endedAt: Date.now(),
      }),
    ];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBeNull();
  });

  it("returns null when no run references the target path", () => {
    const snaps = [makeSnap({ workflowPath: "/proj/workflows/bar.json" })];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBeNull();
  });

  it("returns null for an empty snapshot list", () => {
    expect(findActiveRunForWorkflow([], "/proj/workflows/foo.json")).toBeNull();
  });

  it("distinguishes two workflows in the same cwd — matches by full path, not directory", () => {
    const snaps = [
      makeSnap({ id: "run11111", workflowPath: "/proj/workflows/alpha.json" }),
      makeSnap({ id: "run22222", workflowPath: "/proj/workflows/beta.json", status: "completed", endedAt: Date.now() }),
    ];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/alpha.json")).toBe(asRunId("run11111"));
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/beta.json")).toBeNull();
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/gamma.json")).toBeNull();
  });

  it("returns the first running match when multiple runs reference the same path", () => {
    const snaps = [
      makeSnap({ id: "run11111", workflowPath: "/proj/workflows/foo.json" }),
      makeSnap({ id: "run22222", workflowPath: "/proj/workflows/foo.json" }),
    ];
    const result = findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json");
    expect(result).toBe(asRunId("run11111"));
  });

  it("does not match a path that is only a prefix of the target path", () => {
    const snaps = [makeSnap({ workflowPath: "/proj/workflows/foo" })];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBeNull();
  });

  it("matches a run stored with a relative path against the cwd-resolved target", () => {
    // The CLI `start` command stores the path as typed (relative), with an
    // absolute cwd. The CRUD guard passes the absolute resolveWorkflowFile path.
    const snaps = [
      makeSnap({
        id: "run33333",
        workflowPath: "workflows/foo.json",
        cwd: "/proj",
      }),
    ];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBe(
      asRunId("run33333"),
    );
  });

  it("resolves './'-prefixed relative paths against the cwd", () => {
    const snaps = [
      makeSnap({
        id: "run44444",
        workflowPath: "./workflows/foo.json",
        cwd: "/proj",
      }),
    ];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBe(
      asRunId("run44444"),
    );
  });

  it("matches a global workflow run stored with an absolute path and no cwd", () => {
    // Global runs (ADR-002) carry the absolute global file path; `cwd` is the
    // active project, but the snapshot may store the absolute path directly with
    // no cwd. `resolve("", abs)` returns the absolute path, so it still matches.
    const globalPath = "/state/workflow-runner/workflows/deploy.json";
    const snaps = [makeSnap({ id: "run55555", workflowPath: globalPath })];
    expect(findActiveRunForWorkflow(snaps, globalPath)).toBe(asRunId("run55555"));
  });

  it("does not match a relative path resolved under a different cwd", () => {
    const snaps = [
      makeSnap({
        workflowPath: "workflows/foo.json",
        cwd: "/other-proj",
      }),
    ];
    expect(findActiveRunForWorkflow(snaps, "/proj/workflows/foo.json")).toBeNull();
  });
});

// ─── integration tests ────────────────────────────────────────────────────────

const SINGLE_STEP_WORKFLOW = JSON.stringify({
  id: "test-wf",
  name: "Test Workflow",
  description: "Test",
  version: "1",
  steps: [
    {
      id: "step-1",
      agent: "test-agent",
      description: "Test step",
      mode: "autonomous",
      ide: "vscode",
      model: "test-model",
      edges: [],
    },
  ],
});

describe("findActiveRunForWorkflow (integration)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "run-guard-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports the active workflow as blocked and others as free", async () => {
    const wfPath = join(tmpDir, "wf.json");
    const otherPath = join(tmpDir, "other.json");
    await Bun.write(wfPath, SINGLE_STEP_WORKFLOW);

    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    await manager.startRun(wfPath, tmpDir);

    const snaps = manager.list({ includeOldTerminal: true });

    expect(findActiveRunForWorkflow(snaps, wfPath)).not.toBeNull();
    expect(findActiveRunForWorkflow(snaps, otherPath)).toBeNull();

    await manager.shutdown();
  });

  it("reports free after a run completes", async () => {
    const wfPath = join(tmpDir, "wf.json");
    await Bun.write(wfPath, SINGLE_STEP_WORKFLOW);

    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    const snaps = manager.list({ includeOldTerminal: true });
    expect(findActiveRunForWorkflow(snaps, wfPath)).toBeNull();

    await manager.shutdown();
  });
});
