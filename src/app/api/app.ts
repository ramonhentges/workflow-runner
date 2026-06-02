import { OpenAPIHono } from "@hono/zod-openapi";
import type { RunManager } from "../../infra/daemon/run-manager.js";
import { registerHealthRoute } from "./routes/health.js";
import { registerRunsRoute } from "./routes/runs.js";
import { registerRunDetailRoute } from "./routes/run-detail.js";
import { registerStartRunRoute } from "./routes/start-run.js";
import { registerStopRunRoute } from "./routes/stop-run.js";
import { registerRetryStepRoute } from "./routes/retry-step.js";
import { registerRunEventsRoute } from "./routes/run-events.js";
import { registerWsAttachRoute, type WsConnectionRegistry } from "./routes/ws-attach.js";
import { registerWorkflowsRoute } from "./routes/workflows.js";
import { hostAllowlistMiddleware, corsMiddleware } from "./security.js";

export type ApiApp = OpenAPIHono;

/**
 * Creates the Hono OpenAPI app harness.
 *
 * No port binding here (Task 13 mounts via Bun.serve). Unit-testable via
 * `app.request()`. Route tasks register their routes on the returned app
 * using `app.openapi(route, handler)` with `rm` in their closure.
 *
 * When `port` is provided the `Host`-header loopback allowlist middleware is
 * applied to all routes (required for production; omit only in unit tests that
 * do not exercise security behaviour).
 *
 * When `wsRegistry` is provided it is forwarded to `registerWsAttachRoute` so
 * the daemon can drain open WebSocket connections on graceful shutdown.
 */
export function createApiApp(
  runManager: RunManager,
  port?: number,
  wsRegistry?: WsConnectionRegistry,
): ApiApp {
  const app = new OpenAPIHono();

  if (port !== undefined) {
    app.use("/*", hostAllowlistMiddleware(port));
    const uiOrigin = process.env.WORKFLOW_RUNNER_UI_ORIGIN;
    if (uiOrigin) {
      app.use("/*", corsMiddleware(uiOrigin));
    }
  }

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Workflow Runner API",
      version: "0.1.0",
      description: "HTTP API for the workflow-runner daemon",
    },
  });

  registerHealthRoute(app, runManager);
  registerRunsRoute(app, runManager);
  registerRunDetailRoute(app, runManager);
  registerStartRunRoute(app, runManager);
  registerStopRunRoute(app, runManager);
  registerRetryStepRoute(app, runManager);
  registerRunEventsRoute(app, runManager);
  registerWorkflowsRoute(app);
  registerWsAttachRoute(app, runManager, port, wsRegistry);

  return app;
}
