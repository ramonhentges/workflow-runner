import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  DEFAULT_API_PORT,
  allowedHosts,
  isOriginAllowed,
  hostAllowlistMiddleware,
} from "./security.js";
import { createApiApp } from "./app.js";
import type { RunManager } from "../../infra/daemon/run-manager.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePartialRm(): RunManager {
  return {
    list: () => [],
    get: () => undefined,
    startRun: async () => { throw new Error("not implemented"); },
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

/** Build a minimal Hono app with the middleware + one test route. */
function makeTestApp(port: number) {
  const app = new Hono();
  app.use("/*", hostAllowlistMiddleware(port));
  app.get("/test", (c) => c.text("ok"));
  return app;
}

// ---------------------------------------------------------------------------
// allowedHosts
// ---------------------------------------------------------------------------

describe("allowedHosts", () => {
  it("contains 127.0.0.1:<port> and localhost:<port>", () => {
    const hosts = allowedHosts(4517);
    expect(hosts.has("127.0.0.1:4517")).toBe(true);
    expect(hosts.has("localhost:4517")).toBe(true);
    expect(hosts.size).toBe(2);
  });

  it("tracks a non-default port", () => {
    const hosts = allowedHosts(8080);
    expect(hosts.has("127.0.0.1:8080")).toBe(true);
    expect(hosts.has("localhost:8080")).toBe(true);
    expect(hosts.has("127.0.0.1:4517")).toBe(false);
    expect(hosts.has("localhost:4517")).toBe(false);
  });

  it("does not include hosts without port numbers", () => {
    const hosts = allowedHosts(4517);
    expect(hosts.has("localhost")).toBe(false);
    expect(hosts.has("127.0.0.1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isOriginAllowed
// ---------------------------------------------------------------------------

describe("isOriginAllowed", () => {
  it("accepts null (non-browser / curl)", () => {
    expect(isOriginAllowed(null, DEFAULT_API_PORT)).toBe(true);
  });

  it("accepts undefined", () => {
    expect(isOriginAllowed(undefined, DEFAULT_API_PORT)).toBe(true);
  });

  it("accepts empty string", () => {
    expect(isOriginAllowed("", DEFAULT_API_PORT)).toBe(true);
  });

  it("accepts http://127.0.0.1:<port>", () => {
    expect(isOriginAllowed(`http://127.0.0.1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(true);
  });

  it("accepts http://localhost:<port>", () => {
    expect(isOriginAllowed(`http://localhost:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(true);
  });

  it("rejects http://evil.com", () => {
    expect(isOriginAllowed("http://evil.com", DEFAULT_API_PORT)).toBe(false);
  });

  it("rejects http://evil.com:<port> (port squatting)", () => {
    expect(isOriginAllowed(`http://evil.com:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(false);
  });

  it("rejects https://localhost:<port> (wrong scheme)", () => {
    expect(isOriginAllowed(`https://localhost:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(false);
  });

  it("rejects the default port when port is overridden to 8080", () => {
    expect(isOriginAllowed(`http://localhost:${DEFAULT_API_PORT}`, 8080)).toBe(false);
  });

  it("accepts the overridden port", () => {
    expect(isOriginAllowed("http://localhost:8080", 8080)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:8080", 8080)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hostAllowlistMiddleware — unit tests via plain Hono app
// ---------------------------------------------------------------------------

describe("hostAllowlistMiddleware", () => {
  it("allows Host: 127.0.0.1:<port>", async () => {
    const app = makeTestApp(4517);
    const res = await app.request(
      new Request("http://127.0.0.1:4517/test", {
        headers: { Host: "127.0.0.1:4517" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("allows Host: localhost:<port>", async () => {
    const app = makeTestApp(4517);
    const res = await app.request(
      new Request("http://localhost:4517/test", {
        headers: { Host: "localhost:4517" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects Host: evil.com with 403", async () => {
    const app = makeTestApp(4517);
    const res = await app.request(
      new Request("http://localhost:4517/test", {
        headers: { Host: "evil.com" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects Host: localhost (no port) with 403", async () => {
    const app = makeTestApp(4517);
    const res = await app.request(
      new Request("http://localhost:4517/test", {
        headers: { Host: "localhost" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects the default port when the app uses an overridden port", async () => {
    const app = makeTestApp(8080);
    const res = await app.request(
      new Request("http://localhost:8080/test", {
        headers: { Host: "localhost:4517" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("accepts the overridden port when the app uses an overridden port", async () => {
    const app = makeTestApp(8080);
    const res = await app.request(
      new Request("http://localhost:8080/test", {
        headers: { Host: "localhost:8080" },
      }),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DNS-rebinding falsification tests (BUILD-FAILING)
//
// These tests MUST fail the build if the Host/Origin security controls are
// regressed.  They prove that a confused-deputy / CSRF attempt is rejected.
// ---------------------------------------------------------------------------

describe("[SECURITY] DNS-rebinding falsification — createApiApp with port", () => {
  it("Host: evil.com → 403 (DNS-rebind attempt blocked)", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: "evil.com" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("Host: attacker.internal → 403", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: "attacker.internal" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("Host: 127.0.0.1:<port> → passes (loopback allowed)", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://127.0.0.1:${DEFAULT_API_PORT}/health`, {
        headers: { Host: `127.0.0.1:${DEFAULT_API_PORT}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("Host: localhost:<port> → passes (loopback allowed)", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: `localhost:${DEFAULT_API_PORT}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("Origin: http://evil.com → rejected by isOriginAllowed predicate (WS upgrade guard)", () => {
    expect(isOriginAllowed("http://evil.com", DEFAULT_API_PORT)).toBe(false);
  });

  it("Origin: http://evil.com:<port> → rejected (port squatting)", () => {
    expect(isOriginAllowed(`http://evil.com:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(false);
  });

  it("Origin: null → allowed (non-browser WS client)", () => {
    expect(isOriginAllowed(null, DEFAULT_API_PORT)).toBe(true);
  });

  it("Origin: http://localhost:<port> → allowed (loopback WS upgrade)", () => {
    expect(isOriginAllowed(`http://localhost:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(true);
  });

  it("Origin: http://127.0.0.1:<port> → allowed (loopback WS upgrade)", () => {
    expect(isOriginAllowed(`http://127.0.0.1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration — Host allowlist covers all registered routes
// ---------------------------------------------------------------------------

describe("Host allowlist integration — all routes protected", () => {
  it("blocks /health, /runs, and /openapi.json with a foreign Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const paths = ["/health", "/runs", "/openapi.json"];
    for (const path of paths) {
      const res = await app.request(
        new Request(`http://localhost:${DEFAULT_API_PORT}${path}`, {
          headers: { Host: "attacker.local" },
        }),
      );
      expect(res.status).toBe(403);
    }
  });

  it("allows /health and /runs for a correct loopback Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const paths = ["/health", "/runs"];
    for (const path of paths) {
      const res = await app.request(
        new Request(`http://localhost:${DEFAULT_API_PORT}${path}`, {
          headers: { Host: `localhost:${DEFAULT_API_PORT}` },
        }),
      );
      expect(res.status).not.toBe(403);
    }
  });

  it("port override: localhost:4517 is blocked when app uses port 9000", async () => {
    const app = createApiApp(makePartialRm(), 9000);
    const res = await app.request(
      new Request("http://localhost:4517/health", {
        headers: { Host: "localhost:4517" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("port override: localhost:9000 is allowed when app uses port 9000", async () => {
    const app = createApiApp(makePartialRm(), 9000);
    const res = await app.request(
      new Request("http://localhost:9000/health", {
        headers: { Host: "localhost:9000" },
      }),
    );
    expect(res.status).toBe(200);
  });
});
