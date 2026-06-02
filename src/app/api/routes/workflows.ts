import { createRoute, z } from "@hono/zod-openapi";
import { promises as fsPromises } from "node:fs";
import { join, resolve } from "node:path";
import { WorkflowListSchema, WorkflowsQuerySchema } from "../schema.js";
import type { ApiApp } from "../app.js";

const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const workflowsRoute = createRoute({
  method: "get",
  path: "/workflows",
  request: {
    query: WorkflowsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: WorkflowListSchema } },
      description: "List of *.json workflow files directly under <cwd>/workflows",
    },
    400: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Missing or empty cwd query parameter",
    },
  },
});

export function registerWorkflowsRoute(app: ApiApp): void {
  app.openapi(workflowsRoute, async (c) => {
    const { cwd } = c.req.valid("query");

    if (!cwd) {
      return c.json({ code: "MISSING_CWD", message: "cwd query parameter is required" }, 400);
    }

    const workflowsDir = join(resolve(cwd), "workflows");

    let dirents;
    try {
      dirents = await fsPromises.readdir(workflowsDir, { withFileTypes: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "ENOENT") return c.json({ workflows: [] }, 200);
      if (code === "ENOTDIR" || code === "EACCES") {
        return c.json({ code: "INVALID_CWD", message: `Invalid cwd: ${cwd}` }, 400);
      }
      throw err;
    }

    const workflows = dirents
      .filter((e) => e.isFile() && e.name.endsWith(".json"))
      .map((e) => ({
        name: e.name,
        path: join(workflowsDir, e.name),
      }));

    return c.json({ workflows }, 200);
  });
}
