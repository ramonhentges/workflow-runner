import { createRoute, z } from "@hono/zod-openapi";
import { RunStatusSchema } from "../schema.js";
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

const StopRunResponseSchema = z.object({
  finalStatus: RunStatusSchema,
});

const stopRunRoute = createRoute({
  method: "post",
  path: "/runs/:id/stop",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: StopRunResponseSchema } },
      description: "Run stopped (or was already terminal)",
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

export function registerStopRunRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(stopRunRoute, async (c) => {
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

    const runId = active.run.snapshot().id;

    try {
      await rm.stop(runId);
    } catch (err) {
      if (err instanceof RunManagerError) {
        return c.json({ code: "UNKNOWN_RUN", message: err.message }, 404);
      }
      throw err;
    }

    return c.json({ finalStatus: active.run.snapshot().status }, 200);
  });
}
