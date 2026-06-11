import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePartialRm(): RunManager {
  return {
    list: () => [],
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

function makeTempCwd(): { cwd: string; cleanup: () => Promise<void> } {
  const cwd = mkdtempSync(join(tmpdir(), "workflows-test-"));
  return {
    cwd,
    cleanup: () => rm(cwd, { recursive: true, force: true }).catch(() => {}),
  };
}

// Each test runs with an isolated global directory (ADR-002) rooted at a temp
// XDG_STATE_HOME, so the always-included global portion is empty unless a test
// populates it. This keeps project-only assertions deterministic.
let prevXdgStateHome: string | undefined;
let globalRoot: string;
let globalWorkflowsDir: string;

beforeEach(() => {
  prevXdgStateHome = process.env.XDG_STATE_HOME;
  globalRoot = mkdtempSync(join(tmpdir(), "workflows-global-"));
  process.env.XDG_STATE_HOME = globalRoot;
  globalWorkflowsDir = join(globalRoot, "workflow-runner", "workflows");
});

afterEach(async () => {
  if (prevXdgStateHome === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = prevXdgStateHome;
  await rm(globalRoot, { recursive: true, force: true }).catch(() => {});
});

function writeGlobalWorkflow(name: string, content = "{}"): void {
  mkdirSync(globalWorkflowsDir, { recursive: true });
  writeFileSync(join(globalWorkflowsDir, name), content);
}

// ---------------------------------------------------------------------------
// Unit tests — GET /workflows
// ---------------------------------------------------------------------------

describe("GET /workflows — unit", () => {
  it("returns 200 with only global items when cwd query is missing", async () => {
    writeGlobalWorkflow("g.json");
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows");
    expect(res.status).toBe(200);
    const body = await res.json() as { workflows: { name: string; scope: string }[] };
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0]!.name).toBe("g.json");
    expect(body.workflows[0]!.scope).toBe("global");
  });

  it("returns 200 with only global items when cwd is empty string", async () => {
    writeGlobalWorkflow("g.json");
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows?cwd=");
    expect(res.status).toBe(200);
    const body = await res.json() as { workflows: { scope: string }[] };
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0]!.scope).toBe("global");
  });

  it("returns 200 with empty list when neither project nor global dir exists", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: unknown[] };
      expect(Array.isArray(body.workflows)).toBe(true);
      expect(body.workflows).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it("returns only *.json direct children — filters out non-json files", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "a.json"), "{}");
      writeFileSync(join(workflowsDir, "b.json"), "{}");
      writeFileSync(join(workflowsDir, "notes.txt"), "not a workflow");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; path: string }[] };
      const names = body.workflows.map((w) => w.name).sort();
      expect(names).toEqual(["a.json", "b.json"]);
    } finally {
      await cleanup();
    }
  });

  it("returns absolute paths and project scope for each project workflow", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "a.json"), "{}");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; path: string; scope: string }[] };
      expect(body.workflows).toHaveLength(1);
      const wf = body.workflows[0]!;
      expect(wf.name).toBe("a.json");
      expect(wf.path).toBe(join(workflowsDir, "a.json"));
      expect(wf.scope).toBe("project");
      // Path must be absolute.
      expect(wf.path.startsWith("/")).toBe(true);
    } finally {
      await cleanup();
    }
  });

  it("does NOT return nested json files (no recursion)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      const subDir = join(workflowsDir, "sub");
      mkdirSync(subDir, { recursive: true });
      writeFileSync(join(workflowsDir, "top.json"), "{}");
      writeFileSync(join(subDir, "c.json"), "{}");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string }[] };
      const names = body.workflows.map((w) => w.name);
      expect(names).toContain("top.json");
      expect(names).not.toContain("c.json");
      expect(body.workflows).toHaveLength(1);
    } finally {
      await cleanup();
    }
  });

  it("returns 400 INVALID_CWD when cwd/workflows is a file (ENOTDIR)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      // Create a regular file at the path readdir would try to open as a dir.
      writeFileSync(join(cwd, "workflows"), "not a directory");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("INVALID_CWD");
      expect(typeof body.message).toBe("string");
    } finally {
      await cleanup();
    }
  });

  it("returns 400 INVALID_CWD when cwd/workflows is unreadable (EACCES)", async () => {
    if (process.getuid?.() === 0) return; // root bypasses permission checks
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      chmodSync(workflowsDir, 0o000);

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("INVALID_CWD");
    } finally {
      // Restore permissions so cleanup can delete the directory.
      try { chmodSync(join(cwd, "workflows"), 0o755); } catch { /* ignore */ }
      await cleanup();
    }
  });

  it("returns 200 with empty list when workflows/ contains no json files", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "notes.txt"), "text only");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: unknown[] };
      expect(body.workflows).toHaveLength(0);
    } finally {
      await cleanup();
    }
  });

  it("each workflow entry has name, path, and scope fields", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "wf.json"), "{}");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: Record<string, unknown>[] };
      expect(body.workflows).toHaveLength(1);
      const entry = body.workflows[0]!;
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.path).toBe("string");
      expect(entry.scope).toBe("project");
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Unit tests — combined scope-tagged list (task_03)
// ---------------------------------------------------------------------------

