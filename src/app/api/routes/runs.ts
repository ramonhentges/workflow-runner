import { createRoute, z } from "@hono/zod-openapi";
import { RunSummarySchema } from "../schema.js";
import type { ApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";

const runsRoute = createRoute({
  method: "get",
  path: "/runs",
  request: {
    query: z.object({
      all: z.string().optional(),
      cwd: z.string().optional(),
    }),
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({ runs: z.array(RunSummarySchema) }),
        },
      },
      description: "List of active and recent runs",
    },
  },
});

export function registerRunsRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(runsRoute, (c) => {
    const { all, cwd } = c.req.valid("query");
    const includeOldTerminal = all === "true";

    let snapshots = rm.list({ includeOldTerminal });

    if (cwd !== undefined) {
      snapshots = snapshots.filter((snap) => snap.cwd === cwd);
    }

    const runs = snapshots.map((snap) => {
      let attachedCount = 0;
      try {
        attachedCount = rm.get(snap.id)?.subscribers.size ?? 0;
      } catch {
        // Exact-id lookup can't be ambiguous; swallow any unexpected error.
      }

      return {
        id: snap.id,
        slug: snap.slug,
        workflowPath: snap.workflowPath,
        cwd: snap.cwd,
        worktreePath: snap.worktreePath,
        branch: snap.branch,
        currentStepId: snap.currentStepId,
        status: snap.status,
        startedAt: snap.startedAt,
        endedAt: snap.endedAt,
        attachedCount,
      };
    });

    return c.json({ runs });
  });
}
