import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { RunManager } from "./run-manager.js";
import { RunStore } from "./run-store.js";
import { FakeSessionFactory } from "./test-helpers/fake-session-factory.js";
import { asStepId } from "../../domain/ids.js";
import type { InboundMessage } from "../../domain/runner.js";
import { Workflow } from "../../domain/workflow.js";
import { buildKickoffPrompt } from "../acp/agent-session.js";

// These tests drive a real RunManager against a real temporary git repository,
// exercising the actual SimpleGitWorktrees adapter end to end (the unit tests
// cover the orchestration logic with a fake).

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

function git(repo: string, args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

describe("RunManager worktree integration (real git)", () => {
  let parentDir: string;
  let repoDir: string;
  let storageDir: string;

  beforeEach(async () => {
    // realpath so assertions match git's canonical paths (symlinked tmp on macOS).
    parentDir = realpathSync(await mkdtemp(join(tmpdir(), "run-manager-git-")));
    repoDir = join(parentDir, "app");
    storageDir = realpathSync(await mkdtemp(join(tmpdir(), "run-manager-store-")));

    execFileSync("git", ["init", "-b", "main", repoDir], { stdio: "pipe" });
    git(repoDir, ["config", "user.email", "test@example.com"]);
    git(repoDir, ["config", "user.name", "Test"]);
    await Bun.write(join(repoDir, "README.md"), "# app\n");
    git(repoDir, ["add", "."]);
    git(repoDir, ["commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await rm(parentDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  it("isolated run creates the worktree on the branch and records it on the snapshot", async () => {
    const wfPath = join(repoDir, "wf.json");
    await Bun.write(wfPath, SINGLE_STEP_WORKFLOW);
    const capturedCwds: string[] = [];
    const factory = new FakeSessionFactory({
      onCreate: (args) => capturedCwds.push(args.cwd),
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(storageDir, factory);

    const { runId } = await manager.startRun(wfPath, repoDir, "feature");
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    const expectedWorktree = join(dirname(repoDir), `${basename(repoDir)}-feature`);
    expect(existsSync(expectedWorktree)).toBe(true);
    expect(statSync(expectedWorktree).isDirectory()).toBe(true);
    // The new worktree is checked out on the requested branch.
    const head = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: expectedWorktree,
      stdio: "pipe",
    })
      .toString()
      .trim();
    expect(head).toBe("feature");

    // The agent ran inside the worktree, not the repo root.
    expect(capturedCwds).toEqual([expectedWorktree]);

    const snap = record.run.snapshot();
    expect(snap.status).toBe("completed");
    expect(snap.worktreePath).toBe(expectedWorktree);
    expect(snap.branch).toBe("feature");

    // Persisted snapshot mirrors the fields.
    const store = new RunStore({ storageRoot: storageDir });
    const persisted = await store.load(runId);
    expect(persisted.worktreePath).toBe(expectedWorktree);
    expect(persisted.branch).toBe("feature");

    await manager.shutdown();
  });

  it("second isolated run on the same branch reuses the existing worktree directory", async () => {
    const wfPath = join(repoDir, "wf.json");
    await Bun.write(wfPath, SINGLE_STEP_WORKFLOW);
    const factory = new FakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(storageDir, factory);

    const first = await manager.startRun(wfPath, repoDir, "feature");
    const firstRecord = manager.get(first.runId);
    if (!firstRecord) throw new Error("record not found");
    await firstRecord.runPromise;
    const firstWorktree = firstRecord.run.snapshot().worktreePath;

    const second = await manager.startRun(wfPath, repoDir, "feature");
    const secondRecord = manager.get(second.runId);
    if (!secondRecord) throw new Error("record not found");
    await secondRecord.runPromise;
    const secondWorktree = secondRecord.run.snapshot().worktreePath;

    const expectedWorktree = join(dirname(repoDir), `${basename(repoDir)}-feature`);
    expect(firstWorktree).toBe(expectedWorktree);
    expect(secondWorktree).toBe(expectedWorktree);
    expect(secondRecord.run.snapshot().status).toBe("completed");

    await manager.shutdown();
  });
});

describe("RunManager initialPrompt threading", () => {
  let workDir: string;
  let storageDir: string;
  let wfPath: string;

  beforeEach(async () => {
    // No git isolation here: these runs pass no branch, so a plain directory cwd
    // is sufficient to exercise the prompt-threading and per-path kind logic.
    workDir = realpathSync(await mkdtemp(join(tmpdir(), "run-manager-prompt-")));
    storageDir = realpathSync(await mkdtemp(join(tmpdir(), "run-manager-prompt-store-")));
    wfPath = join(workDir, "wf.json");
    await Bun.write(wfPath, SINGLE_STEP_WORKFLOW);
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  async function firstStep(): Promise<import("../../domain/workflow.js").Step> {
    const workflow = await Workflow.load(wfPath);
    const step = workflow.getStep(workflow.firstStepId());
    if (!step) throw new Error("entry step not found");
    return step;
  }

  it("persists initialPrompt and frames the entry step as a user request", async () => {
    const inbounds: Array<InboundMessage | null> = [];
    const factory = new FakeSessionFactory({
      onCreate: (args) => inbounds.push(args.inbound),
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(storageDir, factory);

    const { runId } = await manager.startRun(wfPath, workDir, undefined, "review PR #42");
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    const snap = record.run.snapshot();
    expect(snap.status).toBe("completed");
    expect(snap.initialPrompt).toBe("review PR #42");

    // The entry step receives the prompt framed as a user request.
    expect(inbounds).toEqual([{ message: "review PR #42", kind: "user-request" }]);
    const kickoff = buildKickoffPrompt(await firstStep(), inbounds[0]!);
    expect(kickoff).toContain("User request for this run: review PR #42");

    // The run store round-trips the field like every other snapshot field.
    const store = new RunStore({ storageRoot: storageDir });
    const persisted = await store.load(runId);
    expect(persisted.initialPrompt).toBe("review PR #42");

    await manager.shutdown();
  });

  it("omits initialPrompt and sends no inbound when started without a prompt", async () => {
    const inbounds: Array<InboundMessage | null> = [];
    const factory = new FakeSessionFactory({
      onCreate: (args) => inbounds.push(args.inbound),
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(storageDir, factory);

    const { runId } = await manager.startRun(wfPath, workDir);
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    const snap = record.run.snapshot();
    expect(snap.status).toBe("completed");
    // Absent, not undefined-leaked: the field is omitted from the snapshot.
    expect("initialPrompt" in snap).toBe(false);

    // No inbound is delivered, so the entry kickoff is identical to before.
    expect(inbounds).toEqual([null]);
    const kickoff = buildKickoffPrompt(await firstStep(), inbounds[0]);
    expect(kickoff).not.toContain("User request for this run");
    expect(kickoff).not.toContain("Context from previous step");

    await manager.shutdown();
  });

  it("retry re-enters the failed step with a handoff-framed inbound", async () => {
    const inbounds: Array<InboundMessage | null> = [];
    const factory = new FakeSessionFactory({
      onCreate: (args) => inbounds.push(args.inbound),
      resolveOutcome: () => ({
        kind: "failure",
        failedStep: asStepId("step-1"),
        reason: "boom",
      }),
    });
    const manager = new RunManager(storageDir, factory);

    const { runId } = await manager.startRun(wfPath, workDir, undefined, "review PR #42");
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;
    expect(record.run.snapshot().status).toBe("failed");
    // Fresh start framed the prompt as a user request.
    expect(inbounds[0]).toEqual({ message: "review PR #42", kind: "user-request" });

    await manager.retryStep(runId);
    const retried = manager.get(runId);
    if (!retried) throw new Error("record not found after retry");
    await retried.runPromise;

    // Retry re-enters with the same message but framed as a handoff.
    expect(inbounds).toHaveLength(2);
    expect(inbounds[1]).toEqual({ message: "review PR #42", kind: "handoff" });
    const kickoff = buildKickoffPrompt(await firstStep(), inbounds[1]!);
    expect(kickoff).toContain("Context from previous step: review PR #42");
    expect(kickoff).not.toContain("User request for this run");

    await manager.shutdown();
  });

  it("normalizes a blank/whitespace prompt to the no-prompt path", async () => {
    const inbounds: Array<InboundMessage | null> = [];
    const factory = new FakeSessionFactory({
      onCreate: (args) => inbounds.push(args.inbound),
      resolveOutcome: () => ({ kind: "finish", message: "done" }),
    });
    const manager = new RunManager(storageDir, factory);

    // A whitespace-only prompt reaches startRun (e.g. `--prompt "   "`, which the
    // CLI space-form accepts, or a bare zod string on the HTTP path). It must be
    // byte-for-byte equivalent to starting with no prompt at all.
    const { runId } = await manager.startRun(wfPath, workDir, undefined, "   \n\t ");
    const record = manager.get(runId);
    if (!record) throw new Error("record not found");
    await record.runPromise;

    const snap = record.run.snapshot();
    expect(snap.status).toBe("completed");
    // Dropped, not persisted as an empty string.
    expect("initialPrompt" in snap).toBe(false);

    // No inbound is delivered, so the entry kickoff matches the no-prompt path.
    expect(inbounds).toEqual([null]);
    const kickoff = buildKickoffPrompt(await firstStep(), inbounds[0]);
    expect(kickoff).not.toContain("User request for this run");

    // The store round-trips without the field, just like an omitted prompt.
    const store = new RunStore({ storageRoot: storageDir });
    const persisted = await store.load(runId);
    expect("initialPrompt" in persisted).toBe(false);

    await manager.shutdown();
  });
});