describe("GET /workflows — combined scope tagging", () => {
  it("with cwd set and globals present, returns both, each correctly scoped", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "p.json"), "{}");
      writeGlobalWorkflow("g.json");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; scope: string }[] };
      const byName = new Map(body.workflows.map((w) => [w.name, w.scope]));
      expect(byName.get("p.json")).toBe("project");
      expect(byName.get("g.json")).toBe("global");
      expect(body.workflows).toHaveLength(2);
    } finally {
      await cleanup();
    }
  });

  it("with cwd set and no global dir, returns only project items (no error)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "p.json"), "{}");
      // globalWorkflowsDir intentionally not created.

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; scope: string }[] };
      expect(body.workflows).toHaveLength(1);
      expect(body.workflows[0]!.name).toBe("p.json");
      expect(body.workflows[0]!.scope).toBe("project");
    } finally {
      await cleanup();
    }
  });

  it("with cwd omitted, returns only global items (no MISSING_CWD error)", async () => {
    writeGlobalWorkflow("g1.json");
    writeGlobalWorkflow("g2.json");
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows");
    expect(res.status).toBe(200);
    const body = await res.json() as { workflows: { name: string; scope: string }[] };
    const names = body.workflows.map((w) => w.name).sort();
    expect(names).toEqual(["g1.json", "g2.json"]);
    expect(body.workflows.every((w) => w.scope === "global")).toBe(true);
  });

  it("project dir ENOENT yields empty project portion while globals still list", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      // No <cwd>/workflows directory (ENOENT).
      writeGlobalWorkflow("g.json");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; scope: string }[] };
      expect(body.workflows).toHaveLength(1);
      expect(body.workflows[0]!.name).toBe("g.json");
      expect(body.workflows[0]!.scope).toBe("global");
    } finally {
      await cleanup();
    }
  });

  it("project dir is a file (ENOTDIR) but globals exist → 200 global-only list", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      // <cwd>/workflows is a regular file (ENOTDIR when read as a directory).
      writeFileSync(join(cwd, "workflows"), "not a directory");
      writeGlobalWorkflow("g.json");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; scope: string }[] };
      expect(body.workflows).toHaveLength(1);
      expect(body.workflows[0]!.name).toBe("g.json");
      expect(body.workflows[0]!.scope).toBe("global");
    } finally {
      await cleanup();
    }
  });

  it("project dir is unreadable (EACCES) but globals exist → 200 global-only list", async () => {
    if (process.getuid?.() === 0) return; // root bypasses permission checks
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      chmodSync(workflowsDir, 0o000);
      writeGlobalWorkflow("g.json");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; scope: string }[] };
      expect(body.workflows).toHaveLength(1);
      expect(body.workflows[0]!.name).toBe("g.json");
      expect(body.workflows[0]!.scope).toBe("global");
    } finally {
      try { chmodSync(join(cwd, "workflows"), 0o755); } catch { /* ignore */ }
      await cleanup();
    }
  });

  it("project dir is a file (ENOTDIR) and no globals → 400 INVALID_CWD (no recourse)", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      writeFileSync(join(cwd, "workflows"), "not a directory");
      // No global workflows written: globalWorkflowsDir is empty.

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.code).toBe("INVALID_CWD");
    } finally {
      await cleanup();
    }
  });

  it("a global and project workflow sharing a name appear as two scoped items", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "dup.json"), "{}");
      writeGlobalWorkflow("dup.json");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; scope: string }[] };
      const dups = body.workflows.filter((w) => w.name === "dup.json");
      expect(dups).toHaveLength(2);
      expect(dups.map((w) => w.scope).sort()).toEqual(["global", "project"]);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Integration tests — app.request with real temp dirs
