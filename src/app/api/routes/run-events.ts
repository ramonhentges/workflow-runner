import { createRoute, z } from "@hono/zod-openapi";
import { EventsPageSchema, EventsQuerySchema } from "../schema.js";
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

const runEventsRoute = createRoute({
  method: "get",
  path: "/runs/:id/events",
  request: {
    params: z.object({ id: z.string() }),
    query: EventsQuerySchema,
  },
  responses: {
    200: {
      content: { "application/json": { schema: EventsPageSchema } },
      description: "Historical events page",
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

export function registerRunEventsRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(runEventsRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { fromSeq, stepId } = c.req.valid("query");

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

    const runId = active.run.snapshot().id;

    // Mirror run-attach.ts: terminal runs have active.eventLog === null.
    // Open an owned handle that must be closed when done; running runs share the runner's handle.
    const ownedEventLog = !active.eventLog
      ? await rm.openEventLog(runId).catch(() => null)
      : null;
    const eventLog = active.eventLog ?? ownedEventLog;

    try {
      if (!eventLog) {
        return c.json({ entries: [], truncated: false }, 200);
      }

      const { entries, truncated } = await eventLog.readEventsSince(fromSeq ?? 0);
      const filtered =
        stepId !== undefined ? entries.filter((e) => e.stepId === stepId) : entries;

      return c.json({ entries: filtered, truncated }, 200);
    } finally {
      if (ownedEventLog) {
        ownedEventLog.close().catch(() => {});
      }
    }
  });
}
