import { createRoute } from "@hono/zod-openapi";
import { HealthReportSchema } from "../schema.js";
import type { ApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: HealthReportSchema,
        },
      },
      description: "Daemon liveness snapshot",
    },
  },
});

async function readVersion(): Promise<string> {
  try {
    const url = new URL("../../../../package.json", import.meta.url);
    const pkg = (await Bun.file(url).json()) as { version?: unknown };
    if (typeof pkg.version === "string" && pkg.version.length > 0) return pkg.version;
  } catch {
    // fall through
  }
  return "0.0.0";
}

export function registerHealthRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(healthRoute, async (c) => {
    const activeRuns = rm.list().filter((s) => s.status === "running").length;
    const version = await readVersion();
    return c.json({
      status: "ok" as const,
      pid: process.pid,
      uptimeMs: process.uptime() * 1000,
      activeRuns,
      version,
    });
  });
}
