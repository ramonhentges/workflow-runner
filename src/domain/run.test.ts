import { describe, expect, it } from "bun:test";
import { asStepId } from "./ids.js";
import {
  Run,
  asRunId,
  asRunSlug,
  type RunSnapshot,
  type RunStatus,
} from "./run.js";

const baseArgs = {
  id: asRunId("run12345"),
  slug: asRunSlug("brave-otter"),
  workflowPath: "/tmp/workflow.json",
};

function baseSnapshot(overrides: Partial<RunSnapshot> = {}): RunSnapshot {
  return {
    ...baseArgs,
    status: "running",
    currentStepId: null,
    visitedStepIds: [],
    kickoffPrompts: {},
    startedAt: 1,
    endedAt: null,
    ...overrides,
  };
}

function runWithStatus(status: RunStatus): Run {
  const terminal = status !== "running";
  return Run.fromSnapshot(
    baseSnapshot({
      status,
      endedAt: terminal ? 2 : null,
      ...(terminal && status !== "completed" ? { endReason: "done" } : {}),
    }),
  );
}

describe("Run", () => {
  it("creates a running snapshot with empty step state and no end time", () => {
    const run = Run.create(baseArgs);

    const snapshot = run.snapshot();

    expect(snapshot.id).toBe(baseArgs.id);
    expect(snapshot.slug).toBe(baseArgs.slug);
    expect(snapshot.workflowPath).toBe(baseArgs.workflowPath);
    expect(snapshot.status).toBe("running");
    expect(snapshot.currentStepId).toBeNull();
    expect(snapshot.visitedStepIds).toEqual([]);
    expect(snapshot.kickoffPrompts).toEqual({});
    expect(snapshot.startedAt).toBeGreaterThan(0);
    expect(snapshot.endedAt).toBeNull();
    expect(snapshot.endReason).toBeUndefined();
  });

  it("omits worktreePath and branch when created without them", () => {
    const snapshot = Run.create(baseArgs).snapshot();

    expect(snapshot.worktreePath).toBeUndefined();
    expect(snapshot.branch).toBeUndefined();
    expect("worktreePath" in snapshot).toBe(false);
    expect("branch" in snapshot).toBe(false);
  });

  it("emits worktreePath and branch when created with them", () => {
    const snapshot = Run.create({
      ...baseArgs,
      cwd: "/repo",
      worktreePath: "/repo-feature",
      branch: "feature/x",
    }).snapshot();

    expect(snapshot.cwd).toBe("/repo");
    expect(snapshot.worktreePath).toBe("/repo-feature");
    expect(snapshot.branch).toBe("feature/x");
  });

  it("preserves worktreePath and branch across a fromSnapshot round-trip", () => {
    const original = Run.create({
      ...baseArgs,
      cwd: "/repo",
      worktreePath: "/repo-feature",
      branch: "feature/x",
    });

    const restored = Run.fromSnapshot(original.snapshot());

    expect(restored.snapshot()).toEqual(original.snapshot());
    expect(restored.snapshot().worktreePath).toBe("/repo-feature");
    expect(restored.snapshot().branch).toBe("feature/x");
  });

  it("keeps worktreePath and branch absent across a round-trip when unset", () => {
    const original = Run.create(baseArgs);

    const restored = Run.fromSnapshot(original.snapshot());
    const snapshot = restored.snapshot();

    expect("worktreePath" in snapshot).toBe(false);
    expect("branch" in snapshot).toBe(false);
  });

  it("round-trips through snapshot and fromSnapshot", () => {
    const original = Run.create(baseArgs);
    original.markStepEntered(asStepId("step-1"), "prompt-A");
    original.markFailed("reason text");

    const restored = Run.fromSnapshot(original.snapshot());

    expect(restored.snapshot()).toEqual(original.snapshot());
  });

  it("records the current step, visited step, and kickoff prompt", () => {
    const run = Run.create(baseArgs);

    run.markStepEntered(asStepId("step-1"), "prompt-A");

    expect(run.snapshot()).toMatchObject({
      currentStepId: "step-1",
      visitedStepIds: ["step-1"],
      kickoffPrompts: { "step-1": "prompt-A" },
    });
  });

  it("appends visited steps in order and preserves each kickoff prompt", () => {
    const run = Run.create(baseArgs);

    run.markStepEntered(asStepId("step-1"), "prompt-A");
    run.markStepEntered(asStepId("step-2"), "prompt-B");

    const snapshot = run.snapshot();
    expect(snapshot.currentStepId).toBe("step-2");
    expect(snapshot.visitedStepIds).toEqual(["step-1", "step-2"]);
    expect(snapshot.kickoffPrompts).toEqual({
      "step-1": "prompt-A",
      "step-2": "prompt-B",
    });
  });

  it("transitions running to completed and sets endedAt", () => {
    const run = Run.fromSnapshot(baseSnapshot({ startedAt: 1 }));

    run.markCompleted();

    const snapshot = run.snapshot();
    expect(snapshot.status).toBe("completed");
    expect(snapshot.endedAt).toBeNumber();
    expect(snapshot.endedAt!).toBeGreaterThan(snapshot.startedAt);
    expect(snapshot.endReason).toBeUndefined();
  });

  it("transitions running to failed with an end reason", () => {
    const run = Run.fromSnapshot(baseSnapshot({ startedAt: 1 }));

    run.markFailed("reason text");

    const snapshot = run.snapshot();
    expect(snapshot.status).toBe("failed");
    expect(snapshot.endedAt).toBeNumber();
    expect(snapshot.endedAt!).toBeGreaterThan(snapshot.startedAt);
    expect(snapshot.endReason).toBe("reason text");
  });

  it("transitions running to crashed with an end reason", () => {
    const run = Run.fromSnapshot(baseSnapshot({ startedAt: 1 }));

    run.markCrashed("daemon restart");

    const snapshot = run.snapshot();
    expect(snapshot.status).toBe("crashed");
    expect(snapshot.endedAt).toBeNumber();
    expect(snapshot.endedAt!).toBeGreaterThan(snapshot.startedAt);
    expect(snapshot.endReason).toBe("daemon restart");
  });

  it("transitions running to aborted and sets endedAt", () => {
    const run = Run.fromSnapshot(baseSnapshot({ startedAt: 1 }));

    run.markAborted();

    const snapshot = run.snapshot();
    expect(snapshot.status).toBe("aborted");
    expect(snapshot.endedAt).toBeNumber();
    expect(snapshot.endedAt!).toBeGreaterThan(snapshot.startedAt);
  });

  it("rejects markCompleted called twice and names the source status", () => {
    const run = Run.fromSnapshot(baseSnapshot({ startedAt: 1 }));
    run.markCompleted();

    expect(() => run.markCompleted()).toThrow(
      /Illegal status transition from 'completed' to 'completed'/,
    );
  });

  it("rejects markStepEntered after completion", () => {
    const run = Run.fromSnapshot(baseSnapshot({ startedAt: 1 }));
    run.markCompleted();

    expect(() =>
      run.markStepEntered(asStepId("step-2"), "prompt-B"),
    ).toThrow(/Cannot enter step from status 'completed'/);
  });

  it.each([
    ["completed", "failed"],
    ["failed", "crashed"],
    ["crashed", "aborted"],
    ["aborted", "completed"],
  ] as const)(
    "rejects illegal terminal transition from %s to %s",
    (fromStatus, toStatus) => {
      const run = runWithStatus(fromStatus);

      const transition = () => {
        if (toStatus === "completed") run.markCompleted();
        if (toStatus === "failed") run.markFailed("reason");
        if (toStatus === "crashed") run.markCrashed("reason");
        if (toStatus === "aborted") run.markAborted();
      };

      expect(transition).toThrow(
        `Illegal status transition from '${fromStatus}' to '${toStatus}'`,
      );
    },
  );

  it.each([
    ["running", false],
    ["completed", false],
    ["failed", true],
    ["crashed", true],
    ["aborted", true],
  ] as const)("reports retry eligibility for %s", (status, expected) => {
    expect(runWithStatus(status).eligibleForRetry()).toBe(expected);
  });

  it("keeps mutators callable for a running snapshot", () => {
    const run = Run.fromSnapshot(baseSnapshot({ status: "running" }));

    run.markStepEntered(asStepId("step-1"), "prompt-A");
    run.markCompleted();

    expect(run.snapshot().status).toBe("completed");
  });

  it("keeps terminal snapshots immutable through mutators", () => {
    const run = Run.fromSnapshot(
      baseSnapshot({ status: "completed", endedAt: 2 }),
    );

    expect(() =>
      run.markStepEntered(asStepId("step-1"), "prompt-A"),
    ).toThrow(/Cannot enter step from status 'completed'/);
  });

  it("returns defensive copies from snapshot", () => {
    const run = Run.create(baseArgs);
    run.markStepEntered(asStepId("step-1"), "prompt-A");

    const snapshot = run.snapshot();
    snapshot.visitedStepIds.push(asStepId("step-2"));
    snapshot.kickoffPrompts["step-1"] = "changed";

    expect(run.snapshot().visitedStepIds).toEqual(["step-1"]);
    expect(run.snapshot().kickoffPrompts).toEqual({ "step-1": "prompt-A" });
  });
});
