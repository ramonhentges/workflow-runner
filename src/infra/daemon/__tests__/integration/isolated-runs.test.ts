import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { startDaemonHarness, waitFor, writeFakeWorkflow, type Harness } from "./harness.js";

// These tests drive the full RPC vertical (client → daemon → RunManager →
// SimpleGitWorktrees) against real temporary git repositories, confirming
// `branch` threads through `run.start` and that `run.ps` surfaces
// `worktreePath`/`branch` for isolated runs.

function git(repo: string, args: string[]): void {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

/** Create a committed git repo at `<parent>/<name>` and return its real path. */
function initRepo(parent: string, name: string): string {
  const repo = join(parent, name);
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test"]);
  execFileSync("sh", ["-c", `printf '# %s\\n' ${name} > README.md`], {
    cwd: repo,
    stdio: "pipe",
  });
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "initial"]);
  return repo;
}

function branchOf(worktree: string): string {
  return execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: worktree,
    encoding: "utf8",
  }).trim();
}

describe("integration: isolated runs (real git)", () => {
  let h: Harness;
  let parentDir: string;

  beforeEach(async () => {
    h = await startDaemonHarness();
    // realpath so assertions match git's canonical paths (symlinked tmp on macOS).
    parentDir = realpathSync(await mkdtemp(join(tmpdir(), "wfr-isolated-")));
  });

  afterEach(async () => {
    await h.cleanup();
    await rm(parentDir, { recursive: true, force: true });
  });

  test("isolated run executes in a worktree on the branch and reaches completed", async () => {
    const repo = initRepo(parentDir, "app");
    const workflowPath = await writeFakeWorkflow(h.storageRoot, "isolated-basic", [
      { id: "step-1", description: "fake:complete" },
    ]);

    const { runId } = await h.client.call("run.start", {
      workflowPath,
      cwd: repo,
      branch: "feature/iso",
    });

    const entry = await waitFor(
      async () => {
        const { runs } = await h.client.call("run.ps", {});
        const mine = runs.find((r) => r.id === runId);
        return mine && mine.status === "completed" ? mine : null;
      },
      { timeoutMs: 6000, label: "isolated-completed" },
    );

    const expectedWorktree = join(dirname(repo), `${basename(repo)}-feature-iso`);
    expect(entry.worktreePath).toBe(expectedWorktree);
    expect(entry.branch).toBe("feature/iso");
    expect(existsSync(expectedWorktree)).toBe(true);
    expect(statSync(expectedWorktree).isDirectory()).toBe(true);
    expect(branchOf(expectedWorktree)).toBe("feature/iso");
  });

  test("two concurrent isolated runs writing the same path keep each other's edits", async () => {
    const repo = initRepo(parentDir, "app");
    // Each run's step writes a distinct marker to the *same relative path*
    // (`shared.txt`). If isolation held, each worktree keeps its own marker;
    // if one run clobbered the other, the markers would collide. This directly
    // exercises the PRD no-clobber correctness metric (not just distinct paths).
    const [wfA, wfB] = await Promise.all([
      writeFakeWorkflow(h.storageRoot, "iso-a", [
        { id: "step-1", description: "fake:write shared.txt marker-a" },
      ]),
      writeFakeWorkflow(h.storageRoot, "iso-b", [
        { id: "step-1", description: "fake:write shared.txt marker-b" },
      ]),
    ]);

    const [startA, startB] = await Promise.all([
      h.client.call("run.start", { workflowPath: wfA, cwd: repo, branch: "feature/a" }),
      h.client.call("run.start", { workflowPath: wfB, cwd: repo, branch: "feature/b" }),
    ]);
    const ids = [startA.runId, startB.runId];
    expect(new Set(ids).size).toBe(2);

    const mine = await waitFor(
      async () => {
        const { runs } = await h.client.call("run.ps", {});
        const found = runs.filter((r) => ids.includes(r.id));
        return found.length === 2 && found.every((r) => r.status === "completed") ? found : null;
      },
      { timeoutMs: 8000, label: "both-completed" },
    );

    const byId = new Map(mine.map((r) => [r.id, r]));
    const a = byId.get(startA.runId)!;
    const b = byId.get(startB.runId)!;

    expect(a.worktreePath).toBe(join(dirname(repo), `${basename(repo)}-feature-a`));
    expect(b.worktreePath).toBe(join(dirname(repo), `${basename(repo)}-feature-b`));
    // Distinct worktrees → no shared directory.
    expect(a.worktreePath).not.toBe(b.worktreePath);
    expect(existsSync(a.worktreePath!)).toBe(true);
    expect(existsSync(b.worktreePath!)).toBe(true);
    expect(branchOf(a.worktreePath!)).toBe("feature/a");
    expect(branchOf(b.worktreePath!)).toBe("feature/b");

    // No-clobber: each run's edit to `shared.txt` survives in its own worktree.
    expect(readFileSync(join(a.worktreePath!, "shared.txt"), "utf8")).toBe("marker-a");
    expect(readFileSync(join(b.worktreePath!, "shared.txt"), "utf8")).toBe("marker-b");
  });

  test("second isolated run on a branch with an existing worktree reuses that path", async () => {
    const repo = initRepo(parentDir, "app");
    // Pre-create a worktree for the branch so the second start must reuse it.
    const existing = join(dirname(repo), `${basename(repo)}-feature-reuse`);
    git(repo, ["worktree", "add", "-b", "feature/reuse", existing]);

    const wf = await writeFakeWorkflow(h.storageRoot, "iso-reuse", [
      { id: "step-1", description: "fake:complete" },
    ]);

    const { runId } = await h.client.call("run.start", {
      workflowPath: wf,
      cwd: repo,
      branch: "feature/reuse",
    });

    const entry = await waitFor(
      async () => {
        const { runs } = await h.client.call("run.ps", {});
        const mine = runs.find((r) => r.id === runId);
        return mine && mine.status === "completed" ? mine : null;
      },
      { timeoutMs: 6000, label: "reuse-completed" },
    );

    // Reused the pre-existing worktree rather than erroring or creating a new path (ADR-005).
    expect(entry.worktreePath).toBe(realpathSync(existing));
    expect(entry.branch).toBe("feature/reuse");
  });
});
