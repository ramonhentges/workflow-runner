import { createRoute, z } from "@hono/zod-openapi";
import { RunDetailSchema } from "../schema.js";
import type { ApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";
import { RunManagerError } from "../../../infra/daemon/run-manager.js";
import { RpcErrorCode } from "../../../infra/daemon/protocol.js";

const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

const AmbiguousErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  candidates: z.array(z.string()),
});

const runDetailRoute = createRoute({
  method: "get",
  path: "/runs/:id",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: RunDetailSchema } },
      description: "Run detail snapshot",
    },
    404: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Unknown run",
    },
    409: {
      content: { "application/json": { schema: AmbiguousErrorSchema } },
      description: "Ambiguous slug prefix — candidates included in response",
    },
  },
});

export function registerRunDetailRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(runDetailRoute, (c) => {
    const { id } = c.req.valid("param");

    let active;
    try {
      active = rm.get(id);
    } catch (err) {
      if (err instanceof RunManagerError && err.code === RpcErrorCode.AMBIGUOUS_PREFIX) {
        const data = err.data as { candidates: string[] } | undefined;
        return c.json(
          { code: "AMBIGUOUS_PREFIX", message: err.message, candidates: data?.candidates ?? [] },
          409,
        );
      }
      throw err;
    }

    if (!active) {
      return c.json({ code: "UNKNOWN_RUN", message: `Unknown run: ${id}` }, 404);
    }

    const snap = active.run.snapshot();
    return c.json(
      {
        id: snap.id,
        slug: snap.slug,
        workflowPath: snap.workflowPath,
        cwd: snap.cwd,
        worktreePath: snap.worktreePath,
        branch: snap.branch,
        status: snap.status,
        currentStepId: snap.currentStepId,
        visitedStepIds: snap.visitedStepIds,
        startedAt: snap.startedAt,
        endedAt: snap.endedAt,
        attachedCount: active.subscribers.size,
      },
      200,
    );
  });
}
