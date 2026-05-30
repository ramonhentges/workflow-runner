import { describe, expect, it } from "bun:test";
import {
  ERROR_HTTP_STATUS,
  httpStatusForError,
  mapError,
} from "./error-map.js";
import { createApiApp } from "./app.js";
import { RunManagerError } from "../../infra/daemon/run-manager.js";
import { WorkflowConfigError } from "../../domain/workflow.js";
import { RpcErrorCode } from "../../infra/daemon/protocol.js";
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

// Build a RunManagerError with an arbitrary numeric code (bypasses the
// constructor's name-to-code lookup so we can test unmapped codes).
function makeErrWithCode(code: number): RunManagerError {
  const err = new RunManagerError("UNKNOWN_RUN", "test");
  Object.defineProperty(err, "code", { value: code });
  return err;
}

// ---------------------------------------------------------------------------
// ERROR_HTTP_STATUS table
// ---------------------------------------------------------------------------

describe("ERROR_HTTP_STATUS table", () => {
  it("maps UNKNOWN_RUN to 404", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.UNKNOWN_RUN]).toBe(404);
  });

  it("maps WORKFLOW_INVALID to 400", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.WORKFLOW_INVALID]).toBe(400);
  });

  it("maps RUN_NOT_RETRY_ELIGIBLE to 409", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.RUN_NOT_RETRY_ELIGIBLE]).toBe(409);
  });

  it("maps AMBIGUOUS_PREFIX to 409", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.AMBIGUOUS_PREFIX]).toBe(409);
  });

  it("maps RUN_LIMIT_REACHED to 429", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.RUN_LIMIT_REACHED]).toBe(429);
  });

  it("maps RUN_NOT_INTERACTIVE to 409", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.RUN_NOT_INTERACTIVE]).toBe(409);
  });

  it("maps DAEMON_SHUTTING_DOWN to 503", () => {
    expect(ERROR_HTTP_STATUS[RpcErrorCode.DAEMON_SHUTTING_DOWN]).toBe(503);
  });
});

// ---------------------------------------------------------------------------
// httpStatusForError
// ---------------------------------------------------------------------------

describe("httpStatusForError", () => {
  it("returns 404 for UNKNOWN_RUN", () => {
    expect(httpStatusForError(new RunManagerError("UNKNOWN_RUN"))).toBe(404);
  });

  it("returns 400 for WORKFLOW_INVALID", () => {
    expect(httpStatusForError(new RunManagerError("WORKFLOW_INVALID"))).toBe(400);
  });

  it("returns 409 for AMBIGUOUS_PREFIX", () => {
    expect(httpStatusForError(new RunManagerError("AMBIGUOUS_PREFIX"))).toBe(409);
  });

  it("returns 409 for RUN_NOT_RETRY_ELIGIBLE", () => {
    expect(httpStatusForError(new RunManagerError("RUN_NOT_RETRY_ELIGIBLE"))).toBe(409);
  });

  it("returns 429 for RUN_LIMIT_REACHED", () => {
    expect(httpStatusForError(new RunManagerError("RUN_LIMIT_REACHED"))).toBe(429);
  });

  it("returns 500 for an unmapped code", () => {
    expect(httpStatusForError(makeErrWithCode(-99999))).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// mapError
// ---------------------------------------------------------------------------

describe("mapError", () => {
  it("maps RunManagerError UNKNOWN_RUN to {status:404, code:'UNKNOWN_RUN'}", () => {
    const mapped = mapError(new RunManagerError("UNKNOWN_RUN", "not found"));
    expect(mapped.status).toBe(404);
    expect(mapped.code).toBe("UNKNOWN_RUN");
    expect(mapped.message).toBe("not found");
  });

  it("maps RunManagerError RUN_LIMIT_REACHED to {status:429}", () => {
    const mapped = mapError(new RunManagerError("RUN_LIMIT_REACHED"));
    expect(mapped.status).toBe(429);
  });

  it("maps WorkflowConfigError to {status:400, code:'WORKFLOW_INVALID'}", () => {
    const mapped = mapError(new WorkflowConfigError("bad schema"));
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe("WORKFLOW_INVALID");
  });

  it("maps unknown errors to {status:500, code:'INTERNAL_ERROR'}", () => {
    const mapped = mapError(new Error("boom"));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("INTERNAL_ERROR");
  });

  it("maps non-Error throws to {status:500}", () => {
    const mapped = mapError("string error");
    expect(mapped.status).toBe(500);
    expect(mapped.message).toBe("string error");
  });

  it("maps unmapped RunManagerError code to {status:500}", () => {
    const mapped = mapError(makeErrWithCode(-99999));
    expect(mapped.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// createApiApp / GET /openapi.json
// ---------------------------------------------------------------------------

describe("createApiApp", () => {
  it("GET /openapi.json returns 200 with openapi version and info", async () => {
    const app = createApiApp(makePartialRm());
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(json.openapi).toBe("3.0.0");
    expect(typeof json.info).toBe("object");
    expect((json.info as Record<string, unknown>).title).toBe("Workflow Runner API");
  });

  it("GET /openapi.json includes registered routes", async () => {
    const { createRoute } = await import("@hono/zod-openapi");
    const { z } = await import("zod");

    const app = createApiApp(makePartialRm());

    // Register a test route so the doc has path content.
    const pingRoute = createRoute({
      method: "get",
      path: "/ping",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({ pong: z.boolean() }),
            },
          },
          description: "Ping response",
        },
      },
    });
    app.openapi(pingRoute, (c) => c.json({ pong: true }));

    const res = await app.request("/openapi.json");
    const json = await res.json() as Record<string, unknown>;
    const paths = json.paths as Record<string, unknown>;
    expect(paths["/ping"]).toBeDefined();
  });

  it("app is testable via fetch handler (no port binding)", async () => {
    const app = createApiApp(makePartialRm());
    // app.fetch is defined — it can be passed to Bun.serve without modification.
    expect(typeof app.fetch).toBe("function");
  });
});
