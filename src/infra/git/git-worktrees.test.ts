import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { simpleGit } from "simple-git";
import {
  GitWorktreeError,
  SimpleGitWorktrees,
  parseWorktreeForBranch,
} from "./git-worktrees.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** Create a temp git repo with one commit and return its (real) absolute path. */
async function initRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "wr-git-"));
  roots.push(dir);
  // mkdtemp can hand back a symlinked path (e.g. /var -> /private/var on macOS,
  // or /tmp resolution on Linux); git reports the canonical path, so canonicalize.
  const repo = realpathSync(dir);
  const git = simpleGit(repo);
  await git.init();
  await git.addConfig("user.email", "test@example.com");
  await git.addConfig("user.name", "Test");
  await git.addConfig("commit.gpgsign", "false");
  await writeFile(join(repo, "README.md"), "hello\n");
  await git.add("README.md");
  await git.commit("initial");
  return repo;
}

describe("SimpleGitWorktrees.resolveRepoRoot", () => {
  it("returns the repo root for the repo root directory", async () => {
    const repo = await initRepo();
    const adapter = new SimpleGitWorktrees();
    expect(await adapter.resolveRepoRoot(repo)).toBe(repo);
  });

  it("returns the repo root for a nested subdirectory", async () => {
    const repo = await initRepo();
    const nested = join(repo, "a", "b");
    await mkdir(nested, { recursive: true });
    const adapter = new SimpleGitWorktrees();
    expect(await adapter.resolveRepoRoot(nested)).toBe(repo);
  });

  it("returns null for a directory outside any git repo", async () => {
    const outside = await mkdtemp(join(tmpdir(), "wr-nogit-"));
    roots.push(outside);
    const adapter = new SimpleGitWorktrees();
    expect(await adapter.resolveRepoRoot(realpathSync(outside))).toBeNull();
  });
});

describe("SimpleGitWorktrees.branchExists", () => {
  it("returns true for an existing local branch and false for an unknown one", async () => {
    const repo = await initRepo();
    await simpleGit(repo).branch(["feature-x"]);
    const adapter = new SimpleGitWorktrees();
    expect(await adapter.branchExists(repo, "feature-x")).toBe(true);
    expect(await adapter.branchExists(repo, "does-not-exist")).toBe(false);
  });
});

describe("SimpleGitWorktrees.findWorktreeForBranch", () => {
  it("returns the path for a branch that already has a worktree, null otherwise", async () => {
    const repo = await initRepo();
    const adapter = new SimpleGitWorktrees();
    const wtPath = join(dirname(repo), `${basename(repo)}-feat`);
    roots.push(wtPath);

    await adapter.addWorktree({
      repoRoot: repo,
      worktreePath: wtPath,
      branch: "feat",
      createBranch: true,
    });

    expect(await adapter.findWorktreeForBranch(repo, "feat")).toBe(wtPath);
    expect(await adapter.findWorktreeForBranch(repo, "other")).toBeNull();
  });
});

describe("SimpleGitWorktrees.addWorktree", () => {
  it("creates a new branch off HEAD and a worktree at the target path", async () => {
    const repo = await initRepo();
    const adapter = new SimpleGitWorktrees();
    const wtPath = join(dirname(repo), `${basename(repo)}-new`);
    roots.push(wtPath);

    await adapter.addWorktree({
      repoRoot: repo,
      worktreePath: wtPath,
      branch: "new-branch",
      createBranch: true,
    });

    expect(existsSync(wtPath)).toBe(true);
    expect(existsSync(join(wtPath, "README.md"))).toBe(true);
    expect(await adapter.branchExists(repo, "new-branch")).toBe(true);
  });

  it("checks out an existing branch into a new worktree", async () => {
    const repo = await initRepo();
    await simpleGit(repo).branch(["existing"]);
    const adapter = new SimpleGitWorktrees();
    const wtPath = join(dirname(repo), `${basename(repo)}-existing`);
    roots.push(wtPath);

    await adapter.addWorktree({
      repoRoot: repo,
      worktreePath: wtPath,
      branch: "existing",
      createBranch: false,
    });

    expect(existsSync(wtPath)).toBe(true);
    expect(await adapter.findWorktreeForBranch(repo, "existing")).toBe(wtPath);
  });

  it("throws GitWorktreeError('PATH_EXISTS') when target is a non-worktree directory", async () => {
    const repo = await initRepo();
    const adapter = new SimpleGitWorktrees();
    const occupied = join(dirname(repo), `${basename(repo)}-taken`);
    roots.push(occupied);
    await mkdir(occupied, { recursive: true });
    await writeFile(join(occupied, "file.txt"), "x");

    const err = await adapter
      .addWorktree({
        repoRoot: repo,
        worktreePath: occupied,
        branch: "taken",
        createBranch: true,
      })
      .then(
        () => null,
        (e) => e,
      );

    expect(err).toBeInstanceOf(GitWorktreeError);
    expect((err as GitWorktreeError).code).toBe("PATH_EXISTS");
  });

  it("throws GitWorktreeError('BRANCH_IN_USE') when the branch is already checked out in another worktree", async () => {
    const repo = await initRepo();
    const adapter = new SimpleGitWorktrees();

    // First worktree checks out a new branch, so the branch is now in use.
    const firstPath = join(dirname(repo), `${basename(repo)}-first`);
    roots.push(firstPath);
    await adapter.addWorktree({
      repoRoot: repo,
      worktreePath: firstPath,
      branch: "shared",
      createBranch: true,
    });

    // A second worktree on the same branch must fail: git refuses to check the
    // branch out twice ("is already checked out at ...").
    const secondPath = join(dirname(repo), `${basename(repo)}-second`);
    roots.push(secondPath);
    const err = await adapter
      .addWorktree({
        repoRoot: repo,
        worktreePath: secondPath,
        branch: "shared",
        createBranch: false,
      })
      .then(
        () => null,
        (e) => e,
      );

    expect(err).toBeInstanceOf(GitWorktreeError);
    expect((err as GitWorktreeError).code).toBe("BRANCH_IN_USE");
  });
});

