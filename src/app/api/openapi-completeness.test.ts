/**
 * Task 15: Documentation and OpenAPI completeness tests.
 *
 * Unit tests: verify docs/ws-protocol.md and README content.
 * Integration test: verify /openapi.json lists every V1 HTTP endpoint and
 *   references shared schema components.
 */

import { describe, it, expect } from "bun:test";
import type { RunManager } from "../../infra/daemon/run-manager.js";
import { createApiApp } from "./app.js";

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

async function readTextFile(relativeFromSrc: string): Promise<string> {
  const url = new URL(relativeFromSrc, import.meta.url);
  return Bun.file(url).text();
}

// ---------------------------------------------------------------------------
// 15.1 – docs/ws-protocol.md content
// ---------------------------------------------------------------------------

describe("docs/ws-protocol.md", () => {
  it("file exists", async () => {
    const url = new URL("../../../docs/ws-protocol.md", import.meta.url);
    const file = Bun.file(url);
    expect(await file.exists()).toBe(true);
  });

  it("documents every AttachFrame variant (snapshot, backlog, event, status, error)", async () => {
    const content = await readTextFile("../../../docs/ws-protocol.md");
    for (const variant of ["snapshot", "backlog", "event", "status", "error"]) {
      expect(content).toContain(variant);
    }
  });

  it("documents the client→server input frame", async () => {
    const content = await readTextFile("../../../docs/ws-protocol.md");
    expect(content).toContain("input");
    expect(content).toContain("message");
  });

  it("documents fromSeq resume semantics", async () => {
    const content = await readTextFile("../../../docs/ws-protocol.md");
    expect(content).toContain("fromSeq");
  });

  it("documents the truncated / backlog behavior", async () => {
    const content = await readTextFile("../../../docs/ws-protocol.md");
    expect(content).toContain("truncated");
  });

  it("documents WebSocket close codes", async () => {
    const content = await readTextFile("../../../docs/ws-protocol.md");
    // Standard close codes that must be present.
    expect(content).toContain("1000");
    expect(content).toContain("1001");
  });
});

// ---------------------------------------------------------------------------
// 15.2 – README HTTP/WS API section
// ---------------------------------------------------------------------------

describe("README.md — HTTP/WS API section", () => {
  it("names the default port 4517", async () => {
    const content = await readTextFile("../../../README.md");
    expect(content).toContain("4517");
  });

  it("mentions the daemon.json discovery file", async () => {
    const content = await readTextFile("../../../README.md");
    expect(content).toContain("daemon.json");
  });

  it("lists the HTTP endpoints surface", async () => {
    const content = await readTextFile("../../../README.md");
    for (const path of ["/health", "/runs", "/runs/:id/events", "/openapi.json"]) {
      expect(content).toContain(path);
    }
  });

  it("mentions the WS attach endpoint", async () => {
    const content = await readTextFile("../../../README.md");
    expect(content).toContain("/runs/:id/attach");
  });
});

// ---------------------------------------------------------------------------
// 15.3 – OpenAPI completeness (in-process integration test)
// ---------------------------------------------------------------------------

describe("GET /openapi.json — V1 endpoint completeness", () => {
  it("returns 200 with openapi 3.0 document", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.openapi).toBe("3.0.0");
  });

  it("lists every V1 HTTP path (health, runs, runs/:id, start, stop, retry-step, events, workflows CRUD, IDE catalog)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as { paths: Record<string, unknown> };
    const paths = json.paths;

    // Note: @hono/zod-openapi uses Hono :param syntax, not OpenAPI {param} syntax.
    const expectedPaths = [
      "/health",
      "/runs",
      "/runs/:id",
      "/runs/:id/stop",
      "/runs/:id/retry-step",
      "/runs/:id/events",
      "/workflows",
      "/workflows/:name",
      "/ide/:ide/catalog",
    ];
    for (const p of expectedPaths) {
      expect(paths[p]).toBeDefined();
    }
  });

  it("GET /workflows/:name has a 200 response (read-one)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/workflows/:name"]?.get?.responses?.["200"]).toBeDefined();
  });

  it("POST /workflows has a 201 response (create workflow)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/workflows"]?.post?.responses?.["201"]).toBeDefined();
  });

  it("PUT /workflows/:name has a 200 response (update workflow)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { put?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/workflows/:name"]?.put?.responses?.["200"]).toBeDefined();
  });

  it("DELETE /workflows/:name has a 200 response (delete workflow)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { delete?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/workflows/:name"]?.delete?.responses?.["200"]).toBeDefined();
  });

  it("GET /ide/:ide/catalog has 200 and 400 responses", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/ide/:ide/catalog"]?.get?.responses?.["200"]).toBeDefined();
    expect(json.paths["/ide/:ide/catalog"]?.get?.responses?.["400"]).toBeDefined();
  });

  it("GET /health path has a 200 response", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/health"]?.get?.responses?.["200"]).toBeDefined();
  });

  it("POST /runs path has a 201 response (start run)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { post?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/runs"]?.post?.responses?.["201"]).toBeDefined();
  });

  it("GET /runs/:id/events path has a 200 response", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<string, { get?: { responses?: Record<string, unknown> } }>;
    };
    expect(json.paths["/runs/:id/events"]?.get?.responses?.["200"]).toBeDefined();
  });

  it("route responses include inline schema definitions (shared schema shapes are present)", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");
    const json = (await res.json()) as {
      paths: Record<
        string,
        {
          get?: { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> };
          post?: { responses?: Record<string, { content?: Record<string, { schema?: unknown }> }> };
        }
      >;
    };

    // /health GET 200 must have an inline schema with status, pid, uptimeMs fields.
    const healthSchema = json.paths["/health"]?.get?.responses?.["200"]?.content?.[
      "application/json"
    ]?.schema as Record<string, unknown> | undefined;
    expect(healthSchema?.properties).toBeDefined();
    expect((healthSchema?.properties as Record<string, unknown>)?.["status"]).toBeDefined();
    expect((healthSchema?.properties as Record<string, unknown>)?.["pid"]).toBeDefined();

    // /runs GET 200 must have an inline schema with a runs array.
    const runsSchema = json.paths["/runs"]?.get?.responses?.["200"]?.content?.[
      "application/json"
    ]?.schema as Record<string, unknown> | undefined;
    expect(runsSchema?.properties).toBeDefined();
    expect((runsSchema?.properties as Record<string, unknown>)?.["runs"]).toBeDefined();

    // /runs/:id/events GET 200 must have an inline schema with entries and truncated.
    const eventsSchema = json.paths["/runs/:id/events"]?.get?.responses?.["200"]?.content?.[
      "application/json"
    ]?.schema as Record<string, unknown> | undefined;
    expect(eventsSchema?.properties).toBeDefined();
    const eventsProps = eventsSchema?.properties as Record<string, unknown> | undefined;
    expect(eventsProps?.["entries"]).toBeDefined();
    expect(eventsProps?.["truncated"]).toBeDefined();
  });
});
