import { describe, expect, it } from "bun:test";
import { Run, asRunId, asRunSlug } from "../../../domain/run.js";
import type { RunId, RunSlug, RunSnapshot, RunStatus } from "../../../domain/run.js";
import { WorkflowConfigError } from "../../../domain/workflow.js";
import { asStepId } from "../../../domain/ids.js";
import type { StepId } from "../../../domain/ids.js";
import type { ActiveRun, RunManager, RunSubscriber } from "../run-manager.js";
import { RunManagerError } from "../run-manager.js";
import { RpcErrorCode, type EventLogEntry } from "../protocol.js";
import { RpcError } from "../rpc/server.js";
import { resolveRun } from "./_resolve-run.js";
import { createRunStartHandler } from "./run-start.js";
import { createRunStopHandler } from "./run-stop.js";
import { createRunRetryStepHandler } from "./run-retry-step.js";
import { createRunPsHandler } from "./run-ps.js";
import { createRunAttachHandler } from "./run-attach.js";
import { createRunSendHandler } from "./run-send.js";
import { createDaemonDoctorHandler } from "./daemon-doctor.js";
import { createDaemonShutdownHandler } from "./daemon-shutdown.js";
import { createMockRpcContext } from "../rpc/__tests__/mock-context.js";
import type { EventLog, ReadEventsSinceResult } from "../event-log.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: {
  id?: string;
  slug?: string;
  status?: RunStatus;
  currentStepId?: StepId | null;
  visitedStepIds?: StepId[];
  kickoffPrompts?: Record<StepId, string>;
  startedAt?: number;
  endedAt?: number | null;
} = {}): RunSnapshot {
  return {
    id: asRunId(overrides.id ?? "abc12345"),
    slug: asRunSlug(overrides.slug ?? "brave-otter"),
    workflowPath: "/tmp/wf.json",
    status: overrides.status ?? "running",
    currentStepId: overrides.currentStepId ?? null,
    visitedStepIds: overrides.visitedStepIds ?? [],
    kickoffPrompts: overrides.kickoffPrompts ?? {},
    startedAt: overrides.startedAt ?? Date.now() - 1000,
    endedAt: overrides.endedAt ?? null,
  };
}

function makeActiveRun(snap: RunSnapshot, subscriberCount = 0): ActiveRun {
  const run = Run.fromSnapshot(snap);
  const subscribers = new Set<{ onEvent: () => void }>(
    Array.from({ length: subscriberCount }, () => ({ onEvent: () => {} })),
  );
  return {
    run,
    runner: null,
    mcpServer: null,
    eventLog: null,
    subscribers: subscribers as unknown as ActiveRun["subscribers"],
    runPromise: null,
  };
}

type PartialRunManager = Pick<RunManager, "startRun" | "list" | "get" | "stop" | "retryStep">;

/** Minimal RpcContext for handler invocation. */
const noopCtx = {
  notify: async () => {},
  onClose: () => {},
};

// ---------------------------------------------------------------------------
// run-start handler
// ---------------------------------------------------------------------------

describe("createRunStartHandler", () => {
  it("returns runId and slug on success", async () => {
    const expected = { runId: asRunId("abc12345"), slug: asRunSlug("brave-otter") };
    const rm = {
      startRun: async (_path: string, _cwd: string) => expected,
    } as unknown as RunManager;

    const handler = createRunStartHandler(rm);
    const result = await handler({ workflowPath: "/tmp/wf.json", cwd: "/work" }, noopCtx);
    expect(result).toEqual(expected);
  });

  it("forwards cwd unchanged to RunManager.startRun", async () => {
    const expected = { runId: asRunId("abc12345"), slug: asRunSlug("brave-otter") };
    const startRunCalls: Array<{ path: string; cwd: string }> = [];
    const rm = {
      startRun: async (path: string, cwd: string) => {
        startRunCalls.push({ path, cwd });
        return expected;
      },
    } as unknown as RunManager;

    const handler = createRunStartHandler(rm);
    await handler({ workflowPath: "/tmp/wf.json", cwd: "/my/project" }, noopCtx);

    expect(startRunCalls).toHaveLength(1);
    expect(startRunCalls[0]!.cwd).toBe("/my/project");
    expect(startRunCalls[0]!.path).toBe("/tmp/wf.json");
  });

  it("maps WorkflowConfigError to WORKFLOW_INVALID", async () => {
    const rm = {
      startRun: async () => {
        throw new WorkflowConfigError("Malformed JSON in '/tmp/bad.json': ...");
      },
    } as unknown as RunManager;

    const handler = createRunStartHandler(rm);
    const err = await handler({ workflowPath: "/tmp/bad.json", cwd: "/work" }, noopCtx).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.WORKFLOW_INVALID);
    expect((err as RpcError).message).toContain("Malformed JSON");
  });

  it("re-throws raw infrastructure errors so RpcServer renders -32603", async () => {
    const infraError = Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
    const rm = {
      startRun: async () => {
        throw infraError;
      },
    } as unknown as RunManager;

    const handler = createRunStartHandler(rm);
    const err = await handler({ workflowPath: "/tmp/wf.json", cwd: "/work" }, noopCtx).catch((e) => e);
    expect(err).toBe(infraError);
    expect(err).not.toBeInstanceOf(RpcError);
  });

  it("maps RunLimitReachedError to RUN_LIMIT_REACHED", async () => {
    const rm = {
      startRun: async () => {
        throw new RunManagerError("RUN_LIMIT_REACHED", "Run limit of 16 reached");
      },
    } as unknown as RunManager;

    const handler = createRunStartHandler(rm);
    const err = await handler({ workflowPath: "/tmp/wf.json", cwd: "/work" }, noopCtx).catch((e) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.RUN_LIMIT_REACHED);
  });
});

