import { simpleGit, type SimpleGit } from "simple-git";

/**
 * Thin seam over the few git worktree operations isolated runs need. One real
 * implementation ({@link SimpleGitWorktrees}) plus a test fake satisfy the
 * project's port rule (two implementations justify the interface). See ADR-002.
 */
export interface GitWorktrees {
  /** Absolute path of the repo root containing `dir`, or null if `dir` is not in a git repo. */
  resolveRepoRoot(dir: string): Promise<string | null>;
  /** Path of the worktree already checked out on `branch`, or null if none (ADR-005). */
  findWorktreeForBranch(repoRoot: string, branch: string): Promise<string | null>;
  /** True if a local branch named `branch` already exists. */
  branchExists(repoRoot: string, branch: string): Promise<boolean>;
  /**
   * Create a worktree at `worktreePath` on `branch`. When `createBranch` is true the
   * branch is created off the current HEAD; otherwise the existing branch is checked out.
   * Throws GitWorktreeError("BRANCH_IN_USE" | "PATH_EXISTS") on conflict.
   */
  addWorktree(args: {
    repoRoot: string;
    worktreePath: string;
    branch: string;
    createBranch: boolean;
  }): Promise<void>;
}

export type GitWorktreeErrorCode = "BRANCH_IN_USE" | "PATH_EXISTS";

/** Stable, normalized failure surfaced by the adapter so callers map codes, not git messages. */
export class GitWorktreeError extends Error {
  constructor(
    readonly code: GitWorktreeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitWorktreeError";
  }
}

/**
 * Parse the path checked out on `branch` from `git worktree list --porcelain`
 * output. The porcelain format emits one record per worktree as a group of
 * NUL-or-newline-separated attribute lines (`worktree <path>`, `HEAD <sha>`,
 * `branch refs/heads/<name>` or `detached`), records separated by blank lines.
 */
export function parseWorktreeForBranch(
  porcelain: string,
  branch: string,
): string | null {
  const target = `refs/heads/${branch}`;
  let currentPath: string | null = null;
  for (const rawLine of porcelain.split("\n")) {
    const line = rawLine.trim();
    if (line === "") {
      currentPath = null;
      continue;
    }
    if (line.startsWith("worktree ")) {
      currentPath = line.slice("worktree ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      if (ref === target && currentPath) {
        return currentPath;
      }
    }
  }
  return null;
}

export class SimpleGitWorktrees implements GitWorktrees {
  readonly #git: (dir: string) => SimpleGit;

  /** `gitFactory` is injectable purely so the parsing/normalization seams stay unit-testable. */
  constructor(gitFactory: (dir: string) => SimpleGit = (dir) => simpleGit(dir)) {
    this.#git = gitFactory;
  }

  async resolveRepoRoot(dir: string): Promise<string | null> {
    try {
      const root = await this.#git(dir).revparse(["--show-toplevel"]);
      const trimmed = root.trim();
      return trimmed === "" ? null : trimmed;
    } catch {
      // Not a git repository (or the directory does not exist): treat as non-repo.
      return null;
    }
  }

  async findWorktreeForBranch(
    repoRoot: string,
    branch: string,
  ): Promise<string | null> {
    const porcelain = await this.#git(repoRoot).raw([
      "worktree",
      "list",
      "--porcelain",
    ]);
    return parseWorktreeForBranch(porcelain, branch);
  }

  async branchExists(repoRoot: string, branch: string): Promise<boolean> {
    const summary = await this.#git(repoRoot).branchLocal();
    return summary.all.includes(branch);
  }

  async addWorktree(args: {
    repoRoot: string;
    worktreePath: string;
    branch: string;
    createBranch: boolean;
  }): Promise<void> {
    const { repoRoot, worktreePath, branch, createBranch } = args;
    // `-b <branch> <path>` creates the branch off HEAD; `<path> <branch>` checks
    // out an existing branch into the new worktree.
    const command = createBranch
      ? ["worktree", "add", "-b", branch, worktreePath]
      : ["worktree", "add", worktreePath, branch];
    try {
      await this.#git(repoRoot).raw(command);
    } catch (err) {
      throw normalizeAddWorktreeError(err, worktreePath, branch);
    }
  }
}

/**
 * Map a `git worktree add` failure to a stable {@link GitWorktreeError} code.
 * git surfaces these as exit-code-1 errors with diagnostic stderr text; we key
 * off the recognizable fatal messages and re-throw anything else untouched.
 */
function normalizeAddWorktreeError(
  err: unknown,
  worktreePath: string,
  branch: string,
): unknown {
  const message = err instanceof Error ? err.message : String(err);
  if (/already exists/.test(message)) {
    return new GitWorktreeError(
      "PATH_EXISTS",
      `Worktree target path '${worktreePath}' already exists`,
    );
  }
  if (/already (checked out|used by worktree)/.test(message)) {
    return new GitWorktreeError(
      "BRANCH_IN_USE",
      `Branch '${branch}' is already checked out in another worktree`,
    );
  }
  return err;
}
