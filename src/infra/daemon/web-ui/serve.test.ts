import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";

import { registerWebUiRoutes, type WebAsset } from "./serve.js";

describe("registerWebUiRoutes", () => {
  let dir: string;
  let assets: WebAsset[];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "wfr-webui-"));
    const indexPath = join(dir, "index.html");
    const jsPath = join(dir, "app.js");
    writeFileSync(indexPath, "<!doctype html><title>UI</title>", "utf8");
    writeFileSync(jsPath, "console.log('hi')", "utf8");
    assets = [
      { route: "/index.html", path: indexPath, type: "text/html; charset=utf-8" },
      { route: "/assets/app.js", path: jsPath, type: "text/javascript; charset=utf-8" },
    ];
  });

  afterAll(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  });

  function appWith(a: readonly WebAsset[]): Hono {
    const app = new Hono();
    app.get("/health", (c) => c.json({ status: "ok" }));
    registerWebUiRoutes(app, a);
    return app;
  }

  it("does not override API routes", async () => {
    const res = await appWith(assets).request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("serves a hash-named asset by exact path with an immutable cache header", async () => {
    const res = await appWith(assets).request("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/javascript");
    expect(res.headers.get("Cache-Control")).toContain("immutable");
    expect(await res.text()).toContain("console.log");
  });

  it("falls back to index.html for an HTML navigation (SPA route)", async () => {
    const res = await appWith(assets).request("/runs/abc", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("Cache-Control")).toBe("no-cache");
    expect(await res.text()).toContain("<title>UI</title>");
  });

  it("never serves the SPA for an unmatched /api path, even with Accept: text/html", async () => {
    const res = await appWith(assets).request("/api/runs/abc", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type") ?? "").not.toContain("text/html");
  });

  it("returns a plain 404 for a non-HTML miss (API client)", async () => {
    const res = await appWith(assets).request("/api/unknown", {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(404);
  });

  it("is a no-op when no assets were embedded (stub)", async () => {
    const res = await appWith([]).request("/runs/abc", {
      headers: { Accept: "text/html" },
    });
    expect(res.status).toBe(404);
  });
});
