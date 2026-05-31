import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunManager, RunManagerError } from "./run-manager.js";
import type { RunSubscriber } from "./run-manager.js";
import { RunStore } from "./run-store.js";
import { Run, asRunId, asRunSlug } from "../../domain/run.js";
import type { RunId, RunSlug, RunSnapshot } from "../../domain/run.js";
import type { StepOutcome } from "../../domain/outcome.js";
import type { StepId } from "../../domain/ids.js";
import { asStepId, asStepToken } from "../../domain/ids.js";
import type { EventLogEntry } from "./event-log.js";
import { RpcErrorCode } from "./protocol.js";
import {
  FakeSessionFactory,
  ControllableSessionFactory,
} from "./test-helpers/fake-session-factory.js";
import type { RunnerAgentSessionFactory } from "../../domain/runner.js";
import type { McpServer } from "../mcp/mcp-server.js";
import type { DaemonLogRecord } from "./daemon-log.js";

// ─── helpers ────────────────────────────────────────────────────────────────

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

const INTERACTIVE_STEP_WORKFLOW = JSON.stringify({
  id: "test-wf-interactive",
  name: "Interactive Workflow",
  description: "Test",
  version: "1",
  steps: [
    {
      id: "step-1",
      agent: "test-agent",
      description: "Interactive step",
      mode: "interactive",
      ide: "vscode",
      model: "test-model",
      edges: [],
    },
  ],
});

const TWO_STEP_WORKFLOW = JSON.stringify({
  id: "test-wf-two",
  name: "Two Step Workflow",
  description: "Test",
  version: "1",
  steps: [
    {
      id: "step-1",
      agent: "test-agent",
      description: "First step",
      mode: "autonomous",
      ide: "vscode",
      model: "test-model",
      edges: [{ next_step: "step-2", intent: "go to step 2" }],
    },
    {
      id: "step-2",
      agent: "test-agent",
      description: "Second step",
      mode: "autonomous",
      ide: "vscode",
      model: "test-model",
      edges: [],
    },
  ],
});

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "run-manager-test-"));
}

async function writeWorkflow(dir: string, filename: string, json: string): Promise<string> {
  const wfPath = join(dir, filename);
  await Bun.write(wfPath, json);
  return wfPath;
}

function waitFor(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitUntil timeout");
    await waitFor(10);
  }
}

// ─── tests ──────────────────────────────────────────────────────────────────