// ---------------------------------------------------------------------------
// run-stop handler
// ---------------------------------------------------------------------------

describe("createRunStopHandler", () => {
  it("calls rm.stop with the resolved run id and returns finalStatus", async () => {
    const snap = makeSnapshot({ status: "running" });
    const active = makeActiveRun(snap);
    const stopCalls: string[] = [];

    const rm: PartialRunManager = {
      get: (prefix: string) => (prefix === "abc" || prefix === "abc12345" ? active : undefined),
      stop: async (runId: RunId) => {
        stopCalls.push(runId);
        active.run.markAborted();
      },
    } as unknown as PartialRunManager;

    const handler = createRunStopHandler(rm as unknown as RunManager);
    const result = await handler({ runId: asRunId("abc") }, noopCtx);

    expect(stopCalls).toHaveLength(1);
    expect(stopCalls[0]).toBe("abc12345");
    expect(result.finalStatus).toBe("aborted");
  });

  it("rejects with AMBIGUOUS_PREFIX when prefix matches multiple runs", async () => {
    const candidates = [asRunId("abc12345"), asRunId("abc67890")];
    const rm: PartialRunManager = {
      get: () => {
        throw new RunManagerError(
          "AMBIGUOUS_PREFIX",
          "Prefix 'a' matches multiple runs",
          { candidates },
        );
      },
    } as unknown as PartialRunManager;

    const handler = createRunStopHandler(rm as unknown as RunManager);
    const err = await handler({ runId: asRunId("a") }, noopCtx).catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.AMBIGUOUS_PREFIX);
    const data = (err as RpcError).data as { candidates: RunId[] };
    expect(data.candidates).toEqual(candidates);
  });

  it("rejects with UNKNOWN_RUN when no run matches", async () => {
    const rm: PartialRunManager = {
      get: () => undefined,
    } as unknown as PartialRunManager;

    const handler = createRunStopHandler(rm as unknown as RunManager);
    const err = await handler({ runId: asRunId("zzzz") }, noopCtx).catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.UNKNOWN_RUN);
  });
});

// ---------------------------------------------------------------------------
// run-retry-step handler
// ---------------------------------------------------------------------------

describe("createRunRetryStepHandler", () => {
  it("resolves with resumedStepId for an eligible run", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({
      status: "crashed",
      currentStepId: stepId,
      visitedStepIds: [stepId],
      kickoffPrompts: { [stepId]: "do something" } as Record<StepId, string>,
    });
    const active = makeActiveRun(snap);

    const rm: PartialRunManager = {
      get: (_prefix: string) => active,
      retryStep: async (_runId: RunId) => {
        // RunManager transitions run back to running internally
      },
    } as unknown as PartialRunManager;

    const handler = createRunRetryStepHandler(rm as unknown as RunManager);
    const result = await handler({ runId: asRunId("abc12345") }, noopCtx);

    expect(result.resumedStepId).toBe(stepId);
  });

  it("rejects with RUN_NOT_RETRY_ELIGIBLE when run is still running", async () => {
    const snap = makeSnapshot({ status: "running", currentStepId: asStepId("step-1") });
    const active = makeActiveRun(snap);

    const rm: PartialRunManager = {
      get: (_prefix: string) => active,
      retryStep: async (_runId: RunId) => {
        throw new RunManagerError(
          "RUN_NOT_RETRY_ELIGIBLE",
          "Run is not eligible for retry (status: running)",
        );
      },
    } as unknown as PartialRunManager;

    const handler = createRunRetryStepHandler(rm as unknown as RunManager);
    const err = await handler({ runId: asRunId("abc12345") }, noopCtx).catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE);
  });

  it("maps WorkflowConfigError to WORKFLOW_INVALID", async () => {
    const snap = makeSnapshot({
      status: "crashed",
      currentStepId: asStepId("step-1"),
      visitedStepIds: [asStepId("step-1")],
      kickoffPrompts: { [asStepId("step-1")]: "do something" } as Record<StepId, string>,
    });
    const active = makeActiveRun(snap);

    const rm: PartialRunManager = {
      get: (_prefix: string) => active,
      retryStep: async (_runId: RunId) => {
        throw new WorkflowConfigError("Malformed JSON in workflow: ...");
      },
    } as unknown as PartialRunManager;

    const handler = createRunRetryStepHandler(rm as unknown as RunManager);
    const err = await handler({ runId: asRunId("abc12345") }, noopCtx).catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.WORKFLOW_INVALID);
    expect((err as RpcError).message).toContain("Malformed JSON");
  });
});

