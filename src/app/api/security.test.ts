import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  DEFAULT_API_PORT,
  allowedHosts,
  corsMiddleware,
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
function makeTestApp(port: number, bindHost?: string) {
  const app = new Hono();
  app.use("/*", hostAllowlistMiddleware(port, bindHost));
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

describe("allowedHosts with bindHost", () => {
  it("without bindHost returns loopback-only set (existing behavior)", () => {
    const hosts = allowedHosts(4517);
    expect(hosts.has("127.0.0.1:4517")).toBe(true);
    expect(hosts.has("localhost:4517")).toBe(true);
    expect(hosts.size).toBe(2);
  });

  it("bindHost='0.0.0.0' returns an empty set (accept all)", () => {
    const hosts = allowedHosts(4517, "0.0.0.0");
    expect(hosts.size).toBe(0);
  });

  it("bindHost='192.168.1.100' includes that IP plus loopbacks", () => {
    const hosts = allowedHosts(4517, "192.168.1.100");
    expect(hosts.has("127.0.0.1:4517")).toBe(true);
    expect(hosts.has("localhost:4517")).toBe(true);
    expect(hosts.has("192.168.1.100:4517")).toBe(true);
    expect(hosts.size).toBe(3);
  });

  it("bindHost='192.168.1.100' excludes non-loopback, non-matching IPs", () => {
    const hosts = allowedHosts(4517, "192.168.1.100");
    expect(hosts.has("10.0.0.1:4517")).toBe(false);
    expect(hosts.has("evil.com:4517")).toBe(false);
  });

  it("bindHost='127.0.0.1' (explicit) returns loopback-only set", () => {
    const hosts = allowedHosts(4517, "127.0.0.1");
    expect(hosts.has("127.0.0.1:4517")).toBe(true);
    expect(hosts.has("localhost:4517")).toBe(true);
    expect(hosts.size).toBe(2);
  });

  it("bindHost='::' (IPv6 all-interfaces) returns an empty set (accept all)", () => {
    const hosts = allowedHosts(4517, "::");
    expect(hosts.size).toBe(0);
  });

  it("bindHost='::1' (IPv6 loopback) includes bracket-notation host plus IPv4 loopbacks", () => {
    const hosts = allowedHosts(4517, "::1");
    expect(hosts.has("127.0.0.1:4517")).toBe(true);
    expect(hosts.has("localhost:4517")).toBe(true);
    expect(hosts.has("[::1]:4517")).toBe(true);
    expect(hosts.size).toBe(3);
  });

  it("bindHost='fe80::1' (IPv6 link-local) includes bracket-notation host plus loopbacks", () => {
    const hosts = allowedHosts(4517, "fe80::1");
    expect(hosts.has("127.0.0.1:4517")).toBe(true);
    expect(hosts.has("localhost:4517")).toBe(true);
    expect(hosts.has("[fe80::1]:4517")).toBe(true);
    expect(hosts.size).toBe(3);
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
// hostAllowlistMiddleware — bindHost parameter
// ---------------------------------------------------------------------------

describe("hostAllowlistMiddleware with bindHost", () => {
  it("bindHost='0.0.0.0' accepts any Host header", async () => {
    const app = makeTestApp(4517, "0.0.0.0");
    const res = await app.request(
      new Request("http://evil.com:4517/test", {
        headers: { Host: "evil.com:4517" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='192.168.1.100' accepts that Host and loopbacks", async () => {
    const app = makeTestApp(4517, "192.168.1.100");

    const resLoopback = await app.request(
      new Request("http://127.0.0.1:4517/test", {
        headers: { Host: "127.0.0.1:4517" },
      }),
    );
    expect(resLoopback.status).toBe(200);

    const resLocalhost = await app.request(
      new Request("http://localhost:4517/test", {
        headers: { Host: "localhost:4517" },
      }),
    );
    expect(resLocalhost.status).toBe(200);

    const resBind = await app.request(
      new Request("http://192.168.1.100:4517/test", {
        headers: { Host: "192.168.1.100:4517" },
      }),
    );
    expect(resBind.status).toBe(200);
  });

  it("bindHost='192.168.1.100' rejects unrelated Host headers", async () => {
    const app = makeTestApp(4517, "192.168.1.100");
    const res = await app.request(
      new Request("http://10.0.0.1:4517/test", {
        headers: { Host: "10.0.0.1:4517" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("bindHost='0.0.0.0' accepts Host without port (no constraint)", async () => {
    const app = makeTestApp(4517, "0.0.0.0");
    const res = await app.request(
      new Request("http://localhost:4517/test", {
        headers: { Host: "localhost" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='::' (IPv6 all-interfaces) accepts any Host header", async () => {
    const app = makeTestApp(4517, "::");
    const res = await app.request(
      new Request("http://evil.com:4517/test", {
        headers: { Host: "evil.com:4517" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='::1' (IPv6 loopback) accepts bracket-notation Host", async () => {
    const app = makeTestApp(4517, "::1");
    const res = await app.request(
      new Request("http://[::1]:4517/test", {
        headers: { Host: "[::1]:4517" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='::1' (IPv6 loopback) also accepts IPv4 loopback Hosts", async () => {
    const app = makeTestApp(4517, "::1");
    const res1 = await app.request(
      new Request("http://127.0.0.1:4517/test", {
        headers: { Host: "127.0.0.1:4517" },
      }),
    );
    expect(res1.status).toBe(200);
    const res2 = await app.request(
      new Request("http://localhost:4517/test", {
        headers: { Host: "localhost:4517" },
      }),
    );
    expect(res2.status).toBe(200);
  });

  it("bindHost='::1' rejects bare IPv6 Host (no brackets)", async () => {
    const app = makeTestApp(4517, "::1");
    const res = await app.request(
      new Request("http://[::1]:4517/test", {
        headers: { Host: "::1:4517" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("bindHost='::1' rejects foreign Host", async () => {
    const app = makeTestApp(4517, "::1");
    const res = await app.request(
      new Request("http://10.0.0.1:4517/test", {
        headers: { Host: "10.0.0.1:4517" },
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// isOriginAllowed — bindHost parameter
// ---------------------------------------------------------------------------

describe("isOriginAllowed with bindHost", () => {
  it("bindHost='0.0.0.0' accepts any origin", () => {
    expect(isOriginAllowed("http://evil.com", DEFAULT_API_PORT, "0.0.0.0")).toBe(true);
    expect(isOriginAllowed("http://evil.com:4517", DEFAULT_API_PORT, "0.0.0.0")).toBe(true);
  });

  it("bindHost='192.168.1.100' accepts that origin and loopbacks", () => {
    expect(isOriginAllowed(`http://192.168.1.100:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "192.168.1.100")).toBe(true);
    expect(isOriginAllowed(`http://127.0.0.1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "192.168.1.100")).toBe(true);
    expect(isOriginAllowed(`http://localhost:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "192.168.1.100")).toBe(true);
  });

  it("bindHost='192.168.1.100' rejects non-loopback, non-matching origins", () => {
    expect(isOriginAllowed("http://evil.com", DEFAULT_API_PORT, "192.168.1.100")).toBe(false);
    expect(isOriginAllowed(`http://10.0.0.1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "192.168.1.100")).toBe(false);
  });

  it("bindHost='192.168.1.100' still accepts null/undefined/empty", () => {
    expect(isOriginAllowed(null, DEFAULT_API_PORT, "192.168.1.100")).toBe(true);
    expect(isOriginAllowed(undefined, DEFAULT_API_PORT, "192.168.1.100")).toBe(true);
    expect(isOriginAllowed("", DEFAULT_API_PORT, "192.168.1.100")).toBe(true);
  });

  it("bindHost='::' (IPv6 all-interfaces) accepts any origin", () => {
    expect(isOriginAllowed("http://evil.com", DEFAULT_API_PORT, "::")).toBe(true);
    expect(isOriginAllowed("http://evil.com:4517", DEFAULT_API_PORT, "::")).toBe(true);
  });

  it("bindHost='::1' (IPv6 loopback) accepts bracket-notation origin and IPv4 loopbacks", () => {
    expect(isOriginAllowed(`http://[::1]:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "::1")).toBe(true);
    expect(isOriginAllowed(`http://127.0.0.1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "::1")).toBe(true);
    expect(isOriginAllowed(`http://localhost:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "::1")).toBe(true);
  });

  it("bindHost='::1' rejects non-loopback, non-matching origins", () => {
    expect(isOriginAllowed("http://evil.com", DEFAULT_API_PORT, "::1")).toBe(false);
    expect(isOriginAllowed(`http://10.0.0.1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "::1")).toBe(false);
  });

  it("bindHost='::1' rejects bare IPv6 without brackets", () => {
    expect(isOriginAllowed(`http://::1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT, "::1")).toBe(false);
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

describe("[SECURITY] DNS-rebinding with bindHost=0.0.0.0 — empty allowlist accepts all", () => {
  it("Host: evil.com → 200 accepted (bind-all, no constraint)", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT, undefined, {}, "0.0.0.0");
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: "evil.com" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("Origin: http://evil.com → accepted (bind-all, no constraint)", () => {
    expect(isOriginAllowed("http://evil.com", DEFAULT_API_PORT, "0.0.0.0")).toBe(true);
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

// ---------------------------------------------------------------------------
// Integration — Host allowlist with bindHost
// ---------------------------------------------------------------------------

describe("Host allowlist integration — createApiApp with bindHost", () => {
  it("bindHost='0.0.0.0' accepts request with foreign Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT, undefined, {}, "0.0.0.0");
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: "foreign.local" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='192.168.1.100' accepts request with that IP as Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT, undefined, {}, "192.168.1.100");
    const res = await app.request(
      new Request(`http://192.168.1.100:${DEFAULT_API_PORT}/health`, {
        headers: { Host: `192.168.1.100:${DEFAULT_API_PORT}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='192.168.1.100' rejects request with foreign Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT, undefined, {}, "192.168.1.100");
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: "10.0.0.1:4517" },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("bindHost='::' (IPv6 all-interfaces) accepts foreign Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT, undefined, {}, "::");
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: "foreign.local" },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='::1' (IPv6 loopback) accepts bracket-notation Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT, undefined, {}, "::1");
    const res = await app.request(
      new Request(`http://[::1]:${DEFAULT_API_PORT}/health`, {
        headers: { Host: `[::1]:${DEFAULT_API_PORT}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("bindHost='::1' rejects foreign Host", async () => {
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT, undefined, {}, "::1");
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/health`, {
        headers: { Host: "10.0.0.1:4517" },
      }),
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// isOriginAllowed — WORKFLOW_RUNNER_UI_ORIGIN env-var gating
// ---------------------------------------------------------------------------

describe("isOriginAllowed — WORKFLOW_RUNNER_UI_ORIGIN env-var", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.WORKFLOW_RUNNER_UI_ORIGIN;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.WORKFLOW_RUNNER_UI_ORIGIN;
    } else {
      process.env.WORKFLOW_RUNNER_UI_ORIGIN = savedEnv;
    }
  });

  it("returns false for UI origin when env var is unset", () => {
    delete process.env.WORKFLOW_RUNNER_UI_ORIGIN;
    expect(isOriginAllowed("http://localhost:5173", DEFAULT_API_PORT)).toBe(false);
  });

  it("returns true for UI origin when env var matches", () => {
    process.env.WORKFLOW_RUNNER_UI_ORIGIN = "http://localhost:5173";
    expect(isOriginAllowed("http://localhost:5173", DEFAULT_API_PORT)).toBe(true);
  });

  it("loopback origin remains allowed regardless of env var", () => {
    process.env.WORKFLOW_RUNNER_UI_ORIGIN = "http://localhost:5173";
    expect(isOriginAllowed(`http://127.0.0.1:${DEFAULT_API_PORT}`, DEFAULT_API_PORT)).toBe(true);
  });

  it("returns false for evil origin even when a different UI origin is configured", () => {
    process.env.WORKFLOW_RUNNER_UI_ORIGIN = "http://localhost:5173";
    expect(isOriginAllowed("http://evil.example", DEFAULT_API_PORT)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// corsMiddleware — unit tests
// ---------------------------------------------------------------------------

describe("corsMiddleware", () => {
  it("adds Access-Control-Allow-Origin for matching origin", async () => {
    const app = new Hono();
    app.use("/*", corsMiddleware("http://localhost:5173"));
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request(
      new Request("http://localhost/test", {
        headers: { Origin: "http://localhost:5173" },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("does not add Access-Control-Allow-Origin for non-matching origin", async () => {
    const app = new Hono();
    app.use("/*", corsMiddleware("http://localhost:5173"));
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request(
      new Request("http://localhost/test", {
        headers: { Origin: "http://evil.example" },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("does not add Access-Control-Allow-Origin when Origin header is absent", async () => {
    const app = new Hono();
    app.use("/*", corsMiddleware("http://localhost:5173"));
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request(new Request("http://localhost/test"));
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("handles OPTIONS preflight with 204 and CORS headers", async () => {
    const app = new Hono();
    app.use("/*", corsMiddleware("http://localhost:5173"));
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request(
      new Request("http://localhost/test", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("OPTIONS preflight without matching origin does not short-circuit", async () => {
    const app = new Hono();
    app.use("/*", corsMiddleware("http://localhost:5173"));
    app.get("/test", (c) => c.text("ok"));

    const res = await app.request(
      new Request("http://localhost/test", {
        method: "OPTIONS",
        headers: { Origin: "http://other.example" },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CORS integration — createApiApp
// ---------------------------------------------------------------------------

describe("CORS integration — createApiApp with WORKFLOW_RUNNER_UI_ORIGIN", () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.WORKFLOW_RUNNER_UI_ORIGIN;
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.WORKFLOW_RUNNER_UI_ORIGIN;
    } else {
      process.env.WORKFLOW_RUNNER_UI_ORIGIN = savedEnv;
    }
  });

  it("OPTIONS /runs preflight from configured origin returns 2xx with CORS headers", async () => {
    process.env.WORKFLOW_RUNNER_UI_ORIGIN = "http://localhost:5173";
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/runs`, {
        method: "OPTIONS",
        headers: {
          Host: `localhost:${DEFAULT_API_PORT}`,
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      }),
    );
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("GET /runs from configured origin includes CORS header", async () => {
    process.env.WORKFLOW_RUNNER_UI_ORIGIN = "http://localhost:5173";
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/runs`, {
        headers: {
          Host: `localhost:${DEFAULT_API_PORT}`,
          Origin: "http://localhost:5173",
        },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  });

  it("CORS header absent when env var is unset", async () => {
    delete process.env.WORKFLOW_RUNNER_UI_ORIGIN;
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/runs`, {
        headers: {
          Host: `localhost:${DEFAULT_API_PORT}`,
          Origin: "http://localhost:5173",
        },
      }),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  it("WS pre-upgrade: configured origin passes origin check (not 403)", async () => {
    process.env.WORKFLOW_RUNNER_UI_ORIGIN = "http://localhost:5173";
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/runs/fake-id/attach`, {
        headers: {
          Host: `localhost:${DEFAULT_API_PORT}`,
          Origin: "http://localhost:5173",
        },
      }),
    );
    // Origin check passes → run resolution returns 404, not 403
    expect(res.status).not.toBe(403);
  });

  it("WS pre-upgrade: non-allowed origin is rejected 403", async () => {
    process.env.WORKFLOW_RUNNER_UI_ORIGIN = "http://localhost:5173";
    const app = createApiApp(makePartialRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/runs/fake-id/attach`, {
        headers: {
          Host: `localhost:${DEFAULT_API_PORT}`,
          Origin: "http://evil.example",
        },
      }),
    );
    expect(res.status).toBe(403);
  });
});