describe("RunManager", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── startRun basic ─────────────────────────────────────────────────────────

  it("startRun returns {runId, slug} with id length 8 and valid slug format", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const result = await manager.startRun(wfPath, tmpDir);

    expect(result.runId).toHaveLength(8);
    expect(result.slug).toMatch(/^[a-z]+-[a-z]+$/);

    await manager.shutdown();
  });

  it("startRun passes the provided cwd to the Runner via session factory args", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const capturedArgs: import("../../domain/runner.js").RunnerAgentSessionArgs[] = [];
    const factory = new FakeSessionFactory({
      onCreate: (args) => capturedArgs.push(args),
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    expect(capturedArgs).toHaveLength(1);
    expect(capturedArgs[0]!.cwd).toBe(tmpDir);

    await manager.shutdown();
  });

  it("startRun rejects a relative cwd with CWD_INVALID before creating any run state", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const err = await manager.startRun(wfPath, "relative/path").catch((e) => e);

    expect(err).toBeInstanceOf(RunManagerError);
    expect(err.code).toBe(RpcErrorCode.CWD_INVALID);
    expect(manager.list()).toHaveLength(0);
  });

  it("startRun rejects a non-existent absolute cwd with CWD_INVALID before creating any run state", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const err = await manager.startRun(wfPath, "/nonexistent/dir/that/does/not/exist").catch((e) => e);

    expect(err).toBeInstanceOf(RunManagerError);
    expect(err.code).toBe(RpcErrorCode.CWD_INVALID);
    expect(manager.list()).toHaveLength(0);
  });

  it("startRun rejects a file path as cwd with CWD_INVALID", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    // wfPath is an absolute path to a file, not a directory
    const err = await manager.startRun(wfPath, wfPath).catch((e) => e);

    expect(err).toBeInstanceOf(RunManagerError);
    expect(err.code).toBe(RpcErrorCode.CWD_INVALID);
    expect(manager.list()).toHaveLength(0);
  });

  it("startRun immediately persists meta.json with status: running", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const store = new RunStore({ storageRoot: tmpDir });
    const snap = await store.load(runId);

    expect(snap.status).toBe("running");

    await manager.shutdown();
  });

  it("startRun persists cwd in meta.json and exposes it on the run snapshot", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);

    // In-memory snapshot must include cwd.
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    expect(record.run.snapshot().cwd).toBe(tmpDir);

    // Persisted snapshot must include cwd.
    const store = new RunStore({ storageRoot: tmpDir });
    const persisted = await store.load(runId);
    expect(persisted.cwd).toBe(tmpDir);

    await manager.shutdown();
  });

  it("startRun persists meta.json with currentStepId set after onStepBoundary fires", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    // Wait for onStepBoundary to fire and runner to complete
    await waitUntil(() => record.run.snapshot().status !== "running");

    const store = new RunStore({ storageRoot: tmpDir });
    const snap = await store.load(runId);
    expect(snap.currentStepId).toBe(asStepId("step-1"));

    await manager.shutdown();
  });

  it("startRun with completing factory produces meta.json with status: completed", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    await record.runPromise;

    const store = new RunStore({ storageRoot: tmpDir });
    const snap = await store.load(runId);
    expect(snap.status).toBe("completed");

    await manager.shutdown();
  });

  it("startRun with factory that throws produces meta.json with status: failed and endReason", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      rejectWith: () => new Error("agent exploded"),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    await record.runPromise;

    const store = new RunStore({ storageRoot: tmpDir });
    const snap = await store.load(runId);
    expect(snap.status).toBe("failed");
    expect(snap.endReason).toContain("agent exploded");

    await manager.shutdown();
  });

  it("two concurrent startRun calls produce distinct ids and slugs", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const [r1, r2] = await Promise.all([
      manager.startRun(wfPath, tmpDir),
      manager.startRun(wfPath, tmpDir),
    ]);

    expect(r1.runId).not.toBe(r2.runId);
    expect(r1.slug).not.toBe(r2.slug);

    await manager.shutdown();
  });

  it("concurrent startRun calls that generate the same id first do not collide", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });

    // Both concurrent calls generate id "aaaaaaaa" on their first attempt.
    // The second call to run its do-while loop sees the reserved slot and retries
    // with "bbbbbbbb", producing two distinct runs without data loss.
    const allIds = [
      asRunId("aaaaaaaa"),
      asRunId("aaaaaaaa"), // collision attempt from whichever call runs second
      asRunId("bbbbbbbb"), // retry succeeds
    ];
    let idIdx = 0;
    const allSlugs = [asRunSlug("brave-cat"), asRunSlug("calm-dog"), asRunSlug("quiet-fox")];
    let slugIdx = 0;

    const manager = new RunManager(tmpDir, factory, {
      generateId: () => allIds[idIdx++]!,
      generateSlug: () => allSlugs[slugIdx++]!,
    });

    const [r1, r2] = await Promise.all([
      manager.startRun(wfPath, tmpDir),
      manager.startRun(wfPath, tmpDir),
    ]);

    expect(r1.runId).not.toBe(r2.runId);
    expect(r1.slug).not.toBe(r2.slug);

    // One run takes "aaaaaaaa", the other retries and takes "bbbbbbbb".
    const runIds = new Set([r1.runId, r2.runId]);
    expect(runIds.has(asRunId("aaaaaaaa"))).toBe(true);
    expect(runIds.has(asRunId("bbbbbbbb"))).toBe(true);

    // Both are independently addressable with no overwritten records.
    expect(manager.get(r1.runId)).toBeDefined();
    expect(manager.get(r2.runId)).toBeDefined();

    await manager.shutdown();
  });

  it("startRun retries id generation when colliding id is produced", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });

    // Sequence: first startRun uses ids[0]/slugs[0]; second startRun tries
    // ids[1] (collision with ids[0]), then ids[2] (unique). All slugs unique.
    const ids = [
      asRunId("aaaaaaaa"),
      asRunId("aaaaaaaa"), // collision on second startRun's first attempt
      asRunId("bbbbbbbb"), // succeeds on second startRun's second attempt
    ];
    let idIdx = 0;
    const slugs = [asRunSlug("brave-cat"), asRunSlug("calm-dog"), asRunSlug("quiet-fox")];
    let slugIdx = 0;

    const manager = new RunManager(tmpDir, factory, {
      generateId: () => ids[idIdx++]!,
      generateSlug: () => slugs[slugIdx++]!,
    });

    const r1 = await manager.startRun(wfPath, tmpDir);
    expect(r1.runId).toBe(asRunId("aaaaaaaa"));

    const r2 = await manager.startRun(wfPath, tmpDir);
    expect(r2.runId).toBe(asRunId("bbbbbbbb"));

    await manager.shutdown();
  });

  it("startRun past run limit rejects with RUN_LIMIT_REACHED error", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory, { runLimit: 1 });

    await manager.startRun(wfPath, tmpDir);

    let error: RunManagerError | undefined;
    try {
      await manager.startRun(wfPath, tmpDir);
    } catch (e) {
      error = e as RunManagerError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe(RpcErrorCode.RUN_LIMIT_REACHED);

    await manager.shutdown();
  });

  // ── list ──────────────────────────────────────────────────────────────────

  it("list() returns 3 entries after starting 3 runs; completed run comes last", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);

    const factories = [
      new ControllableSessionFactory(),
      new ControllableSessionFactory(),
      new FakeSessionFactory({ resolveOutcome: () => ({ kind: "finish", message: "done" }) }),
    ];

    let factoryIdx = 0;
    const roundRobinFactory: RunnerAgentSessionFactory = {
      create: (args) => factories[factoryIdx++ % factories.length]!.create(args),
    };

    const manager = new RunManager(tmpDir, roundRobinFactory);

    const r1 = await manager.startRun(wfPath, tmpDir);
    const r2 = await manager.startRun(wfPath, tmpDir);
    const r3 = await manager.startRun(wfPath, tmpDir);

    expect(manager.list()).toHaveLength(3);

    // Wait for r3 (FakeSessionFactory with immediate finish) to complete
    const rec3 = manager.get(r3.runId);
    if (rec3?.runPromise) await rec3.runPromise;

    const listed = manager.list();
    expect(listed).toHaveLength(3);

    // Active runs (r1, r2) should come before completed run (r3)
    const completedIdx = listed.findIndex((s) => s.id === r3.runId);
    const active1Idx = listed.findIndex((s) => s.id === r1.runId);
    const active2Idx = listed.findIndex((s) => s.id === r2.runId);

    expect(active1Idx).toBeLessThan(completedIdx);
    expect(active2Idx).toBeLessThan(completedIdx);

    await manager.shutdown();
  });

  it("list({ includeOldTerminal: true }) includes terminal runs older than 24h", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    // Backdate endedAt to simulate a run older than 24 hours.
    const snap = record.run.snapshot();
    const oldEndedAt = Date.now() - 25 * 60 * 60 * 1000;
    record.run = Run.fromSnapshot({ ...snap, endedAt: oldEndedAt });

    // Default list() excludes the aged terminal run.
    expect(manager.list()).toHaveLength(0);

    // list({ includeOldTerminal: true }) includes it.
    expect(manager.list({ includeOldTerminal: true })).toHaveLength(1);

    await manager.shutdown();
  });

  // ── get ───────────────────────────────────────────────────────────────────

  it("get() with an ambiguous prefix throws AMBIGUOUS_PREFIX", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();

    const ids = [asRunId("abcdefgh"), asRunId("abcdefgi")];
    const slugs = [asRunSlug("fast-cat"), asRunSlug("slow-dog")];
    let idIdx = 0;
    let slugIdx = 0;

    const manager = new RunManager(tmpDir, factory, {
      generateId: () => ids[idIdx++]!,
      generateSlug: () => slugs[slugIdx++]!,
    });

    await manager.startRun(wfPath, tmpDir);
    await manager.startRun(wfPath, tmpDir);

    let error: RunManagerError | undefined;
    try {
      manager.get("abc");
    } catch (e) {
      error = e as RunManagerError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe(RpcErrorCode.AMBIGUOUS_PREFIX);

    await manager.shutdown();
  });

  it("get() with an unambiguous prefix returns the matching run", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();

    const ids = [asRunId("aaa11111"), asRunId("bbb22222")];
    const slugs = [asRunSlug("fast-cat"), asRunSlug("slow-dog")];
    let idIdx = 0;
    let slugIdx = 0;

    const manager = new RunManager(tmpDir, factory, {
      generateId: () => ids[idIdx++]!,
      generateSlug: () => slugs[slugIdx++]!,
    });

    const r1 = await manager.startRun(wfPath, tmpDir);
    await manager.startRun(wfPath, tmpDir);

    const found = manager.get("aaa");
    expect(found).toBeDefined();
    expect(found!.run.snapshot().id).toBe(r1.runId);

    await manager.shutdown();
  });

  // ── retryStep ─────────────────────────────────────────────────────────────

  it("retryStep on crashed run re-spawns factory, emits banner, transitions to running", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      rejectWith: () => new Error("crashed"),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    // Wait for the run to reach terminal state (failed)
    await record.runPromise;
    expect(["failed", "crashed", "aborted"]).toContain(record.run.snapshot().status);

    const createCountBefore = factory.createCallCount;

    // Attach a subscriber to capture retry banner
    const events: EventLogEntry[] = [];
    const sub: RunSubscriber = { onEvent: (e) => events.push(e) };
    manager.attachSubscriber(runId, sub);

    await manager.retryStep(runId);

    // Banner should have been emitted before new runner starts
    const bannerEntry = events.find(
      (e) =>
        e.event.type === "log" &&
        e.event.message.includes("↻ retrying step-1"),
    );
    expect(bannerEntry).toBeDefined();

    // Status should now be running
    expect(record.run.snapshot().status).toBe("running");

    // Wait for retried run to complete (same factory → fails again)
    if (record.runPromise) await record.runPromise.catch(() => {});

    // Factory was called again (during retry run)
    expect(factory.createCallCount).toBeGreaterThan(createCountBefore);

    await manager.shutdown();
  });

  it("retryStep on a running run rejects with RUN_NOT_RETRY_ELIGIBLE", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);

    let error: RunManagerError | undefined;
    try {
      await manager.retryStep(runId);
    } catch (e) {
      error = e as RunManagerError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe(RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE);

    await manager.shutdown();
  });

  it("retry banner appears in events.jsonl before any new step banner (seq ordering)", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      rejectWith: () => new Error("crashed"),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    await record.runPromise;

    const events: EventLogEntry[] = [];
    const sub: RunSubscriber = { onEvent: (e) => events.push(e) };
    manager.attachSubscriber(runId, sub);

    // Use a factory that resolves immediately for the retry
    const retryFactory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "retry succeeded" }),
    });
    // Create a new manager pointing to same storageRoot to reuse data
    // But retryStep uses the manager's internal factory — swap it by creating
    // a new manager with the good factory or by directly testing retry banner ordering
    // via the event log after retry completes.
    //
    // Since manager uses #sessionFactory from constructor, we test by checking
    // that the retry banner (emitted before runner starts) has lower seq than
    // any banner from the retried step.
    await manager.retryStep(runId).catch(() => {});

    if (record.runPromise) await record.runPromise.catch(() => {});
    await waitFor(30); // let any pending observer appends flush

    // The retry banner should be in events
    const retryBannerIdx = events.findIndex(
      (e) =>
        e.event.type === "log" &&
        "message" in e.event &&
        (e.event as { message: string }).message.includes("↻ retrying"),
    );
    const stepBannerIdx = events.findIndex(
      (e) => e.event.type === "banner",
    );

    expect(retryBannerIdx).toBeGreaterThanOrEqual(0);
    expect(stepBannerIdx).toBeGreaterThanOrEqual(0);
    expect(events[retryBannerIdx]!.seq).toBeLessThan(events[stepBannerIdx]!.seq);

    await manager.shutdown();
  });

  // ── sendInput ─────────────────────────────────────────────────────────────

  it("sendInput on interactive step returns acceptedSeq and persists a user-message log entry", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", INTERACTIVE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    await waitUntil(() => factory.lastSession !== undefined);
    await waitFor(30);

    // Capture seq via an attached subscriber to read the entry the handler
    // path will see — this also validates fan-out to live subscribers.
    const received: EventLogEntry[] = [];
    const sub: RunSubscriber = { onEvent: (e) => received.push(e) };
    manager.attachSubscriber(runId, sub);

    const acceptedSeq = await manager.sendInput(runId, "hello from user");

    expect(typeof acceptedSeq).toBe("number");
    expect(acceptedSeq).toBeGreaterThan(0);

    const userMessageEntry = received.find(
      (e) =>
        e.event.type === "log" &&
        (e.event as { message: string }).message.includes("hello from user"),
    );
    expect(userMessageEntry).toBeDefined();
    expect(userMessageEntry!.seq).toBe(acceptedSeq);

    factory.lastSession?.resolveWith({ kind: "finish", message: "done" });
    const record = manager.get(runId);
    if (record?.runPromise) await record.runPromise.catch(() => {});

    await manager.shutdown();
  });

  it("sendInput on interactive step forwards to runner.provideInput", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", INTERACTIVE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);

    // Wait for session to be created and interactive event emitted
    await waitUntil(() => factory.lastSession !== undefined);
    // Small extra wait for runner to emit interactive event (async observer)
    await waitFor(30);

    await manager.sendInput(runId, "hello from user");

    const session = factory.lastSession!;
    expect(session.inputReceived).toContain("hello from user");

    // Clean up: resolve session so runner finishes
    session.resolveWith({ kind: "finish", message: "done" });
    const record = manager.get(runId);
    if (record?.runPromise) await record.runPromise.catch(() => {});

    await manager.shutdown();
  });

  it("sendInput on an autonomous step rejects with RUN_NOT_INTERACTIVE", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);

    // Wait for session to be created
    await waitUntil(() => factory.lastSession !== undefined);
    await waitFor(30);

    let error: RunManagerError | undefined;
    try {
      await manager.sendInput(runId, "hello");
    } catch (e) {
      error = e as RunManagerError;
    }

    expect(error).toBeDefined();
    expect(error!.code).toBe(RpcErrorCode.RUN_NOT_INTERACTIVE);

    // Clean up
    factory.lastSession?.resolveWith({ kind: "finish", message: "done" });
    const record = manager.get(runId);
    if (record?.runPromise) await record.runPromise.catch(() => {});

    await manager.shutdown();
  });

  // ── attachSubscriber ──────────────────────────────────────────────────────

  it("attachSubscriber delivers events; detach stops delivery", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);

    const received: EventLogEntry[] = [];
    const sub: RunSubscriber = { onEvent: (e) => received.push(e) };
    const detach = manager.attachSubscriber(runId, sub);

    // Wait for session and some events
    await waitUntil(() => factory.lastSession !== undefined);
    await waitFor(30);

    const countAfterAttach = received.length;

    // Detach
    detach();

    // Trigger more events by resolving the session
    factory.lastSession?.resolveWith({ kind: "finish", message: "done" });
    const record = manager.get(runId);
    if (record?.runPromise) await record.runPromise.catch(() => {});

    await waitFor(30);

    // Should have received some events before detach
    expect(countAfterAttach).toBeGreaterThan(0);

    // No additional events after detach
    expect(received.length).toBe(countAfterAttach);

    await manager.shutdown();
  });

  // ── discoverOnStartup ─────────────────────────────────────────────────────

  it("discoverOnStartup marks running on-disk runs as crashed with no active Runners", async () => {
    // Seed two "running" runs on disk
    const store = new RunStore({ storageRoot: tmpDir });
    const snap1 = Run.create({
      id: asRunId("run00001"),
      slug: asRunSlug("brave-cat"),
      workflowPath: "/fake/wf.json",
    }).snapshot();
    const snap2 = Run.create({
      id: asRunId("run00002"),
      slug: asRunSlug("calm-dog"),
      workflowPath: "/fake/wf.json",
    }).snapshot();
    await store.persist(snap1);
    await store.persist(snap2);

    const factory = new FakeSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    await manager.discoverOnStartup();

    const listed = manager.list();
    expect(listed).toHaveLength(2);
    for (const snap of listed) {
      expect(snap.status).toBe("crashed");
    }

    // No active runners for discovered runs
    for (const snap of listed) {
      const record = manager.get(snap.id);
      expect(record?.runner).toBeNull();
    }

    await manager.shutdown();
  });

  // ── stop ─────────────────────────────────────────────────────────────────

  it("stop on active run calls session dispose and transitions status to aborted", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);

    // Wait for session to be created
    await waitUntil(() => factory.lastSession !== undefined);
    await waitFor(10);

    await manager.stop(runId);

    // session.dispose() was called (= SIGTERM sent)
    expect(factory.lastSession!.disposeCallCount).toBeGreaterThan(0);

    // Status is aborted
    const record = manager.get(runId);
    expect(record!.run.snapshot().status).toBe("aborted");

    const store = new RunStore({ storageRoot: tmpDir });
    const persisted = await store.load(runId);
    expect(persisted.status).toBe("aborted");

    await manager.shutdown();
  });

  it("stop clears its setTimeout to avoid keeping event loop alive", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    // Wait for run to complete, then call stop (race is already resolved)
    await record.runPromise;
    await manager.stop(runId);

    // The setTimeout created in stop should have been cleared.
    // Verify by checking that the event loop can exit cleanly:
    // If timers were leaked, we would need to wait for them to fire.
    // We'll verify indirectly by shutting down quickly.
    const shutdownStart = Date.now();
    await manager.shutdown();
    const shutdownDuration = Date.now() - shutdownStart;

    // Shutdown should complete quickly (well under 5 seconds)
    // If the timer leak existed, shutdown might wait for the 5s timeout
    expect(shutdownDuration).toBeLessThan(1000);
  });

  // ── shutdown ─────────────────────────────────────────────────────────────

  it("shutdown closes all MCP servers without disposing active runners", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new ControllableSessionFactory();

    let mcpCloseCount = 0;
    const mockCreateMcpServer = async (): Promise<McpServer> => {
      const { McpServer: MS } = await import("../mcp/mcp-server.js");
      const server = await MS.start();
      const originalClose = server.close.bind(server);
      (server as unknown as { close: () => Promise<void> }).close = async () => {
        mcpCloseCount++;
        return originalClose();
      };
      return server;
    };

    const manager = new RunManager(tmpDir, factory, {
      createMcpServer: mockCreateMcpServer,
    });

    await manager.startRun(wfPath, tmpDir);
    await manager.startRun(wfPath, tmpDir);

    // Verify sessions are still active (not disposed)
    await waitUntil(() => factory.sessions.length >= 2);
    const disposeCountBefore = factory.sessions.reduce(
      (sum, s) => sum + s.disposeCallCount,
      0,
    );
    expect(disposeCountBefore).toBe(0);

    await manager.shutdown();

    // Both MCP servers closed
    expect(mcpCloseCount).toBe(2);

    // Runners not stopped (no dispose calls on sessions)
    const disposeCountAfter = factory.sessions.reduce(
      (sum, s) => sum + s.disposeCallCount,
      0,
    );
    expect(disposeCountAfter).toBe(0);
  });

  // ── MCP server lifecycle ──────────────────────────────────────────────────

  it("completes run closes its MCP server", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });

    let mcpServers: Array<{ instance: McpServer; closeCalled: boolean }> = [];
    const mockCreateMcpServer = async (): Promise<McpServer> => {
      const { McpServer: MS } = await import("../mcp/mcp-server.js");
      const server = await MS.start();
      let closeCalled = false;
      const originalClose = server.close.bind(server);
      (server as unknown as { close: () => Promise<void> }).close = async () => {
        closeCalled = true;
        return originalClose();
      };
      mcpServers.push({ instance: server, get closeCalled() { return closeCalled; } });
      return server;
    };

    const manager = new RunManager(tmpDir, factory, {
      createMcpServer: mockCreateMcpServer,
    });

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    // Wait for run to complete
    await record.runPromise;

    // The MCP server should have been closed
    expect(mcpServers.length).toBe(1);
    expect(mcpServers[0]!.closeCalled).toBe(true);
    expect(record.mcpServer).toBeNull();

    await manager.shutdown();
  });

  it("failed run closes its MCP server", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      rejectWith: () => new Error("agent exploded"),
    });

    let mcpServers: Array<{ instance: McpServer; closeCalled: boolean }> = [];
    const mockCreateMcpServer = async (): Promise<McpServer> => {
      const { McpServer: MS } = await import("../mcp/mcp-server.js");
      const server = await MS.start();
      let closeCalled = false;
      const originalClose = server.close.bind(server);
      (server as unknown as { close: () => Promise<void> }).close = async () => {
        closeCalled = true;
        return originalClose();
      };
      mcpServers.push({ instance: server, get closeCalled() { return closeCalled; } });
      return server;
    };

    const manager = new RunManager(tmpDir, factory, {
      createMcpServer: mockCreateMcpServer,
    });

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    // Wait for run to fail
    await record.runPromise;

    // The MCP server should have been closed
    expect(mcpServers.length).toBe(1);
    expect(mcpServers[0]!.closeCalled).toBe(true);
    expect(record.mcpServer).toBeNull();

    await manager.shutdown();
  });

  it("multiple completed runs have at most one open MCP server at any time", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });

    const serverStates: Array<{ opened: boolean; closed: boolean }> = [];
    const mockCreateMcpServer = async (): Promise<McpServer> => {
      const { McpServer: MS } = await import("../mcp/mcp-server.js");
      const server = await MS.start();
      const state = { opened: true, closed: false };
      serverStates.push(state);

      const originalClose = server.close.bind(server);
      (server as unknown as { close: () => Promise<void> }).close = async () => {
        state.closed = true;
        return originalClose();
      };
      return server;
    };

    const manager = new RunManager(tmpDir, factory, {
      createMcpServer: mockCreateMcpServer,
    });

    // Start 5 runs sequentially, waiting for each to complete
    for (let i = 0; i < 5; i++) {
      const { runId } = await manager.startRun(wfPath, tmpDir);
      const record = manager.get(runId);
      if (!record) throw new Error("record not found");
      await record.runPromise;

      // Count open servers (opened && !closed)
      const openCount = serverStates.filter((s) => s.opened && !s.closed).length;
      expect(openCount).toBeLessThanOrEqual(1);
    }

    // All servers should be closed at the end
    for (const state of serverStates) {
      expect(state.closed).toBe(true);
    }

    await manager.shutdown();
  });

  // ── EventLog lifecycle ────────────────────────────────────────────────────

  it("completes run closes its EventLog and nulls the cached handle", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });

    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    await record.runPromise;

    expect(record.eventLog).toBeNull();

    // openEventLog should lazily reopen (file still on disk)
    const reopened = await manager.openEventLog(runId);
    expect(reopened).not.toBeNull();

    await manager.shutdown();
  });

  it("failed run closes its EventLog and nulls the cached handle", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      rejectWith: () => new Error("agent exploded"),
    });

    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");

    await record.runPromise;

    expect(record.eventLog).toBeNull();

    // openEventLog should lazily reopen (file still on disk)
    const reopened = await manager.openEventLog(runId);
    expect(reopened).not.toBeNull();
    await reopened!.close();

    await manager.shutdown();
  });

  it("openEventLog for terminal run returns uncached handle that does not pollute record.eventLog", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory);

    const { runId } = await manager.startRun(wfPath, tmpDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    // Run is now terminal; record.eventLog was closed and nulled by #launchRunner.
    expect(record.eventLog).toBeNull();

    const handle1 = await manager.openEventLog(runId);
    expect(handle1).not.toBeNull();
    // Terminal handle must NOT be cached — FDs must not accumulate across attaches.
    expect(record.eventLog).toBeNull();

    const handle2 = await manager.openEventLog(runId);
    expect(handle2).not.toBeNull();
    // Each call returns an independent handle; caller owns each one.
    expect(handle1).not.toBe(handle2);

    await handle1!.close();
    await handle2!.close();

    await manager.shutdown();
  });

  // ── persist failure logging ───────────────────────────────────────────────

  it("logs run.terminalPersistFailed when persist fails at run completion", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });

    const loggedRecords: DaemonLogRecord[] = [];
    const mockLogger = {
      log(record: DaemonLogRecord) {
        loggedRecords.push(record);
      },
      close: async () => {},
    };

    // Mock RunStore.persist to throw
    const origPersist = RunStore.prototype.persist;
    let persistCallCount = 0;
    (RunStore.prototype as unknown as { persist: (s: RunSnapshot) => Promise<void> }).persist =
      async function () {
        persistCallCount++;
        // First call (from startRun) succeeds, second call (from completion) fails
        if (persistCallCount > 1) {
          throw new Error("disk full");
        }
        return origPersist.call(this, arguments[0]);
      };

    try {
      const manager = new RunManager(tmpDir, factory, {
        logger: mockLogger as unknown as undefined,
      });

      const { runId } = await manager.startRun(wfPath, tmpDir);
      const record = manager.get(runId);
      if (!record) throw new Error("record not found");

      await record.runPromise;

      // Should have logged the persist failure
      const persistFailedLog = loggedRecords.find(
        (r) => r.event === "run.terminalPersistFailed",
      );
      expect(persistFailedLog).toBeDefined();
      expect(persistFailedLog!.level).toBe("ERROR");
      expect(persistFailedLog!.msg).toContain("disk full");
      expect(persistFailedLog!.runId).toBe(runId);

      await manager.shutdown();
    } finally {
      (RunStore.prototype as unknown as { persist: unknown }).persist = origPersist;
    }
  });

  it("logs run.terminalPersistFailed when persist fails at run crash", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      rejectWith: () => new Error("agent error"),
    });

    const loggedRecords: DaemonLogRecord[] = [];
    const mockLogger = {
      log(record: DaemonLogRecord) {
        loggedRecords.push(record);
      },
      close: async () => {},
    };

    // Mock RunStore.persist to throw on crash path
    const origPersist = RunStore.prototype.persist;
    let persistCallCount = 0;
    (RunStore.prototype as unknown as { persist: (s: RunSnapshot) => Promise<void> }).persist =
      async function () {
        persistCallCount++;
        // First call (from startRun) succeeds, second call (from crash) fails
        if (persistCallCount > 1) {
          throw new Error("permission denied");
        }
        return origPersist.call(this, arguments[0]);
      };

    try {
      const manager = new RunManager(tmpDir, factory, {
        logger: mockLogger as unknown as undefined,
      });

      const { runId } = await manager.startRun(wfPath, tmpDir);
      const record = manager.get(runId);
      if (!record) throw new Error("record not found");

      await record.runPromise;

      // Should have logged the persist failure
      const persistFailedLog = loggedRecords.find(
        (r) => r.event === "run.terminalPersistFailed",
      );
      expect(persistFailedLog).toBeDefined();
      expect(persistFailedLog!.level).toBe("ERROR");
      expect(persistFailedLog!.msg).toContain("permission denied");
      expect(persistFailedLog!.runId).toBe(runId);

      await manager.shutdown();
    } finally {
      (RunStore.prototype as unknown as { persist: unknown }).persist = origPersist;
    }
  });

  // ── 100-run stress test ───────────────────────────────────────────────────

  it("100 concurrent startRun calls produce non-colliding ids", async () => {
    const wfPath = await writeWorkflow(tmpDir, "wf.json", SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(tmpDir, factory, { runLimit: 200 });

    const results = await Promise.all(
      Array.from({ length: 100 }, () => manager.startRun(wfPath, tmpDir)),
    );

    const ids = results.map((r) => r.runId);
    const slugs = results.map((r) => r.slug);
    const uniqueIds = new Set(ids);
    const uniqueSlugs = new Set(slugs);

    expect(uniqueIds.size).toBe(100);
    expect(uniqueSlugs.size).toBe(100);

    await manager.shutdown();
  });
});
