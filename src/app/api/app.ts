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
import { registerWorkflowCrudRoutes } from "./routes/workflow-crud.js";
import { registerIdeCatalogRoute, type IdeCatalogProbe } from "./routes/ide-catalog.js";
import { hostAllowlistMiddleware, corsMiddleware } from "./security.js";
import { registerWebUiRoutes } from "../../infra/daemon/web-ui/serve.js";

export type ApiApp = OpenAPIHono;

export interface ApiAppOptions {
  ideCatalogProbe?: IdeCatalogProbe;
}

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
  options: ApiAppOptions = {},
  bindHost?: string,
): ApiApp {
  const app = new OpenAPIHono();

  if (port !== undefined) {
    app.use("/*", hostAllowlistMiddleware(port, bindHost));
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
  registerWorkflowCrudRoutes(app, runManager);
  registerIdeCatalogRoute(app, options.ideCatalogProbe);
  registerWsAttachRoute(app, runManager, port, wsRegistry, bindHost);

  return app;
}

/**
 * Composes the full HTTP server: the JSON API mounted under `/api`, plus the
 * embedded single-page web UI served at the root.
 *
 * Mounting the API under `/api` keeps root paths (`/runs/:id`, `/workflows`, …)
 * free for the SPA's client-side routes, so a browser navigation resolves to
 * the web page while `/api/runs/:id` resolves to JSON. The WebSocket attach
 * endpoint becomes `/api/runs/:id/attach` and the OpenAPI doc `/api/openapi.json`.
 *
 * The loopback `Host` allowlist is applied at the root so it also guards the
 * static web routes; it is idempotent, so the copy inside `createApiApp` on
 * `/api/*` is harmless. CORS stays inside `createApiApp` (the only cross-origin
 * surface) to avoid emitting duplicate CORS headers.
 */
export function createServerApp(
  runManager: RunManager,
  port?: number,
  wsRegistry?: WsConnectionRegistry,
  options: ApiAppOptions = {},
  bindHost?: string,
): ApiApp {
  const root = new OpenAPIHono();

  if (port !== undefined) {
    root.use("/*", hostAllowlistMiddleware(port, bindHost));
  }

  const api = createApiApp(runManager, port, wsRegistry, options, bindHost);
  root.route("/api", api);

  // Registered last: serves the embedded SPA (and its assets) for any non-API
  // GET, with an index.html fallback for client-side routes. No-op unless a
  // web UI was embedded at compile time.
  registerWebUiRoutes(root);

  return root;
}
