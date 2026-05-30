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
 * http://localhost:<port>.  Everything else is rejected.
 */
export function isOriginAllowed(
  origin: string | null | undefined,
  port: number,
): boolean {
  if (!origin) return true;
  return (
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}`
  );
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
