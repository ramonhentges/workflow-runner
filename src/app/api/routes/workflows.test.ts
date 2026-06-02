import { describe, it, expect, afterEach } from "bun:test";
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

// ---------------------------------------------------------------------------
// Unit tests — GET /workflows
// ---------------------------------------------------------------------------

describe("GET /workflows — unit", () => {
  it("returns 400 when cwd query is missing", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows");
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("MISSING_CWD");
    expect(typeof body.message).toBe("string");
  });

  it("returns 400 when cwd is empty string", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows?cwd=");
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("MISSING_CWD");
  });

  it("returns 200 with empty list when workflows/ folder is absent", async () => {
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

  it("returns absolute paths for each workflow", async () => {
    const { cwd, cleanup } = makeTempCwd();
    try {
      const workflowsDir = join(cwd, "workflows");
      mkdirSync(workflowsDir);
      writeFileSync(join(workflowsDir, "a.json"), "{}");

      const app = createApiApp(makePartialRm());
      const res = await app.request(`/workflows?cwd=${encodeURIComponent(cwd)}`);
      expect(res.status).toBe(200);
      const body = await res.json() as { workflows: { name: string; path: string }[] };
      expect(body.workflows).toHaveLength(1);
      const wf = body.workflows[0]!;
      expect(wf.name).toBe("a.json");
      expect(wf.path).toBe(join(workflowsDir, "a.json"));
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

  it("each workflow entry has name and path fields", async () => {
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
      const body = await res.json() as { workflows: { name: string; path: string }[] };
      expect(Array.isArray(body.workflows)).toBe(true);
      expect(body.workflows).toHaveLength(2);
      for (const wf of body.workflows) {
        expect(typeof wf.name).toBe("string");
        expect(typeof wf.path).toBe("string");
        expect(wf.name.endsWith(".json")).toBe(true);
      }
    } finally {
      await cleanup();
    }
  });

  it("missing cwd returns documented 400 shape", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/workflows");
    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(typeof body.code).toBe("string");
    expect(typeof body.message).toBe("string");
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