// ---------------------------------------------------------------------------
// run-ps handler
// ---------------------------------------------------------------------------

describe("createRunPsHandler", () => {
  it("returns runs with all expected fields and attachedCount", async () => {
    const now = Date.now();
    const snaps = [
      makeSnapshot({ id: "run00001", slug: "brave-otter", status: "running", startedAt: now - 5000 }),
      makeSnapshot({ id: "run00002", slug: "wise-fox", status: "running", startedAt: now - 3000 }),
      makeSnapshot({ id: "run00003", slug: "calm-badger", status: "running", startedAt: now - 1000 }),
    ];
    const actives = [
      makeActiveRun(snaps[0]!, 1),
      makeActiveRun(snaps[1]!, 0),
      makeActiveRun(snaps[2]!, 2),
    ];

    const rm: PartialRunManager = {
      list: () => snaps,
      get: (id: string) => actives.find((a) => a.run.snapshot().id === id),
    } as unknown as PartialRunManager;

    const handler = createRunPsHandler(rm as unknown as RunManager);
    const result = await handler({}, noopCtx);

    expect(result.runs).toHaveLength(3);

    const first = result.runs[0]!;
    expect(first.id).toBe(asRunId("run00001"));
    expect(first.slug).toBe(asRunSlug("brave-otter"));
    expect(first.workflowPath).toBe("/tmp/wf.json");
    expect(first.status).toBe("running");
    expect(first.currentStepId).toBe(null);
    expect(typeof first.startedAt).toBe("number");
    expect(first.attachedCount).toBe(1);

    expect(result.runs[1]!.attachedCount).toBe(0);
    expect(result.runs[2]!.attachedCount).toBe(2);
  });

  it("passes includeOldTerminal: true to list() when all: true", async () => {
    const listCalls: Array<Parameters<RunManager["list"]>> = [];

    const rm: PartialRunManager = {
      list: (...args: Parameters<RunManager["list"]>) => {
        listCalls.push(args);
        return [];
      },
      get: () => undefined,
    } as unknown as PartialRunManager;

    const handler = createRunPsHandler(rm as unknown as RunManager);
    await handler({ all: true }, noopCtx);

    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]![0]).toEqual({ includeOldTerminal: true });
  });

  it("passes includeOldTerminal: false to list() when all is absent", async () => {
    const listCalls: Array<Parameters<RunManager["list"]>> = [];

    const rm: PartialRunManager = {
      list: (...args: Parameters<RunManager["list"]>) => {
        listCalls.push(args);
        return [];
      },
      get: () => undefined,
    } as unknown as PartialRunManager;

    const handler = createRunPsHandler(rm as unknown as RunManager);
    await handler({}, noopCtx);

    expect(listCalls).toHaveLength(1);
    expect(listCalls[0]![0]).toEqual({ includeOldTerminal: false });
  });

  it("preserves list() ordering — active before terminal-state runs", async () => {
    const now = Date.now();
    const runningSnap = makeSnapshot({
      id: "run00001",
      slug: "brave-otter",
      status: "running",
      startedAt: now - 5000,
    });
    const completedSnap = makeSnapshot({
      id: "run00002",
      slug: "wise-fox",
      status: "completed",
      startedAt: now - 10000,
      endedAt: now - 1000,
    });

    // list() returns running first, then completed — handler must preserve order.
    const rm: PartialRunManager = {
      list: () => [runningSnap, completedSnap],
      get: (id: string) => {
        if (id === "run00001") return makeActiveRun(runningSnap);
        if (id === "run00002") return makeActiveRun(completedSnap);
        return undefined;
      },
    } as unknown as PartialRunManager;

    const handler = createRunPsHandler(rm as unknown as RunManager);
    const result = await handler({}, noopCtx);

    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]!.status).toBe("running");
    expect(result.runs[1]!.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// _resolve-run
// ---------------------------------------------------------------------------

describe("resolveRun", () => {
  it("returns runId and active for an exact id match", () => {
    const snap = makeSnapshot();
    const active = makeActiveRun(snap);
    const rm = { get: (_id: string) => active } as unknown as RunManager;

    const result = resolveRun(rm, "abc12345");
    expect(result.runId).toBe(asRunId("abc12345"));
    expect(result.active).toBe(active);
  });

  it("returns the run for an exact slug match", () => {
    const snap = makeSnapshot();
    const active = makeActiveRun(snap);
    const rm = {
      get: (prefix: string) => (prefix === "brave-otter" ? active : undefined),
    } as unknown as RunManager;

    const result = resolveRun(rm, "brave-otter");
    expect(result.runId).toBe(asRunId("abc12345"));
  });

  it("returns the run for an unambiguous prefix", () => {
    const snap = makeSnapshot();
    const active = makeActiveRun(snap);
    const rm = {
      get: (prefix: string) => (prefix === "abc" ? active : undefined),
    } as unknown as RunManager;

    const result = resolveRun(rm, "abc");
    expect(result.runId).toBe(asRunId("abc12345"));
  });

  it("throws UNKNOWN_RUN for a prefix that matches nothing", () => {
    const rm = { get: () => undefined } as unknown as RunManager;

    expect(() => resolveRun(rm, "zzzz")).toThrow(RpcError);
    try {
      resolveRun(rm, "zzzz");
    } catch (e) {
      expect((e as RpcError).code).toBe(RpcErrorCode.UNKNOWN_RUN);
    }
  });

  it("throws AMBIGUOUS_PREFIX with candidates for an ambiguous prefix", () => {
    const candidates = [asRunId("abc12345"), asRunId("abc67890")];
    const rm = {
      get: () => {
        throw new RunManagerError(
          "AMBIGUOUS_PREFIX",
          "Prefix 'a' matches multiple runs",
          { candidates },
        );
      },
    } as unknown as RunManager;

    try {
      resolveRun(rm, "a");
      expect(true).toBe(false); // unreachable
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe(RpcErrorCode.AMBIGUOUS_PREFIX);
      const data = (e as RpcError).data as { candidates: RunId[] };
      expect(data.candidates).toEqual(candidates);
    }
  });
});

// ---------------------------------------------------------------------------
// run-attach handler
// ---------------------------------------------------------------------------

interface FakeEventLogControls {
  ring: EventLogEntry[] | null;
  disk: EventLogEntry[];
  ringCalls: StepId[];
  diskCalls: StepId[];
  readEventsSinceCalls: number[];
  flushCalls: number;
}

function makeFakeEventLog(): {
  eventLog: EventLog;
  controls: FakeEventLogControls;
} {
  const controls: FakeEventLogControls = {
    ring: [],
    disk: [],
    ringCalls: [],
    diskCalls: [],
    readEventsSinceCalls: [],
    flushCalls: 0,
  };
  const eventLog = {
    runDir: "/tmp/run-dir",
    append: async () => null,
    currentStepBacklog: (stepId: StepId): EventLogEntry[] | null => {
      controls.ringCalls.push(stepId);
      return controls.ring;
    },
    readBackwardForCurrentStep: async (
      stepId: StepId,
    ): Promise<EventLogEntry[]> => {
      controls.diskCalls.push(stepId);
      return controls.disk;
    },
    readEventsSince: async (fromSeq: number): Promise<ReadEventsSinceResult> => {
      controls.readEventsSinceCalls.push(fromSeq);
      return { entries: controls.disk.filter((e) => e.seq > fromSeq), truncated: false };
    },
    flush: async (): Promise<void> => {
      controls.flushCalls++;
    },
    close: async () => {},
  } as unknown as EventLog;
  return { eventLog, controls };
}

function makeAttachActiveRun(args: {
  snap: RunSnapshot;
  eventLog?: EventLog;
}): ActiveRun & { subscribers: Set<RunSubscriber> } {
  const run = Run.fromSnapshot(args.snap);
  return {
    run,
    runner: null,
    mcpServer: null,
    eventLog: args.eventLog ?? null,
    subscribers: new Set<RunSubscriber>(),
    runPromise: null,
  };
}

function makeEntry(seq: number, partial: Partial<EventLogEntry> = {}): EventLogEntry {
  return {
    seq,
    ts: 1_000_000 + seq,
    stepId: partial.stepId ?? asStepId("step-1"),
    event:
      partial.event ??
      ({ type: "log", message: `e${seq}` } as EventLogEntry["event"]),
  };
}

describe("createRunAttachHandler", () => {
  it("returns resolved runId and initialSnapshot matching the resolved run's snapshot", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId, visitedStepIds: [stepId] });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [];
    const active = makeAttachActiveRun({ snap, eventLog });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345") }, ctx);

    expect(result.runId).toBe(asRunId("abc12345"));
    expect(result.initialSnapshot).toEqual(active.run.snapshot());
    expect(result.backlog).toEqual([]);
  });

  it("returns ring backlog entries in result", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId, visitedStepIds: [stepId] });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [makeEntry(1), makeEntry(2), makeEntry(3)];
    const active = makeAttachActiveRun({ snap, eventLog });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345") }, ctx);

    expect(result.backlog).toHaveLength(3);
    expect(controls.ringCalls).toEqual([stepId]);
    expect(controls.diskCalls).toEqual([]);
    const seqs = result.backlog.map((e: EventLogEntry) => e.seq);
    expect(seqs).toEqual([1, 2, 3]);
  });

  it("falls back to disk read when ring returns null and returns entries in result", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = null;
    controls.disk = [makeEntry(10), makeEntry(11)];
    const active = makeAttachActiveRun({ snap, eventLog });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345") }, ctx);

    expect(controls.ringCalls).toEqual([stepId]);
    expect(controls.diskCalls).toEqual([stepId]);

    expect(result.backlog).toHaveLength(2);
    expect(result.backlog.map((e: EventLogEntry) => e.seq)).toEqual([10, 11]);
  });

  it("registers a subscriber that receives subsequent runner events as notifications", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [];
    const active = makeAttachActiveRun({ snap, eventLog });

    let attachedSub: RunSubscriber | null = null;
    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        attachedSub = sub;
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    await handler({ runId: asRunId("abc12345") }, ctx);

    expect(attachedSub).not.toBeNull();
    const liveEntry = makeEntry(42);
    attachedSub!.onEvent(liveEntry);

    await ctx.waitForNotifications(1);
    const events = ctx.notificationsByMethod("event.run.event");
    expect(events).toHaveLength(1);
    expect((events[0]!.params as { entry: EventLogEntry }).entry.seq).toBe(42);
  });

  it("emits event.run.statusChanged when subscriber.onStatusChanged fires", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [];
    const active = makeAttachActiveRun({ snap, eventLog });

    let attachedSub: RunSubscriber | null = null;
    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        attachedSub = sub;
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    await handler({ runId: asRunId("abc12345") }, ctx);

    attachedSub!.onStatusChanged?.("completed" as RunStatus);

    await ctx.waitForNotifications(1);
    const statusNotes = ctx.notificationsByMethod("event.run.statusChanged");
    expect(statusNotes).toHaveLength(1);
    expect((statusNotes[0]!.params as { status: RunStatus }).status).toBe(
      "completed",
    );
  });

  it("detaches the subscriber on ctx.onClose exactly once", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [];
    const active = makeAttachActiveRun({ snap, eventLog });

    let detachCallCount = 0;
    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => {
          detachCallCount++;
          active.subscribers.delete(sub);
        };
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    await handler({ runId: asRunId("abc12345") }, ctx);

    expect(ctx.closeCallbackCount).toBe(1);
    ctx.triggerClose();
    // Idempotent: a second triggerClose call does nothing because the
    // MockRpcContext suppresses repeat invocations, and the handler also
    // guards against double-detach.
    ctx.triggerClose();

    expect(detachCallCount).toBe(1);
    expect(active.subscribers.size).toBe(0);
  });

  it("closes owned EventLog via ctx.onClose when active.eventLog is null", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId, status: "completed" });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [];
    const active = makeAttachActiveRun({ snap }); // no eventLog — terminal run

    let closeCalled = false;
    (eventLog as unknown as Record<string, unknown>).close = async () => {
      closeCalled = true;
    };

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
      openEventLog: async (_runId: RunId) => eventLog,
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    await handler({ runId: asRunId("abc12345") }, ctx);

    expect(closeCalled).toBe(false);
    ctx.triggerClose();
    // close() is async; give the microtask queue a turn.
    await Promise.resolve();
    expect(closeCalled).toBe(true);
  });

  it("does not close active.eventLog owned by the runner on ctx.onClose", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId, status: "running" });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [];

    let closeCalled = false;
    (eventLog as unknown as Record<string, unknown>).close = async () => {
      closeCalled = true;
    };

    // eventLog is passed in active — simulates a running run where the runner owns it
    const active = makeAttachActiveRun({ snap, eventLog });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    await handler({ runId: asRunId("abc12345") }, ctx);

    ctx.triggerClose();
    await Promise.resolve();
    // The attach handler must not close a handle it does not own.
    expect(closeCalled).toBe(false);
  });

  it("propagates AMBIGUOUS_PREFIX as RpcError", async () => {
    const candidates = [asRunId("abc11111"), asRunId("abc22222")];
    const rm = {
      get: () => {
        throw new RunManagerError(
          "AMBIGUOUS_PREFIX",
          "Prefix 'abc' matches multiple runs",
          { candidates },
        );
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const err = await handler({ runId: asRunId("abc") }, ctx).catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.AMBIGUOUS_PREFIX);
  });

  it("opens EventLog via RunManager.openEventLog when active.eventLog is null (ring path)", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId, visitedStepIds: [stepId] });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = [makeEntry(1), makeEntry(2)];
    const active = makeAttachActiveRun({ snap });

    let openEventLogCalled = false;
    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
      openEventLog: async (_runId: RunId) => {
        openEventLogCalled = true;
        return eventLog;
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345") }, ctx);

    expect(openEventLogCalled).toBe(true);
    expect(controls.ringCalls).toEqual([stepId]);
    expect(controls.diskCalls).toEqual([]);

    expect(result.backlog).toHaveLength(2);
    const seqs = result.backlog.map((e: EventLogEntry) => e.seq);
    expect(seqs).toEqual([1, 2]);
  });

  it("opens EventLog via RunManager.openEventLog and falls back to disk read (ring returns null)", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = null;
    controls.disk = [makeEntry(10)];
    const active = makeAttachActiveRun({ snap });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
      openEventLog: async (_runId: RunId) => eventLog,
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345") }, ctx);

    expect(controls.ringCalls).toEqual([stepId]);
    expect(controls.diskCalls).toEqual([stepId]);

    expect(result.backlog).toHaveLength(1);
    expect(result.backlog[0]!.seq).toBe(10);
  });

  it("handles gracefully when openEventLog returns null (no historical events)", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId });
    const active = makeAttachActiveRun({ snap });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
      openEventLog: async (_runId: RunId) => null,
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345") }, ctx);

    expect(result.runId).toBe(asRunId("abc12345"));
    expect(result.backlog).toEqual([]);
  });

  it("returns fromSeq backlog with gap-closing on race", async () => {
    const snap = makeSnapshot({ status: "completed" });
    const { eventLog, controls } = makeFakeEventLog();
    controls.disk = [makeEntry(10), makeEntry(11), makeEntry(12)];
    const active = makeAttachActiveRun({ snap, eventLog });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345"), fromSeq: 9 }, ctx);

    expect(result.backlog).toHaveLength(3);
    expect(result.backlog.map((e: EventLogEntry) => e.seq)).toEqual([10, 11, 12]);
    expect(controls.readEventsSinceCalls).toHaveLength(2);
    expect(controls.readEventsSinceCalls[0]).toBe(9);
    expect(controls.readEventsSinceCalls[1]).toBe(12);
  });

  it("deduplicates gap events when closing race window", async () => {
    const snap = makeSnapshot({ status: "completed" });
    const { eventLog, controls } = makeFakeEventLog();
    const e10 = makeEntry(10);
    const e11 = makeEntry(11);
    const e12 = makeEntry(12);
    controls.disk = [e10, e11, e12];
    const active = makeAttachActiveRun({ snap, eventLog });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345"), fromSeq: 10 }, ctx);

    expect(result.backlog).toHaveLength(2);
    expect(result.backlog.map((e: EventLogEntry) => e.seq)).toEqual([11, 12]);
    expect(controls.readEventsSinceCalls).toHaveLength(2);
    expect(controls.readEventsSinceCalls[0]).toBe(10);
    expect(controls.readEventsSinceCalls[1]).toBe(12);
  });

  it("flushes pending writes before gap-read to close the in-flight append race", async () => {
    const snap = makeSnapshot({ status: "completed" });
    const { eventLog, controls } = makeFakeEventLog();
    controls.disk = [makeEntry(5), makeEntry(6)];
    const active = makeAttachActiveRun({ snap, eventLog });

    const callOrder: Array<"flush" | "readEventsSince"> = [];
    const originalFlush = (eventLog as unknown as Record<string, unknown>).flush as () => Promise<void>;
    (eventLog as unknown as Record<string, unknown>).flush = async () => {
      callOrder.push("flush");
      return originalFlush();
    };
    const originalRead = (eventLog as unknown as Record<string, unknown>).readEventsSince as (n: number) => Promise<ReadEventsSinceResult>;
    (eventLog as unknown as Record<string, unknown>).readEventsSince = async (fromSeq: number) => {
      callOrder.push("readEventsSince");
      return originalRead(fromSeq);
    };

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    await handler({ runId: asRunId("abc12345"), fromSeq: 4 }, ctx);

    expect(controls.flushCalls).toBe(1);
    // gap-read is always the last readEventsSince; flush must precede it
    const lastFlushPos = callOrder.lastIndexOf("flush");
    const gapReadPos = callOrder.lastIndexOf("readEventsSince");
    expect(lastFlushPos).toBeGreaterThanOrEqual(0);
    expect(gapReadPos).toBeGreaterThan(lastFlushPos);
  });

  it("skips gap-read when currentStepId exists but backlog is empty (no anchor)", async () => {
    const stepId = asStepId("step-1");
    const snap = makeSnapshot({ currentStepId: stepId });
    const { eventLog, controls } = makeFakeEventLog();
    controls.ring = null;
    controls.disk = [];
    const active = makeAttachActiveRun({ snap, eventLog });

    const rm = {
      get: () => active,
      attachSubscriber: (_runId: RunId, sub: RunSubscriber) => {
        active.subscribers.add(sub);
        return () => active.subscribers.delete(sub);
      },
    } as unknown as RunManager;

    const ctx = createMockRpcContext();
    const handler = createRunAttachHandler(rm);
    const result = await handler({ runId: asRunId("abc12345") }, ctx);

    expect(result.backlog).toHaveLength(0);
    expect(controls.readEventsSinceCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// run-send handler
// ---------------------------------------------------------------------------

describe("createRunSendHandler", () => {
  it("returns acceptedSeq from RunManager.sendInput", async () => {
    const snap = makeSnapshot({ status: "running" });
    const active = makeActiveRun(snap);
    const sendCalls: Array<{ runId: RunId; message: string }> = [];

    const rm = {
      get: () => active,
      sendInput: async (runId: RunId, message: string) => {
        sendCalls.push({ runId, message });
        return 42;
      },
    } as unknown as RunManager;

    const handler = createRunSendHandler(rm);
    const result = await handler(
      { runId: asRunId("abc12345"), message: "hello" },
      noopCtx,
    );

    expect(result).toEqual({ acceptedSeq: 42 });
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]!.runId).toBe(asRunId("abc12345"));
    expect(sendCalls[0]!.message).toBe("hello");
  });

  it("rejects with RUN_NOT_INTERACTIVE for an autonomous step", async () => {
    const snap = makeSnapshot({ status: "running" });
    const active = makeActiveRun(snap);

    const rm = {
      get: () => active,
      sendInput: async () => {
        throw new RunManagerError(
          "RUN_NOT_INTERACTIVE",
          "Run abc is not in an interactive step",
        );
      },
    } as unknown as RunManager;

    const handler = createRunSendHandler(rm);
    const err = await handler(
      { runId: asRunId("abc12345"), message: "hi" },
      noopCtx,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.RUN_NOT_INTERACTIVE);
  });

  it("rejects with UNKNOWN_RUN when the run is missing", async () => {
    const rm = {
      get: () => undefined,
    } as unknown as RunManager;

    const handler = createRunSendHandler(rm);
    const err = await handler(
      { runId: asRunId("zzzz"), message: "hi" },
      noopCtx,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RpcErrorCode.UNKNOWN_RUN);
  });
});

// ---------------------------------------------------------------------------
// daemon-doctor handler
// ---------------------------------------------------------------------------

describe("createDaemonDoctorHandler", () => {
  it("returns a DoctorReport with every subsystem populated", async () => {
    const rm = { list: () => [] as RunSnapshot[] } as unknown as RunManager;

    const handler = createDaemonDoctorHandler(rm, {
      storageRoot: "/tmp/fake",
      countActiveSubprocesses: () => 0,
      countOrphanPorts: () => 0,
      readLockfile: async () => ({ valid: true, pid: 1234 }),
      diskUsage: async () => 100,
    });

    const report = await handler({}, noopCtx);

    expect(report.socket.status).toBe("ok");
    expect(report.lockfile.status).toBe("ok");
    expect(report.activeRuns).toEqual({ status: "ok", count: 0 });
    expect(report.agentSubprocesses).toEqual({ status: "ok", count: 0 });
    expect(report.diskUsageBytes).toEqual({ status: "ok", bytes: 100 });
    expect(report.orphanPorts).toEqual({ status: "ok", count: 0 });
  });

  it("reports active-run count from RunManager.list()", async () => {
    const running = makeSnapshot({ id: "run00001", status: "running" });
    const completed = makeSnapshot({
      id: "run00002",
      status: "completed",
      endedAt: Date.now(),
    });
    const rm = { list: () => [running, completed] } as unknown as RunManager;

    const handler = createDaemonDoctorHandler(rm, {
      storageRoot: "/tmp/fake",
      countActiveSubprocesses: () => 0,
      countOrphanPorts: () => 0,
      readLockfile: async () => ({ valid: true, pid: 1 }),
      diskUsage: async () => 0,
    });

    const report = await handler({}, noopCtx);
    expect(report.activeRuns.count).toBe(1);
  });

  it("reports lockfile fail when readLockfile returns invalid", async () => {
    const rm = { list: () => [] } as unknown as RunManager;

    const handler = createDaemonDoctorHandler(rm, {
      storageRoot: "/tmp/fake",
      countActiveSubprocesses: () => 0,
      countOrphanPorts: () => 0,
      readLockfile: async () => ({ valid: false, detail: "lockfile missing" }),
      diskUsage: async () => 0,
    });

    const report = await handler({}, noopCtx);
    expect(report.lockfile.status).toBe("fail");
    expect(report.lockfile.detail).toBe("lockfile missing");
  });

  it("reports agentSubprocesses WARN when count exceeds 8", async () => {
    const rm = { list: () => [] } as unknown as RunManager;

    const handler = createDaemonDoctorHandler(rm, {
      storageRoot: "/tmp/fake",
      countActiveSubprocesses: () => 9,
      countOrphanPorts: () => 0,
      readLockfile: async () => ({ valid: true, pid: 1 }),
      diskUsage: async () => 0,
    });

    const report = await handler({}, noopCtx);
    expect(report.agentSubprocesses).toEqual({ status: "warn", count: 9 });
  });

  it("reports disk WARN when usage exceeds 1 GB", async () => {
    const rm = { list: () => [] } as unknown as RunManager;

    const oneGigPlus = 1024 * 1024 * 1024 + 1;
    const handler = createDaemonDoctorHandler(rm, {
      storageRoot: "/tmp/fake",
      countActiveSubprocesses: () => 0,
      countOrphanPorts: () => 0,
      readLockfile: async () => ({ valid: true, pid: 1 }),
      diskUsage: async () => oneGigPlus,
    });

    const report = await handler({}, noopCtx);
    expect(report.diskUsageBytes.status).toBe("warn");
    expect(report.diskUsageBytes.bytes).toBe(oneGigPlus);
  });

  it("falls back to filesystem disk-usage scan when no diskUsage override is given", async () => {
    const { mkdtemp, mkdir, writeFile, rm: rmDir } = await import("node:fs/promises");
    const { join: joinPath } = await import("node:path");
    const { tmpdir } = await import("node:os");

    const storageRoot = await mkdtemp(joinPath(tmpdir(), "doctor-disk-"));
    try {
      const runsDir = joinPath(storageRoot, "runs", "run00001");
      await mkdir(runsDir, { recursive: true });
      // Two small files; total = 32 bytes.
      await writeFile(joinPath(runsDir, "meta.json"), "x".repeat(16));
      await writeFile(joinPath(runsDir, "events.jsonl"), "y".repeat(16));

      const rm = { list: () => [] } as unknown as RunManager;
      const handler = createDaemonDoctorHandler(rm, {
        storageRoot,
        countActiveSubprocesses: () => 0,
        countOrphanPorts: () => 0,
        readLockfile: async () => ({ valid: true, pid: 1 }),
      });

      const report = await handler({}, noopCtx);
      expect(report.diskUsageBytes.bytes).toBe(32);
      expect(report.diskUsageBytes.status).toBe("ok");
    } finally {
      await rmDir(storageRoot, { recursive: true, force: true });
    }
  });

  it("reports orphanPorts WARN when at least one is held", async () => {
    const rm = { list: () => [] } as unknown as RunManager;

    const handler = createDaemonDoctorHandler(rm, {
      storageRoot: "/tmp/fake",
      countActiveSubprocesses: () => 0,
      countOrphanPorts: () => 2,
      readLockfile: async () => ({ valid: true, pid: 1 }),
      diskUsage: async () => 0,
    });

    const report = await handler({}, noopCtx);
    expect(report.orphanPorts).toEqual({ status: "warn", count: 2 });
  });
});

// ---------------------------------------------------------------------------
// daemon-shutdown handler
// ---------------------------------------------------------------------------

describe("createDaemonShutdownHandler", () => {
  it("invokes triggerExit with reason 'rpc' after returning and resolves with {}", async () => {
    const reasons: string[] = [];
    const triggerExit = (reason: string) => {
      reasons.push(reason);
    };

    const handler = createDaemonShutdownHandler(triggerExit);
    const result = await handler({}, noopCtx);

    // Handler must resolve before triggerExit fires so the RPC response can
    // be written and flushed before the listener stops.
    expect(result).toEqual({});
    expect(reasons).toEqual([]);

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(reasons).toEqual(["rpc"]);
  });
});