describe("parseWorktreeForBranch", () => {
  const porcelain = [
    "worktree /work/app",
    "HEAD abc123",
    "branch refs/heads/main",
    "",
    "worktree /work/app-feat",
    "HEAD def456",
    "branch refs/heads/feat",
    "",
    "worktree /work/app-detached",
    "HEAD ghi789",
    "detached",
    "",
  ].join("\n");

  it("returns the matching worktree path", () => {
    expect(parseWorktreeForBranch(porcelain, "feat")).toBe("/work/app-feat");
    expect(parseWorktreeForBranch(porcelain, "main")).toBe("/work/app");
  });

  it("returns null for a branch with no worktree", () => {
    expect(parseWorktreeForBranch(porcelain, "nope")).toBeNull();
  });

  it("does not match a detached worktree", () => {
    expect(parseWorktreeForBranch(porcelain, "")).toBeNull();
  });
});

describe("integration: full reuse-or-create sequence against a real repo", () => {
  it("init+commit, create worktree on a new branch, then findWorktreeForBranch reports it", async () => {
    const repo = await initRepo();
    const adapter = new SimpleGitWorktrees();

    // No worktree yet for the branch.
    expect(await adapter.findWorktreeForBranch(repo, "iso-run")).toBeNull();
    expect(await adapter.branchExists(repo, "iso-run")).toBe(false);

    const wtPath = join(dirname(repo), `${basename(repo)}-iso-run`);
    roots.push(wtPath);
    await adapter.addWorktree({
      repoRoot: repo,
      worktreePath: wtPath,
      branch: "iso-run",
      createBranch: true,
    });

    // The branch and the worktree now exist and are discoverable.
    expect(await adapter.branchExists(repo, "iso-run")).toBe(true);
    expect(await adapter.findWorktreeForBranch(repo, "iso-run")).toBe(wtPath);
    expect(existsSync(join(wtPath, "README.md"))).toBe(true);
  });
});

describe("FakeGitWorktrees", () => {
  it("records addWorktree calls and reflects them in lookups", async () => {
    const { FakeGitWorktrees } = await import("./git-worktrees.fake.js");
    const fake = new FakeGitWorktrees({
      repoRoots: { "/repo/sub": "/repo" },
      existingBranches: ["main"],
    });

    expect(await fake.resolveRepoRoot("/repo/sub")).toBe("/repo");
    expect(await fake.resolveRepoRoot("/elsewhere")).toBeNull();
    expect(await fake.branchExists("/repo", "main")).toBe(true);
    expect(await fake.findWorktreeForBranch("/repo", "feat")).toBeNull();

    await fake.addWorktree({
      repoRoot: "/repo",
      worktreePath: "/repo-feat",
      branch: "feat",
      createBranch: true,
    });

    expect(fake.lastAddWorktreeCall?.branch).toBe("feat");
    expect(await fake.findWorktreeForBranch("/repo", "feat")).toBe("/repo-feat");
    expect(await fake.branchExists("/repo", "feat")).toBe(true);
  });

  it("throws the configured GitWorktreeError code", async () => {
    const { FakeGitWorktrees } = await import("./git-worktrees.fake.js");
    const fake = new FakeGitWorktrees({ addWorktreeError: "PATH_EXISTS" });
    const err = await fake
      .addWorktree({
        repoRoot: "/repo",
        worktreePath: "/repo-x",
        branch: "x",
        createBranch: true,
      })
      .then(
        () => null,
        (e) => e,
      );
    expect((err as GitWorktreeError).code).toBe("PATH_EXISTS");
  });
});
