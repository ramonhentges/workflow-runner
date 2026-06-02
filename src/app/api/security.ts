import type { MiddlewareHandler } from "hono";

export const DEFAULT_API_PORT = 4517;

/** Returns the set of allowed `Host` header values for a given port. */
export function allowedHosts(port: number): Set<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
}

/**
 * Returns true if the `Origin` header is acceptable for a WebSocket upgrade.
 *
 * Accepted: null/undefined/empty (non-browser / curl), http://127.0.0.1:<port>,
 * http://localhost:<port>, and the value of WORKFLOW_RUNNER_UI_ORIGIN when set.
 * Everything else is rejected.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  port: number,
): boolean {
  if (!origin) return true;
  if (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`
  ) {
    return true;
  }
  const uiOrigin = process.env.WORKFLOW_RUNNER_UI_ORIGIN;
  return !!uiOrigin && origin === uiOrigin;
}

/**
 * Hono middleware enforcing the `Host`-header loopback allowlist.
 * Requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`
 * are rejected with 403.
 */
export function hostAllowlistMiddleware(port: number): MiddlewareHandler {
  const hosts = allowedHosts(port);
  return async (c, next) => {
    const host = c.req.header("Host") ?? "";
    if (!hosts.has(host)) {
      return c.text("Forbidden", 403);
    }
    return next();
  };
}

/**
 * Hono middleware adding CORS response headers for the configured UI origin.
 * Handles OPTIONS preflight (204) and appends Access-Control-Allow-Origin to
 * actual responses when the request Origin matches uiOrigin.
 * Credentials are intentionally not allowed (no Access-Control-Allow-Credentials).
 */
export function corsMiddleware(uiOrigin: string): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("Origin");

    if (c.req.method === "OPTIONS" && origin === uiOrigin) {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": uiOrigin,
          "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Vary": "Origin",
        },
      });
    }

    await next();

    if (origin === uiOrigin && c.res) {
      // Create a new Response to allow header mutation (guards against frozen headers).
      c.res = new Response(c.res.body, c.res);
      c.res.headers.set("Access-Control-Allow-Origin", uiOrigin);
      c.res.headers.set("Vary", "Origin");
    }
  };
}
