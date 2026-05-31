import { createRoute } from "@hono/zod-openapi";
import { HealthReportSchema } from "../schema.js";
import type { ApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";
import pkg from "../../../../package.json" with { type: "json" };

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

const VERSION: string = typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : "0.0.0";

export function registerHealthRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(healthRoute, async (c) => {
    const activeRuns = rm.list().filter((s) => s.status === "running").length;
    return c.json({
      status: "ok" as const,
      pid: process.pid,
      uptimeMs: process.uptime() * 1000,
      activeRuns,
      version: VERSION,
    });
  });
}
