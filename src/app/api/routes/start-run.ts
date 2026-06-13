import { createRoute, z } from "@hono/zod-openapi";
import { StartRunRequestSchema } from "../schema.js";
import { mapError } from "../error-map.js";
import type { ApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";

const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const StartRunResponseSchema = z.object({
  runId: z.string(),
  slug: z.string(),
});

const startRunRoute = createRoute({
  method: "post",
  path: "/runs",
  request: {
    body: {
      content: {
        "application/json": {
          schema: StartRunRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    201: {
      content: {
        "application/json": {
          schema: StartRunResponseSchema,
        },
      },
      description: "Run started",
    },
    400: {
      content: {
        "application/json": {
          schema: ApiErrorSchema,
        },
      },
      description: "Invalid request body or workflow",
    },
    429: {
      content: {
        "application/json": {
          schema: ApiErrorSchema,
        },
      },
      description: "Run limit reached",
    },
  },
});

export function registerStartRunRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(startRunRoute, async (c) => {
    const { workflowPath, cwd, branch, initialPrompt } = c.req.valid("json");

    try {
      const result = await rm.startRun(workflowPath, cwd, branch, initialPrompt);
      return c.json({ runId: result.runId, slug: result.slug }, 201);
    } catch (err) {
      const { status, code, message } = mapError(err);
      return c.json({ code, message }, status as 400 | 429);
    }
  });
}