// ---------------------------------------------------------------------------

describe("GET /workflows — integration", () => {
  it("happy path: returns documented shape with status 200", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "one.json"), "{}");
      writeFileSync(join(workflowsDir, "two.json"), "{}");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; path: string; scope: string }[] };
      expect(Array.isArray(body.workflows)).toBe(true);
      expect(body.workflows).toHaveLength(2);
      for (const wf of body.workflows) {
        expect(typeof wf.name).toBe("string");
        expect(typeof wf.path).toBe("string");
        expect(wf.name.endsWith(".json")).toBe(true);
        expect(wf.scope).toBe("project");
      }
    } finally {
      await cleanup();
    }
  });

  it("after POST ?scope=global, the new global workflow appears in GET /workflows tagged global", async () => {
    const app = createApiApp(makePartialRm());

    const validWorkflow = {
      id: "wf",
      name: "Workflow",
      description: "Test",
      version: "1",
      steps: [
        { id: "s1", agent: "a", model: "m", mode: "autonomous", description: "d", ide: "opencode", edges: [] },
      ],
    };

    const createRes = await app.request("/workflows?scope=global", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "created-global", workflow: validWorkflow }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json() as { scope: string };
    expect(created.scope).toBe("global");

    const listRes = await app.request("/workflows");
    expect(listRes.status).toBe(200);
    const body = await listRes.json() as { workflows: { name: string; scope: string }[] };
    const entry = body.workflows.find((w) => w.name === "created-global.json");
    expect(entry).toBeDefined();
    expect(entry!.scope).toBe("global");
  });

  it("absent workflows folder returns documented 200 shape with empty list", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: unknown[] };
      expect(body.workflows).toEqual([]);
    } finally {
      await cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// OpenAPI — route registration
// ---------------------------------------------------------------------------

describe("GET /openapi.json includes /workflows", () => {
  it("documents GET /workflows in the OpenAPI spec", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec = await res.json() as Record<string, unknown>;
    const paths = spec.paths as Record<string, unknown>;
    expect(paths["/workflows"]).toBeDefined();
    const workflowsPath = paths["/workflows"] as Record<string, unknown>;
    expect(workflowsPath["get"]).toBeDefined();
  });

  it("GET /workflows has a 200 response with workflows array", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const spec = await res.json() as {
      paths: Record<string, { get?: { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> } }>;
    };
    const schema = spec.paths["/workflows"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema as Record<string, unknown> | undefined;
    expect(schema?.properties).toBeDefined();
    const props = schema?.properties as Record<string, unknown>;
    expect(props["workflows"]).toBeDefined();
  });

  it("GET /workflows has a 400 response documented", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const spec = await res.json() as {
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    };
    expect(spec.paths["/workflows"]?.get?.responses?.["400"]).toBeDefined();
  });
});
