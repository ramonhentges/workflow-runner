import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { RunManager } from "./run-manager.js";
import { RunStore } from "./run-store.js";
import { FakeSessionFactory } from "./test-helpers/fake-session-factory.js";

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
