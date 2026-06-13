import { describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { createApiApp } from "../app.js";
import { RunManager, RunManagerError } from "../../../infra/daemon/run-manager.js";
import { WorkflowConfigError } from "../../../domain/workflow.js";
import { FixtureSessionFactory } from "../../../infra/daemon/test-helpers/fixture-session-factory.js";
import { asRunId, asRunSlug } from "../../../domain/run.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StartRunFn = (workflowPath: string, cwd: string, branch?: string, initialPrompt?: string) => Promise<{ runId: ReturnType<typeof asRunId>; slug: ReturnType<typeof asRunSlug> }>;

function makeRm(startRunImpl: StartRunFn): RunManager {
  return {
    list: () => [],
    get: () => undefined,
    startRun: startRunImpl,
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

function makeSuccessRm(runId = "run001", slug = "brave-otter"): RunManager {
  return makeRm(async () => ({
    runId: asRunId(runId),
    slug: asRunSlug(slug),
  }));
}

function makeErrorRm(err: unknown): RunManager {
  return makeRm(async () => { throw err; });
}

async function postRuns(app: ReturnType<typeof createApiApp>, body: unknown) {
  return app.request("/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Unit tests — POST /runs
// ---------------------------------------------------------------------------

describe("POST /runs — unit", () => {
  it("returns 201 with { runId, slug } when body is valid", async () => {
    const app = createApiApp(makeSuccessRm("run001", "brave-otter"));

    const res = await postRuns(app, {
      workflowPath: "/tmp/wf.json",
      cwd: "/tmp/project",
    });

    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.runId).toBe("run001");
    expect(body.slug).toBe("brave-otter");
  });

  it("calls startRun with the exact workflowPath and cwd from the body", async () => {
    let capturedWorkflowPath: string | undefined;
    let capturedCwd: string | undefined;

    const rm = makeRm(async (wp: string, c: string) => {
      capturedWorkflowPath = wp;
      capturedCwd = c;
      return { runId: asRunId("run001"), slug: asRunSlug("brave-otter") };
    });

    const app = createApiApp(rm);
    await postRuns(app, {
      workflowPath: "/workspace/workflow.json",
      cwd: "/workspace/myproject",
    });

    expect(capturedWorkflowPath).toBe("/workspace/workflow.json");
    expect(capturedCwd).toBe("/workspace/myproject");
  });

  it("forwards the branch from the body to startRun", async () => {
    let capturedBranch: string | undefined = "UNSET";

    const rm = makeRm(async (_wp: string, _c: string, b?: string) => {
      capturedBranch = b;
      return { runId: asRunId("run001"), slug: asRunSlug("brave-otter") };
    });

    const app = createApiApp(rm);
    await postRuns(app, {
      workflowPath: "/workspace/workflow.json",
      cwd: "/workspace/myproject",
      branch: "feature/iso",
    });

    expect(capturedBranch).toBe("feature/iso");
  });

  it("forwards undefined branch when the body omits it (behavior unchanged)", async () => {
    let capturedBranch: string | undefined = "UNSET";

    const rm = makeRm(async (_wp: string, _c: string, b?: string) => {
      capturedBranch = b;
      return { runId: asRunId("run001"), slug: asRunSlug("brave-otter") };
    });

    const app = createApiApp(rm);
    await postRuns(app, {
      workflowPath: "/workspace/workflow.json",
      cwd: "/workspace/myproject",
    });

    expect(capturedBranch).toBeUndefined();
  });

  it("forwards the initialPrompt from the body to startRun", async () => {
    let capturedPrompt: string | undefined = "UNSET";

    const rm = makeRm(async (_wp: string, _c: string, _b?: string, p?: string) => {
      capturedPrompt = p;
      return { runId: asRunId("run001"), slug: asRunSlug("brave-otter") };
    });

    const app = createApiApp(rm);
    await postRuns(app, {
      workflowPath: "/workspace/workflow.json",
      cwd: "/workspace/myproject",
      initialPrompt: "do X",
    });

    expect(capturedPrompt).toBe("do X");
  });

  it("forwards undefined initialPrompt when the body omits it (behavior unchanged)", async () => {
    let capturedPrompt: string | undefined = "UNSET";

    const rm = makeRm(async (_wp: string, _c: string, _b?: string, p?: string) => {
      capturedPrompt = p;
      return { runId: asRunId("run001"), slug: asRunSlug("brave-otter") };
    });

    const app = createApiApp(rm);
    await postRuns(app, {
      workflowPath: "/workspace/workflow.json",
      cwd: "/workspace/myproject",
    });

    expect(capturedPrompt).toBeUndefined();
  });

  it("returns 400 when initialPrompt is not a string", async () => {
    let startRunCalled = false;
    const rm = makeRm(async () => {
      startRunCalled = true;
      return { runId: asRunId("run001"), slug: asRunSlug("slug") };
    });
    const app = createApiApp(rm);

    const res = await postRuns(app, {
      workflowPath: "/tmp/wf.json",
      cwd: "/tmp/project",
      initialPrompt: 42,
    });

    expect(res.status).toBe(400);
    expect(startRunCalled).toBe(false);
  });

  it("returns 400 when branch is an empty string", async () => {
    let startRunCalled = false;
    const rm = makeRm(async () => {
      startRunCalled = true;
      return { runId: asRunId("run001"), slug: asRunSlug("slug") };
    });
    const app = createApiApp(rm);

    const res = await postRuns(app, {
      workflowPath: "/tmp/wf.json",
      cwd: "/tmp/project",
      branch: "",
    });

    expect(res.status).toBe(400);
    expect(startRunCalled).toBe(false);
  });

  it("returns 400 when cwd is missing", async () => {
    let startRunCalled = false;
    const rm = makeRm(async () => {
      startRunCalled = true;
      return { runId: asRunId("run001"), slug: asRunSlug("slug") };
    });
    const app = createApiApp(rm);

    const res = await postRuns(app, { workflowPath: "/tmp/wf.json" });

    expect(res.status).toBe(400);
    expect(startRunCalled).toBe(false);
  });

  it("returns 400 when workflowPath is missing", async () => {
    let startRunCalled = false;
    const rm = makeRm(async () => {
      startRunCalled = true;
      return { runId: asRunId("run001"), slug: asRunSlug("slug") };
    });
    const app = createApiApp(rm);

    const res = await postRuns(app, { cwd: "/tmp/project" });

    expect(res.status).toBe(400);
    expect(startRunCalled).toBe(false);
  });

  it("returns 400 when cwd is an empty string", async () => {
    let startRunCalled = false;
    const rm = makeRm(async () => {
      startRunCalled = true;
      return { runId: asRunId("run001"), slug: asRunSlug("slug") };
    });
    const app = createApiApp(rm);

    const res = await postRuns(app, { workflowPath: "/tmp/wf.json", cwd: "" });

    expect(res.status).toBe(400);
    expect(startRunCalled).toBe(false);
  });

  it("returns 400 when workflowPath is an empty string", async () => {
    let startRunCalled = false;
    const rm = makeRm(async () => {
      startRunCalled = true;
      return { runId: asRunId("run001"), slug: asRunSlug("slug") };
    });
    const app = createApiApp(rm);

    const res = await postRuns(app, { workflowPath: "", cwd: "/tmp/project" });

    expect(res.status).toBe(400);
    expect(startRunCalled).toBe(false);
  });

  it("returns 400 (WORKFLOW_INVALID) when startRun throws WorkflowConfigError", async () => {
    const rm = makeErrorRm(new WorkflowConfigError("workflow.json not found"));
    const app = createApiApp(rm);

    const res = await postRuns(app, {
      workflowPath: "/nonexistent/wf.json",
      cwd: "/tmp/project",
    });

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("WORKFLOW_INVALID");
    expect(typeof body.message).toBe("string");
  });

  it("returns 429 (RUN_LIMIT_REACHED) when startRun throws RunManagerError with that code", async () => {
    const rm = makeErrorRm(
      new RunManagerError("RUN_LIMIT_REACHED", "Run limit of 5 reached"),
    );
    const app = createApiApp(rm);

    const res = await postRuns(app, {
      workflowPath: "/tmp/wf.json",
      cwd: "/tmp/project",
    });

    expect(res.status).toBe(429);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("RUN_LIMIT_REACHED");
    expect(typeof body.message).toBe("string");
  });

  it("returns 400 when body is not JSON / completely absent", async () => {
    const app = createApiApp(makeSuccessRm());

    const res = await app.request("/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /openapi.json — POST /runs registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes POST /runs", () => {
  it("documents POST /runs in the OpenAPI spec", async () => {
    const app = createApiApp(makeSuccessRm());
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/runs"]).toBeDefined();
    const runsPath = paths["/runs"] as Record<string, unknown>;
    expect(runsPath["post"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — real RunManager with FixtureSessionFactory
// ---------------------------------------------------------------------------

function makeWorkflowJson(id: string, description: string): string {
  return JSON.stringify({
    id,
    name: id,
    description: id,
    version: "1",
    steps: [
      {
        id: "s1",
        agent: "fake/AGENT",
        model: "fake/model",
        mode: "autonomous",
        ide: "fake",
        description,
        edges: [],
      },
    ],
  });
}

describe("POST /runs — integration (real RunManager)", () => {
  it("starts a run and returns 201 with { runId, slug }", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "start-run-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("start-run-test", "fake:hang"));

      const app = createApiApp(manager);
      const res = await postRuns(app, {
        workflowPath: wfPath,
        cwd: storageRoot,
      });

      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(typeof body.runId).toBe("string");
      expect(typeof body.slug).toBe("string");
      expect((body.runId as string).length).toBeGreaterThan(0);
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("started run appears in GET /runs", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "start-run-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("start-run-test-2", "fake:hang"));

      const app = createApiApp(manager);

      const postRes = await postRuns(app, {
        workflowPath: wfPath,
        cwd: storageRoot,
      });
      expect(postRes.status).toBe(201);
      const { runId } = await postRes.json() as { runId: string; slug: string };

      const listRes = await app.request("/runs");
      expect(listRes.status).toBe(200);
      const { runs } = await listRes.json() as { runs: { id: string; status: string }[] };

      const started = runs.find((r) => r.id === runId);
      expect(started).toBeDefined();
      expect(started?.status).toBe("running");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns 400 (WORKFLOW_INVALID) for a non-existent workflow path", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "start-run-it-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const app = createApiApp(manager);

      const res = await postRuns(app, {
        workflowPath: "/does/not/exist/wf.json",
        cwd: storageRoot,
      });

      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_INVALID");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests — isolated runs over HTTP against real git repos
// ---------------------------------------------------------------------------

/** Create a committed git repo at `<parent>/<name>` and return its real path. */
function initRepo(parent: string, name: string): string {
  const repo = join(parent, name);
  execFileSync("git", ["init", "-b", "main", repo], { stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: repo, stdio: "pipe" });
  execFileSync("sh", ["-c", "printf '# repo\\n' > README.md"], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: repo, stdio: "pipe" });
  return repo;
}

describe("POST /runs — isolated-run integration (real git)", () => {
  it("starts an isolated run and surfaces worktreePath/branch on GET /runs and GET /runs/:id", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "start-run-iso-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });
    // realpath so assertions match git's canonical paths (symlinked tmp on macOS).
    const parentDir = realpathSync(mkdtempSync(join(tmpdir(), "start-run-iso-repo-")));

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const repo = initRepo(parentDir, "app");
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("iso-http", "fake:hang"));

      const app = createApiApp(manager);
      const postRes = await postRuns(app, {
        workflowPath: wfPath,
        cwd: repo,
        branch: "feature/iso",
      });

      expect(postRes.status).toBe(201);
      const { runId } = await postRes.json() as { runId: string; slug: string };

      const expectedWorktree = join(dirname(repo), `${basename(repo)}-feature-iso`);

      // GET /runs surfaces worktreePath/branch.
      const listRes = await app.request("/runs");
      expect(listRes.status).toBe(200);
      const { runs } = await listRes.json() as {
        runs: { id: string; worktreePath?: string; branch?: string }[];
      };
      const listed = runs.find((r) => r.id === runId);
      expect(listed).toBeDefined();
      expect(listed?.worktreePath).toBe(expectedWorktree);
      expect(listed?.branch).toBe("feature/iso");

      // GET /runs/:id surfaces worktreePath/branch.
      const detailRes = await app.request(`/runs/${runId}`);
      expect(detailRes.status).toBe(200);
      const detail = await detailRes.json() as Record<string, unknown>;
      expect(detail.worktreePath).toBe(expectedWorktree);
      expect(detail.branch).toBe("feature/iso");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      await rm(parentDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("returns 400 (NOT_A_GIT_REPO) when starting with a branch against a non-git cwd", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "start-run-iso-"));
    const storageRoot = join(tempDir, "workflow-runner");
    mkdirSync(storageRoot, { recursive: true });
    // A plain directory that is not inside any git repo.
    const nonGitCwd = realpathSync(mkdtempSync(join(tmpdir(), "start-run-nogit-")));

    const factory = new FixtureSessionFactory();
    const manager = new RunManager(storageRoot, factory);
    try {
      const wfPath = join(storageRoot, "test.json");
      await Bun.write(wfPath, makeWorkflowJson("iso-nogit", "fake:hang"));

      const app = createApiApp(manager);
      const res = await postRuns(app, {
        workflowPath: wfPath,
        cwd: nonGitCwd,
        branch: "feature/iso",
      });

      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("NOT_A_GIT_REPO");
    } finally {
      await manager.shutdown();
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      await rm(nonGitCwd, { recursive: true, force: true }).catch(() => {});
    }
  });
});
