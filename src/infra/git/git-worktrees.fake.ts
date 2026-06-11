import { GitWorktreeError, type GitWorktrees } from "./git-worktrees.js";

export interface AddWorktreeCall {
  repoRoot: string;
  worktreePath: string;
  branch: string;
  createBranch: boolean;
}

export interface FakeGitWorktreesConfig {
  /** Map of directory -> repo root. A `null` value means the dir is not in a repo. */
  repoRoots?: Record<string, string | null>;
  /** Local branch names that already exist. */
  existingBranches?: string[];
  /** Map of branch -> path of a worktree already checked out on it. */
  worktreesByBranch?: Record<string, string>;
  /** When set, `addWorktree` throws this code instead of recording the call. */
  addWorktreeError?: GitWorktreeError["code"];
  /** When set, `findWorktreeForBranch` throws this error (simulates a git read failure). */
  findWorktreeForBranchError?: Error;
  /** When set, `branchExists` throws this error (simulates a git read failure). */
  branchExistsError?: Error;
}

/**
 * In-memory {@link GitWorktrees} for unit tests (the second implementation that
 * justifies the interface per the port rule). Records `addWorktree` calls and
 * lets callers seed repo roots, branches, and existing worktrees. Dependent
 * tasks (e.g. RunManager) use this to exercise the reuse-or-create flow without
 * touching real git.
 */
export class FakeGitWorktrees implements GitWorktrees {
  readonly addWorktreeCalls: AddWorktreeCall[] = [];

  #repoRoots: Record<string, string | null>;
  #existingBranches: Set<string>;
  #worktreesByBranch: Map<string, string>;
  #addWorktreeError?: GitWorktreeError["code"];
  #findWorktreeForBranchError?: Error;
  #branchExistsError?: Error;

  constructor(config: FakeGitWorktreesConfig = {}) {
    this.#repoRoots = { ...config.repoRoots };
    this.#existingBranches = new Set(config.existingBranches ?? []);
    this.#worktreesByBranch = new Map(
      Object.entries(config.worktreesByBranch ?? {}),
    );
    this.#addWorktreeError = config.addWorktreeError;
    this.#findWorktreeForBranchError = config.findWorktreeForBranchError;
    this.#branchExistsError = config.branchExistsError;
  }

  async resolveRepoRoot(dir: string): Promise<string | null> {
    if (dir in this.#repoRoots) {
      return this.#repoRoots[dir] ?? null;
    }
    return null;
  }

  async findWorktreeForBranch(
    _repoRoot: string,
    branch: string,
  ): Promise<string | null> {
    if (this.#findWorktreeForBranchError) {
      throw this.#findWorktreeForBranchError;
    }
    return this.#worktreesByBranch.get(branch) ?? null;
  }

  async branchExists(_repoRoot: string, branch: string): Promise<boolean> {
    if (this.#branchExistsError) {
      throw this.#branchExistsError;
    }
    return this.#existingBranches.has(branch);
  }

  async addWorktree(args: AddWorktreeCall): Promise<void> {
    if (this.#addWorktreeError) {
      throw new GitWorktreeError(
        this.#addWorktreeError,
        `fake addWorktree configured to fail with ${this.#addWorktreeError}`,
      );
    }
    this.addWorktreeCalls.push({ ...args });
    // Reflect the new worktree so a subsequent lookup reports it.
    this.#existingBranches.add(args.branch);
    this.#worktreesByBranch.set(args.branch, args.worktreePath);
  }

  get lastAddWorktreeCall(): AddWorktreeCall | undefined {
    return this.addWorktreeCalls[this.addWorktreeCalls.length - 1];
  }
}
