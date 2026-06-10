import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { homedir } from "node:os";
import { createApiApp } from "../app.js";
import {
  resolveWorkflowFile,
  resolveGlobalWorkflowsDir,
  resolveScopedWorkflowsDir,
} from "./workflow-crud.js";
import { WorkflowConfigError } from "../../../domain/workflow.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";
import { asRunId, asRunSlug, type RunSnapshot } from "../../../domain/run.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_WORKFLOW = {
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
      ide: "opencode",
      model: "test-model",
      edges: [],
    },
  ],
};

const MALFORMED_WORKFLOW_DUPLICATE_STEP = {
  id: "test-wf",
  name: "Test",
  description: "",
  version: "1",
  steps: [
    { id: "step-1", agent: "a", model: "m", ide: "opencode", mode: "autonomous", description: "", edges: [] },
    { id: "step-1", agent: "b", model: "m", ide: "opencode", mode: "autonomous", description: "", edges: [] },
  ],
};

const UPDATED_WORKFLOW = {
  id: "test-wf",
  name: "Updated Workflow",
  description: "Updated",
  version: "2",
  steps: [
    {
      id: "step-1",
      agent: "updated-agent",
      description: "Updated step",
      mode: "autonomous",
      ide: "opencode",
      model: "updated-model",
      edges: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePartialRm(snapshots: RunSnapshot[] = []): RunManager {
  return {
    list: () => snapshots,
    get: () => undefined,
    startRun: async () => { throw new Error("not implemented"); },
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

function makeRunningSnapshot(workflowPath: string): RunSnapshot {
  return {
    id: asRunId("run00001"),
    slug: asRunSlug("test-slug"),
    workflowPath,
    status: "running",
    currentStepId: null,
    visitedStepIds: [],
    kickoffPrompts: {},
    startedAt: Date.now(),
    endedAt: null,
  };
}

function makeTempCwd(): { cwd: string; cleanup: () => Promise<void> } {
  const cwd = mkdtempSync(join(tmpdir(), "workflow-crud-test-"));
  return {
    cwd,
    cleanup: () => rm(cwd, { recursive: true, force: true }).catch(() => {}),
  };
}

function makeCwdWithWorkflowsDir(): { cwd: string; wfDir: string; cleanup: () => Promise<void> } {
  const cwd = mkdtempSync(join(tmpdir(), "workflow-crud-test-"));
  const wfDir = join(cwd, "workflows");
  mkdirSync(wfDir);
  return {
    cwd,
    wfDir,
    cleanup: () => rm(cwd, { recursive: true, force: true }).catch(() => {}),
  };
}

/**
 * Points the global workflows dir (ADR-002) at a temp `XDG_STATE_HOME` so global
 * scope CRUD can be exercised without touching the real user state directory.
 * Restores the previous env value on cleanup.
 */
function makeTempGlobalState(): { globalDir: string; cleanup: () => Promise<void> } {
  const stateHome = mkdtempSync(join(tmpdir(), "workflow-crud-global-"));
  const prev = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
  const globalDir = resolveGlobalWorkflowsDir();
  return {
    globalDir,
    cleanup: async () => {
      if (prev === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = prev;
      await rm(stateHome, { recursive: true, force: true }).catch(() => {});
    },
  };
}

function jsonRequest(method: string, url: string, body: unknown) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

// ---------------------------------------------------------------------------
// Unit tests — POST /workflows (create)
// ---------------------------------------------------------------------------

describe("POST /workflows — create", () => {
  it("creates a workflow and returns 201 with name, path, and workflow", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "who-is", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.name).toBe("who-is");
      expect(typeof body.path).toBe("string");
      expect((body.path as string).endsWith("who-is.json")).toBe(true);
      expect(body.workflow).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("writes a file to disk at <cwd>/workflows/<name>.json", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "who-is", workflow: VALID_WORKFLOW }),
      );
      expect(existsSync(join(cwd, "workflows", "who-is.json"))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("returns 400 WORKFLOW_INVALID for a malformed workflow (duplicate step id)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "bad-wf", workflow: MALFORMED_WORKFLOW_DUPLICATE_STEP }),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_INVALID");
    } finally {
      await cleanup();
    }
  });

  it("returns 409 WORKFLOW_EXISTS when the workflow already exists", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "who-is.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "who-is", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(409);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_EXISTS");
    } finally {
      await cleanup();
    }
  });

  it("returns 400 for a name with path separators (../escape via body)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "../escape", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(400);
      expect(existsSync(join(cwd, "escape.json"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("returns 400 for a name with a slash (a/b via body)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "a/b", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(400);
    } finally {
      await cleanup();
    }
  });

  it("returns 400 when cwd is missing", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows",
      jsonRequest("POST", "", { name: "who-is", workflow: VALID_WORKFLOW }),
    );
    expect(res.status).toBe(400);
  });

  it("auto-creates the workflows directory if absent", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      expect(existsSync(join(cwd, "workflows"))).toBe(false);
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "new-wf", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(201);
      expect(existsSync(join(cwd, "workflows", "new-wf.json"))).toBe(true);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — GET /workflows/:name (read-one)
// ---------------------------------------------------------------------------

describe("GET /workflows/:name — read-one", () => {
  it("returns 200 with name, path, and workflow when the file exists", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "who-is.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/who-is?cwd=${encodeURIComponent(cwd)}`,
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.name).toBe("who-is");
      expect(typeof body.path).toBe("string");
      expect(body.workflow).toBeDefined();
    } finally {
      await cleanup();
    }
  });

  it("returns 404 for an unknown workflow name", async () => {
    const { cwd, cleanup } = makeCwdWithWorkflowsDir();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/does-not-exist?cwd=${encodeURIComponent(cwd)}`,
      );
      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("NOT_FOUND");
    } finally {
      await cleanup();
    }
  });

  it("returns 400 when cwd is missing", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows/who-is");
    expect(res.status).toBe(400);
  });

  it("returns 400 WORKFLOW_MALFORMED when the file on disk is not valid JSON", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "broken.json"), "{ not valid json ");
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/broken?cwd=${encodeURIComponent(cwd)}`,
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_MALFORMED");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — PUT /workflows/:name (update / rename)
// ---------------------------------------------------------------------------

describe("PUT /workflows/:name — update / rename", () => {
  it("updates the workflow content and returns 200", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "who-is.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/who-is?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { workflow: UPDATED_WORKFLOW }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.name).toBe("who-is");
    } finally {
      await cleanup();
    }
  });

  it("renames the workflow when body.name differs from param name", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "old-name.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/old-name?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { name: "new-name", workflow: UPDATED_WORKFLOW }),
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.name).toBe("new-name");
      expect(existsSync(join(wfDir, "new-name.json"))).toBe(true);
      expect(existsSync(join(wfDir, "old-name.json"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("returns 409 WORKFLOW_EXISTS when rename target already exists", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "source.json"), JSON.stringify(VALID_WORKFLOW));
      writeFileSync(join(wfDir, "existing.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/source?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { name: "existing", workflow: UPDATED_WORKFLOW }),
      );
      expect(res.status).toBe(409);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_EXISTS");
    } finally {
      await cleanup();
    }
  });

  it("returns 404 for an unknown workflow name", async () => {
    const { cwd, cleanup } = makeCwdWithWorkflowsDir();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/does-not-exist?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { workflow: UPDATED_WORKFLOW }),
      );
      expect(res.status).toBe(404);
    } finally {
      await cleanup();
    }
  });

  it("returns 400 WORKFLOW_INVALID for malformed workflow content", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "who-is.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/who-is?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { workflow: MALFORMED_WORKFLOW_DUPLICATE_STEP }),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_INVALID");
    } finally {
      await cleanup();
    }
  });

  it("returns 409 WORKFLOW_RUN_ACTIVE when renaming a workflow with an active run", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      const wfPath = join(wfDir, "active-wf.json");
      writeFileSync(wfPath, JSON.stringify(VALID_WORKFLOW));
      const snap = makeRunningSnapshot(wfPath);
      const app = createApiApp(makePartialRm([snap]));
      const res = await app.request(
        `/workflows/active-wf?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { name: "new-name", workflow: UPDATED_WORKFLOW }),
      );
      expect(res.status).toBe(409);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_RUN_ACTIVE");
    } finally {
      await cleanup();
    }
  });

  it("does NOT check run guard when name is unchanged (in-place update)", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      const wfPath = join(wfDir, "active-wf.json");
      writeFileSync(wfPath, JSON.stringify(VALID_WORKFLOW));
      const snap = makeRunningSnapshot(wfPath);
      const app = createApiApp(makePartialRm([snap]));
      const res = await app.request(
        `/workflows/active-wf?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { workflow: UPDATED_WORKFLOW }),
      );
      // In-place update is allowed even with active run
      expect(res.status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("returns 400 when cwd is missing", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows/who-is",
      jsonRequest("PUT", "", { workflow: UPDATED_WORKFLOW }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — DELETE /workflows/:name
// ---------------------------------------------------------------------------

describe("DELETE /workflows/:name — delete", () => {
  it("deletes the file and returns 200 with deleted name", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "who-is.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/who-is?cwd=${encodeURIComponent(cwd)}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.deleted).toBe("who-is");
      expect(existsSync(join(wfDir, "who-is.json"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("returns 404 for an unknown workflow name", async () => {
    const { cwd, cleanup } = makeCwdWithWorkflowsDir();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/does-not-exist?cwd=${encodeURIComponent(cwd)}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(404);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("NOT_FOUND");
    } finally {
      await cleanup();
    }
  });

  it("returns 409 WORKFLOW_RUN_ACTIVE when deleting a workflow with an active run", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      const wfPath = join(wfDir, "active-wf.json");
      writeFileSync(wfPath, JSON.stringify(VALID_WORKFLOW));
      const snap = makeRunningSnapshot(wfPath);
      const app = createApiApp(makePartialRm([snap]));
      const res = await app.request(
        `/workflows/active-wf?cwd=${encodeURIComponent(cwd)}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(409);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("WORKFLOW_RUN_ACTIVE");
      // File must NOT be deleted
      expect(existsSync(wfPath)).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("allows delete when only a terminal run references the workflow", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      const wfPath = join(wfDir, "done-wf.json");
      writeFileSync(wfPath, JSON.stringify(VALID_WORKFLOW));
      const snap: RunSnapshot = {
        id: asRunId("run00001"),
        slug: asRunSlug("test-slug"),
        workflowPath: wfPath,
        status: "completed",
        currentStepId: null,
        visitedStepIds: [],
        kickoffPrompts: {},
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      const app = createApiApp(makePartialRm([snap]));
      const res = await app.request(
        `/workflows/done-wf?cwd=${encodeURIComponent(cwd)}`,
        { method: "DELETE" },
      );
      expect(res.status).toBe(200);
    } finally {
      await cleanup();
    }
  });

  it("returns 400 when cwd is missing", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows/who-is",
      { method: "DELETE" },
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Path traversal safety — all methods
// ---------------------------------------------------------------------------

describe("Path traversal safety", () => {
  it("POST rejects ../escape in body name without touching filesystem", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "../escape", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(400);
      expect(existsSync(join(cwd, "escape.json"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("POST rejects a/b (slash in name) in body without touching filesystem", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "a/b", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(400);
      const wfDir = join(cwd, "workflows");
      expect(existsSync(join(wfDir, "b.json"))).toBe(false);
    } finally {
      await cleanup();
    }
  });

  it("PUT rejects ../escape as rename target in body", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "safe.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows/safe?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("PUT", "", { name: "../escape", workflow: UPDATED_WORKFLOW }),
      );
      expect(res.status).toBe(400);
      expect(existsSync(join(cwd, "escape.json"))).toBe(false);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — resolveWorkflowFile containment guard
// ---------------------------------------------------------------------------

describe("resolveWorkflowFile — containment guard", () => {
  it("returns <cwd>/workflows/<name>.json for a safe bare name", () => {
    const file = resolveWorkflowFile("/tmp/project", "who-is");
    expect(file).toBe(join("/tmp/project", "workflows", "who-is.json"));
  });

  it("throws WorkflowConfigError for a traversal name that escapes the dir", () => {
    expect(() => resolveWorkflowFile("/tmp/project", "../escape")).toThrow(WorkflowConfigError);
  });

  it("throws WorkflowConfigError for a name that nests into a subdirectory", () => {
    expect(() => resolveWorkflowFile("/tmp/project", "sub/wf")).toThrow(WorkflowConfigError);
  });

  it("throws WorkflowConfigError (not a bare Error) so it maps to a client error", () => {
    let thrown: unknown;
    try {
      resolveWorkflowFile("/tmp/project", "../../etc/passwd");
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(WorkflowConfigError);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — scope directory resolution (ADR-002 / ADR-003)
// ---------------------------------------------------------------------------

describe("resolveGlobalWorkflowsDir", () => {
  it("honors XDG_STATE_HOME", () => {
    const dir = resolveGlobalWorkflowsDir({ XDG_STATE_HOME: "/xdg/state" });
    expect(dir).toBe(join("/xdg/state", "workflow-runner", "workflows"));
  });

  it("falls back to ~/.local/state/workflow-runner/workflows", () => {
    const dir = resolveGlobalWorkflowsDir({});
    expect(dir).toBe(join(homedir(), ".local", "state", "workflow-runner", "workflows"));
  });
});

describe("resolveScopedWorkflowsDir", () => {
  it("returns the global dir for 'global', ignoring cwd", () => {
    const env = { XDG_STATE_HOME: "/xdg/state" };
    const dir = resolveScopedWorkflowsDir("global", undefined, env);
    expect(dir).toBe(resolveGlobalWorkflowsDir(env));
  });

  it("ignores cwd when scope is 'global'", () => {
    const env = { XDG_STATE_HOME: "/xdg/state" };
    expect(resolveScopedWorkflowsDir("global", "/some/project", env)).toBe(
      resolveGlobalWorkflowsDir(env),
    );
  });

  it("throws WorkflowConfigError for 'project' without a cwd", () => {
    expect(() => resolveScopedWorkflowsDir("project", undefined)).toThrow(WorkflowConfigError);
  });

  it("returns <cwd>/workflows for 'project'", () => {
    const dir = resolveScopedWorkflowsDir("project", "/p");
    expect(dir).toBe(join("/p", "workflows"));
  });
});

// ---------------------------------------------------------------------------
// Integration tests — create → list → read → update → delete lifecycle
// ---------------------------------------------------------------------------

describe("Workflow CRUD lifecycle — integration", () => {
  let cwd: string;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    const tmp = makeTempCwd();
    cwd = tmp.cwd;
    cleanup = tmp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("full lifecycle: create → list shows it → read → update → delete → list gone", async () => {
    const app = createApiApp(makePartialRm());
    const cwdParam = encodeURIComponent(cwd);

    // 1. Create
    const createRes = await app.request(
      `/workflows?cwd=${cwdParam}`,
      jsonRequest("POST", "", { name: "my-workflow", workflow: VALID_WORKFLOW }),
    );
    expect(createRes.status).toBe(201);

    // 2. List shows it
    const listRes = await app.request(`/workflows?cwd=${cwdParam}`);
    expect(listRes.status).toBe(200);
    const listBody = await listRes.json() as { workflows: { name: string }[] };
    const names = listBody.workflows.map((w) => w.name);
    expect(names).toContain("my-workflow.json");

    // 3. Read
    const readRes = await app.request(`/workflows/my-workflow?cwd=${cwdParam}`);
    expect(readRes.status).toBe(200);
    const readBody = await readRes.json() as { name: string; path: string; workflow: unknown };
    expect(readBody.name).toBe("my-workflow");
    expect(readBody.workflow).toBeDefined();

    // 4. Update (in-place, same name)
    const updateRes = await app.request(
      `/workflows/my-workflow?cwd=${cwdParam}`,
      jsonRequest("PUT", "", { workflow: UPDATED_WORKFLOW }),
    );
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json() as { name: string };
    expect(updateBody.name).toBe("my-workflow");

    // 5. Delete
    const deleteRes = await app.request(
      `/workflows/my-workflow?cwd=${cwdParam}`,
      { method: "DELETE" },
    );
    expect(deleteRes.status).toBe(200);

    // 6. List no longer shows it
    const listRes2 = await app.request(`/workflows?cwd=${cwdParam}`);
    const listBody2 = await listRes2.json() as { workflows: { name: string }[] };
    const names2 = listBody2.workflows.map((w) => w.name);
    expect(names2).not.toContain("my-workflow.json");
  });

  it("rename lifecycle: create → rename → old name 404 → new name 200", async () => {
    const app = createApiApp(makePartialRm());
    const cwdParam = encodeURIComponent(cwd);

    // Create
    await app.request(
      `/workflows?cwd=${cwdParam}`,
      jsonRequest("POST", "", { name: "original", workflow: VALID_WORKFLOW }),
    );

    // Rename
    const renameRes = await app.request(
      `/workflows/original?cwd=${cwdParam}`,
      jsonRequest("PUT", "", { name: "renamed", workflow: UPDATED_WORKFLOW }),
    );
    expect(renameRes.status).toBe(200);

    // Old name is gone
    const oldRes = await app.request(`/workflows/original?cwd=${cwdParam}`);
    expect(oldRes.status).toBe(404);

    // New name exists
    const newRes = await app.request(`/workflows/renamed?cwd=${cwdParam}`);
    expect(newRes.status).toBe(200);
    const body = await newRes.json() as { name: string };
    expect(body.name).toBe("renamed");
  });
});

// ---------------------------------------------------------------------------
// Scope-aware CRUD — global scope (ADR-002 / ADR-003)
// ---------------------------------------------------------------------------

describe("Scope-aware CRUD — global scope", () => {
  let globalDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    const g = makeTempGlobalState();
    globalDir = g.globalDir;
    cleanup = g.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("POST ?scope=global creates the file in the global dir and returns scope:global (no cwd)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows?scope=global",
      jsonRequest("POST", "", { name: "deploy", workflow: VALID_WORKFLOW }),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("deploy");
    expect(body.scope).toBe("global");
    expect(body.path).toBe(join(globalDir, "deploy.json"));
    expect(existsSync(join(globalDir, "deploy.json"))).toBe(true);
  });

  it("lazily creates the global dir on first create", async () => {
    expect(existsSync(globalDir)).toBe(false);
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows?scope=global",
      jsonRequest("POST", "", { name: "deploy", workflow: VALID_WORKFLOW }),
    );
    expect(res.status).toBe(201);
    expect(existsSync(globalDir)).toBe(true);
  });

  it("GET ?scope=global reads a global workflow with no cwd supplied", async () => {
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "deploy.json"), JSON.stringify(VALID_WORKFLOW));
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows/deploy?scope=global");
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("deploy");
    expect(body.scope).toBe("global");
    expect(body.path).toBe(join(globalDir, "deploy.json"));
  });

  it("POST ?scope=global for an existing global name returns 409 WORKFLOW_EXISTS", async () => {
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "deploy.json"), JSON.stringify(VALID_WORKFLOW));
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows?scope=global",
      jsonRequest("POST", "", { name: "deploy", workflow: VALID_WORKFLOW }),
    );
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("WORKFLOW_EXISTS");
  });

  it("creating global 'deploy' succeeds when project 'deploy' already exists (no false 409)", async () => {
    const { cwd, wfDir, cleanup: cleanupCwd } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "deploy.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        "/workflows?scope=global",
        jsonRequest("POST", "", { name: "deploy", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.scope).toBe("global");
      expect(existsSync(join(globalDir, "deploy.json"))).toBe(true);
    } finally {
      await cleanupCwd();
    }
  });

  it("DELETE ?scope=global removes the global file and returns scope:global", async () => {
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "deploy.json"), JSON.stringify(VALID_WORKFLOW));
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows/deploy?scope=global", { method: "DELETE" });
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.deleted).toBe("deploy");
    expect(body.scope).toBe("global");
    expect(existsSync(join(globalDir, "deploy.json"))).toBe(false);
  });

  it("DELETE ?scope=global returns 404 when the global file is absent", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows/missing?scope=global", { method: "DELETE" });
    expect(res.status).toBe(404);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
  });

  it("PUT in-place update within global scope returns 200 with scope:global", async () => {
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "deploy.json"), JSON.stringify(VALID_WORKFLOW));
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows/deploy?scope=global",
      jsonRequest("PUT", "", { workflow: UPDATED_WORKFLOW }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("deploy");
    expect(body.scope).toBe("global");
  });

  it("PUT rename within global scope returns 409 WORKFLOW_EXISTS when target global name exists", async () => {
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "source.json"), JSON.stringify(VALID_WORKFLOW));
    writeFileSync(join(globalDir, "existing.json"), JSON.stringify(VALID_WORKFLOW));
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows/source?scope=global",
      jsonRequest("PUT", "", { name: "existing", workflow: UPDATED_WORKFLOW }),
    );
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("WORKFLOW_EXISTS");
  });

  it("PUT rename within global scope succeeds and moves the file", async () => {
    mkdirSync(globalDir, { recursive: true });
    writeFileSync(join(globalDir, "old-global.json"), JSON.stringify(VALID_WORKFLOW));
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows/old-global?scope=global",
      jsonRequest("PUT", "", { name: "new-global", workflow: UPDATED_WORKFLOW }),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.name).toBe("new-global");
    expect(body.scope).toBe("global");
    expect(existsSync(join(globalDir, "new-global.json"))).toBe(true);
    expect(existsSync(join(globalDir, "old-global.json"))).toBe(false);
  });

  it("path-traversal safety holds for global scope (POST ../escape rejected)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows?scope=global",
      jsonRequest("POST", "", { name: "../escape", workflow: VALID_WORKFLOW }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Scope-aware CRUD — default scope and project MISSING_CWD (ADR-003)
// ---------------------------------------------------------------------------

describe("Scope-aware CRUD — default project scope", () => {
  it("POST with no scope writes to <cwd>/workflows and returns scope:project (unchanged)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(
        `/workflows?cwd=${encodeURIComponent(cwd)}`,
        jsonRequest("POST", "", { name: "who-is", workflow: VALID_WORKFLOW }),
      );
      expect(res.status).toBe(201);
      const body = await res.json() as Record<string, unknown>;
      expect(body.scope).toBe("project");
      expect(existsSync(join(cwd, "workflows", "who-is.json"))).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("GET with no scope returns scope:project", async () => {
    const { cwd, wfDir, cleanup } = makeCwdWithWorkflowsDir();
    try {
      writeFileSync(join(wfDir, "who-is.json"), JSON.stringify(VALID_WORKFLOW));
      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows/who-is?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.scope).toBe("project");
    } finally {
      await cleanup();
    }
  });

  it("POST ?scope=project without cwd returns 400 MISSING_CWD", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request(
      "/workflows?scope=project",
      jsonRequest("POST", "", { name: "who-is", workflow: VALID_WORKFLOW }),
    );
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("MISSING_CWD");
  });

  it("GET ?scope=project without cwd returns 400 MISSING_CWD", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows/who-is?scope=project");
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("MISSING_CWD");
  });
});

// ---------------------------------------------------------------------------
// Run-active guard — global scope (ADR-003)
// ---------------------------------------------------------------------------

describe("Run-active guard — global scope", () => {
  let globalDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    const g = makeTempGlobalState();
    globalDir = g.globalDir;
    cleanup = g.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  it("DELETE ?scope=global returns 409 WORKFLOW_RUN_ACTIVE when a run references that global file", async () => {
    mkdirSync(globalDir, { recursive: true });
    const wfPath = join(globalDir, "active-global.json");
    writeFileSync(wfPath, JSON.stringify(VALID_WORKFLOW));
    const snap = makeRunningSnapshot(wfPath);
    const app = createApiApp(makePartialRm([snap]));
    const res = await app.request("/workflows/active-global?scope=global", { method: "DELETE" });
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("WORKFLOW_RUN_ACTIVE");
    expect(existsSync(wfPath)).toBe(true);
  });

  it("PUT rename of a global workflow with an active run returns 409 WORKFLOW_RUN_ACTIVE", async () => {
    mkdirSync(globalDir, { recursive: true });
    const wfPath = join(globalDir, "active-global.json");
    writeFileSync(wfPath, JSON.stringify(VALID_WORKFLOW));
    const snap = makeRunningSnapshot(wfPath);
    const app = createApiApp(makePartialRm([snap]));
    const res = await app.request(
      "/workflows/active-global?scope=global",
      jsonRequest("PUT", "", { name: "renamed-global", workflow: UPDATED_WORKFLOW }),
    );
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("WORKFLOW_RUN_ACTIVE");
    expect(existsSync(wfPath)).toBe(true);
  });

  it("in-place PUT of a global workflow with an active run is allowed (no rename)", async () => {
    mkdirSync(globalDir, { recursive: true });
    const wfPath = join(globalDir, "active-global.json");
    writeFileSync(wfPath, JSON.stringify(VALID_WORKFLOW));
    const snap = makeRunningSnapshot(wfPath);
    const app = createApiApp(makePartialRm([snap]));
    const res = await app.request(
      "/workflows/active-global?scope=global",
      jsonRequest("PUT", "", { workflow: UPDATED_WORKFLOW }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI registration tests
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes workflow CRUD routes", () => {
  it("documents GET /workflows/:name in the OpenAPI spec", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths["/workflows/:name"]).toBeDefined();
    expect(paths["/workflows/:name"]["get"]).toBeDefined();
  });

  it("documents POST /workflows in the OpenAPI spec", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths["/workflows"]["post"]).toBeDefined();
  });

  it("documents PUT and DELETE /workflows/:name in the OpenAPI spec", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, Record<string, unknown>>;
    expect(paths["/workflows/:name"]["put"]).toBeDefined();
    expect(paths["/workflows/:name"]["delete"]).toBeDefined();
  });
});
