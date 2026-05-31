import { createRoute, z } from "@hono/zod-openapi";
import type { ApiApp } from "../app.js";
import type { RunManager } from "../../../infra/daemon/run-manager.js";
import { RunManagerError } from "../../../infra/daemon/run-manager.js";
import { RpcErrorCode } from "../../../infra/daemon/protocol.js";

const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});

// AMBIGUOUS_PREFIX carries candidates; RUN_NOT_RETRY_ELIGIBLE does not — candidates is optional.
const ConflictErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  candidates: z.array(z.string()).optional(),
});

const RetryStepResponseSchema = z.object({
  resumedStepId: z.string(),
});

const retryStepRoute = createRoute({
  method: "post",
  path: "/runs/:id/retry-step",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: RetryStepResponseSchema } },
      description: "Step retry started; resumedStepId is the step being re-run",
    },
    404: {
      content: { "application/json": { schema: ApiErrorSchema } },
      description: "Unknown run",
    },
    409: {
      content: { "application/json": { schema: ConflictErrorSchema } },
      description: "Run not retry-eligible, or ambiguous slug prefix",
    },
  },
});

export function registerRetryStepRoute(app: ApiApp, rm: RunManager): void {
  app.openapi(retryStepRoute, async (c) => {
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

    // Capture the failing step id before calling retryStep; it becomes the resumed step.
    // retryStep() throws if currentStepId is null, so the non-null assertion is safe
    // on the success path.
    const snap = active.run.snapshot();
    const resumedStepId = snap.currentStepId!;
    const runId = snap.id;

    try {
      await rm.retryStep(runId);
    } catch (err) {
      if (err instanceof RunManagerError) {
        if (err.code === RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE) {
          return c.json({ code: "RUN_NOT_RETRY_ELIGIBLE", message: err.message }, 409);
        }
        return c.json({ code: "UNKNOWN_RUN", message: err.message }, 404);
      }
      throw err;
    }

    return c.json({ resumedStepId }, 200);
  });
}
