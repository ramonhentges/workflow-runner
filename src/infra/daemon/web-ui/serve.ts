import type { Context } from "hono";

import { WEB_ASSETS } from "./web-assets.generated.js";

/**
 * Minimal surface needed to install the SPA fallback. Both `Hono` and
 * `OpenAPIHono` satisfy this, so callers don't need a cast.
 */
export interface NotFoundRegistrar {
  notFound(handler: (c: Context) => Response | Promise<Response>): unknown;
}

export interface WebAsset {
  /** URL path this asset is served at, e.g. "/index.html" or "/assets/x.js". */
  route: string;
  /** Absolute (or embedded) on-disk path readable via Bun.file. */
  path: string;
  /** Content-Type to serve with. */
  type: string;
}

function serveAsset(asset: WebAsset, immutable: boolean): Response {
  return new Response(Bun.file(asset.path), {
    headers: {
      "Content-Type": asset.type,
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    },
  });
}

function acceptsHtml(accept: string | undefined): boolean {
  return accept === undefined || accept.includes("text/html") || accept.includes("*/*");
}

/**
 * Serve the embedded single-page web UI as a fallback for any request not
 * matched by an API route. Hash-named assets (`/assets/*`) are served by exact
 * path; any other HTML navigation falls back to `index.html` so client-side
 * routing and hard refreshes work. Non-HTML misses keep the plain 404 so HTTP
 * API clients are unaffected.
 *
 * No-op when no UI was embedded (the committed stub), leaving the daemon
 * API-only — e.g. `bun src/index.ts daemon` during development.
 *
 * `assets` is injectable for testing; production uses the generated manifest.
 */
export function registerWebUiRoutes(
  app: NotFoundRegistrar,
  assets: readonly WebAsset[] = WEB_ASSETS,
): void {
  if (assets.length === 0) return;

  const byRoute = new Map<string, WebAsset>(assets.map((a) => [a.route, a]));
  const indexHtml = byRoute.get("/index.html");

  app.notFound((c) => {
    if (c.req.method !== "GET" && c.req.method !== "HEAD") {
      return c.text("404 Not Found", 404);
    }

    // Never serve the SPA for an unmatched API path — API clients must keep
    // getting 404s, not a 200 of index.html.
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) {
      return c.text("404 Not Found", 404);
    }

    const asset = byRoute.get(c.req.path);
    if (asset) {
      return serveAsset(asset, c.req.path.startsWith("/assets/"));
    }

    if (indexHtml && acceptsHtml(c.req.header("Accept"))) {
      return serveAsset(indexHtml, false);
    }

    return c.text("404 Not Found", 404);
  });
}
