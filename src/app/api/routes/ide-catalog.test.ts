import { describe, expect, it } from "bun:test";
import { OpenAPIHono } from "@hono/zod-openapi";
import { createApiApp } from "../app.js";
import { registerIdeCatalogRoute, type IdeCatalogProbe } from "./ide-catalog.js";
import { UnknownIdeError } from "../../../infra/acp/ide-profile.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";

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

function makeRouteApp(probe: IdeCatalogProbe) {
  const app = new OpenAPIHono();
  registerIdeCatalogRoute(app, probe);
  return app;
}

describe("GET /ide/:ide/catalog — unit route behavior", () => {
  it("returns 200 with agents and models when the stubbed probe is reachable", async () => {
    const app = makeRouteApp(async () => ({
      reachable: true,
      agents: [{ id: "plan", name: "Plan" }],
      models: [{ id: "opencode/sonic", name: "Sonic" }],
    }));

    const res = await app.request("/ide/opencode/catalog?cwd=/tmp/project");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reachable: true,
      agents: [{ id: "plan", name: "Plan" }],
      models: [{ id: "opencode/sonic", name: "Sonic" }],
    });
  });

  it("returns 200 with reason when the stubbed probe is unreachable", async () => {
    const app = makeRouteApp(async () => ({
      reachable: false,
      agents: [],
      models: [],
      reason: "spawn ENOENT",
    }));

    const res = await app.request("/ide/opencode/catalog?cwd=/tmp/project");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reachable: false,
      agents: [],
      models: [],
      reason: "spawn ENOENT",
    });
  });

  it("returns 400 UNKNOWN_IDE when the probe throws UnknownIdeError", async () => {
    const app = makeRouteApp(async (ide) => {
      throw new UnknownIdeError(`Unknown IDE: '${ide}'`);
    });

    const res = await app.request("/ide/ghost/catalog?cwd=/tmp/project");

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("UNKNOWN_IDE");
    expect(body.message).toContain("ghost");
  });

  it("returns 400 MISSING_CWD and does not call the probe when cwd is missing", async () => {
    let calls = 0;
    const app = makeRouteApp(async () => {
      calls += 1;
      return { reachable: true, agents: [], models: [] };
    });

    const res = await app.request("/ide/opencode/catalog");

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("MISSING_CWD");
    expect(calls).toBe(0);
  });

  it("returns 400 MISSING_CWD when cwd is empty", async () => {
    const app = makeRouteApp(async () => ({ reachable: true, agents: [], models: [] }));

    const res = await app.request("/ide/opencode/catalog?cwd=");

    expect(res.status).toBe(400);
    const body = await res.json() as Record<string, unknown>;
    expect(body.code).toBe("MISSING_CWD");
  });
});

describe("GET /ide/:ide/catalog — createApiApp integration", () => {
  it("uses the injected catalog probe through app.request", async () => {
    const app = createApiApp(makePartialRm(), undefined, undefined, {
      ideCatalogProbe: async (ide, cwd) => ({
        reachable: true,
        agents: [{ id: `${ide}-agent`, name: cwd }],
        models: [{ id: "model-1", name: "Model 1" }],
      }),
    });

    const res = await app.request("/ide/opencode/catalog?cwd=/tmp/x");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reachable: true,
      agents: [{ id: "opencode-agent", name: "/tmp/x" }],
      models: [{ id: "model-1", name: "Model 1" }],
    });
  });
});
