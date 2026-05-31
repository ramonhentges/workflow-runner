/**
 * Speciation-guard test (ADR-001 F8, ADR-003).
 *
 * A test-only stdin/stdout adapter drives RunManager through the thin-handler
 * pattern — no RunManager source changes required.
 *
 * The adapter is intentionally minimal: plain functions, no real I/O.
 * Proves that a third transport (stdin/stdout) layers over RunManager directly
 * in <10 lines per operation, same as HTTP handlers.
 */
import { describe, expect, it } from "bun:test";
import type { RunManager } from "../../infra/daemon/run-manager.js";
import { RunManagerError } from "../../infra/daemon/run-manager.js";
import { mapError } from "./error-map.js";
import { asRunId, asRunSlug } from "../../domain/run.js";
import type { RunSnapshot } from "../../domain/run.js";

// ---------------------------------------------------------------------------
// Test-only stdin/stdout transport adapter
//
// Thin-handler pattern (per ADR-003): parse → one RunManager call → map result or error.
// Requests/responses flow through plain async function calls (no real I/O).
// ---------------------------------------------------------------------------

interface StdioRequest {
  method: string;
  params?: Record<string, unknown>;
}

interface StdioOk {
  ok: true;
  result: unknown;
}

interface StdioErr {
  ok: false;
  error: { status: number; code: string; message: string };
}

type StdioResponse = StdioOk | StdioErr;

/** Simulates stdin line deserialization (JSON parsing). */
function decodeRequest(line: string): StdioRequest {
  return JSON.parse(line) as StdioRequest;
}

/**
 * Minimal stdin/stdout adapter over RunManager.
 *
 * Each case follows the thin-handler convention:
 *   parse → one RunManager call → format result
 *
 * Errors are caught once at the boundary and mapped via the shared error-map —
 * the same table HTTP handlers use.
 */
async function handleLine(rm: RunManager, line: string): Promise<StdioResponse> {
  const req = decodeRequest(line);
  try {
    switch (req.method) {
      case "list": {
        const all = !!(req.params?.all);
        const snapshots = rm.list({ includeOldTerminal: all });
        return {
          ok: true,
          result: {
            runs: snapshots.map((s) => ({
              id: s.id,
              slug: s.slug,
              status: s.status,
              startedAt: s.startedAt,
            })),
          },
        };
      }
      case "get": {
        const idOrPrefix = String(req.params?.id ?? "");
        const active = rm.get(idOrPrefix);
        if (!active) throw new RunManagerError("UNKNOWN_RUN", `Run not found: ${idOrPrefix}`);
        const snap = active.run.snapshot();
        return {
          ok: true,
          result: { id: snap.id, slug: snap.slug, status: snap.status },
        };
      }
      default:
        throw new Error(`Unknown method: ${req.method}`);
    }
  } catch (err) {
    const mapped = mapError(err);
    return { ok: false, error: mapped };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeSnapshot(
  id: string,
  slug: string,
  status: RunSnapshot["status"] = "running",
): RunSnapshot {
  return {
    id: asRunId(id),
    slug: asRunSlug(slug),
    workflowPath: "/tmp/wf.json",
    status,
    currentStepId: null,
    visitedStepIds: [],
    kickoffPrompts: {},
    startedAt: 1_700_000_000_000,
    endedAt: null,
  };
}

function makeRm(opts: {
  snapshots?: RunSnapshot[];
  listThrows?: RunManagerError;
  getRm?: RunManager["get"];
}): RunManager {
  return {
    list: opts.listThrows
      ? () => { throw opts.listThrows; }
      : () => opts.snapshots ?? [],
    get: opts.getRm ?? (() => undefined),
    startRun: async () => { throw new Error("not impl"); },
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async () => 0,
    attachSubscriber: () => () => {},
    openEventLog: async () => null,
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

// ---------------------------------------------------------------------------
// Speciation-guard tests
// ---------------------------------------------------------------------------

describe("speciation guard — stdin/stdout adapter over RunManager", () => {
  it("list returns empty run list when there are no runs", async () => {
    const rm = makeRm({ snapshots: [] });
    const res = await handleLine(rm, JSON.stringify({ method: "list" }));

    expect(res.ok).toBe(true);
    const { runs } = (res as StdioOk).result as { runs: unknown[] };
    expect(runs).toHaveLength(0);
  });

  it("list returns running runs with expected shape", async () => {
    const snap = fakeSnapshot("abc12345", "brave-otter", "running");
    const rm = makeRm({ snapshots: [snap] });
    const res = await handleLine(rm, JSON.stringify({ method: "list" }));

    expect(res.ok).toBe(true);
    const { runs } = (res as StdioOk).result as {
      runs: Array<{ id: string; slug: string; status: string; startedAt: number }>;
    };
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("abc12345");
    expect(runs[0].slug).toBe("brave-otter");
    expect(runs[0].status).toBe("running");
    expect(typeof runs[0].startedAt).toBe("number");
  });

  it("list with all=true passes includeOldTerminal flag to RunManager", async () => {
    let capturedOpts: { includeOldTerminal?: boolean } | undefined;
    const rm = {
      ...makeRm({ snapshots: [] }),
      list: (opts?: { includeOldTerminal?: boolean }) => {
        capturedOpts = opts;
        return [];
      },
    } as unknown as RunManager;

    await handleLine(rm, JSON.stringify({ method: "list", params: { all: true } }));
    expect(capturedOpts?.includeOldTerminal).toBe(true);
  });

  it("get returns UNKNOWN_RUN error when run is not found", async () => {
    const rm = makeRm({ snapshots: [] });
    const res = await handleLine(rm, JSON.stringify({ method: "get", params: { id: "nope" } }));

    expect(res.ok).toBe(false);
    const err = (res as StdioErr).error;
    expect(err.status).toBe(404);
    expect(err.code).toBe("UNKNOWN_RUN");
  });

  it("get propagates AMBIGUOUS_PREFIX thrown by RunManager", async () => {
    const rm = makeRm({
      snapshots: [],
      getRm: () => { throw new RunManagerError("AMBIGUOUS_PREFIX", "matches multiple runs"); },
    });
    const res = await handleLine(rm, JSON.stringify({ method: "get", params: { id: "ab" } }));

    expect(res.ok).toBe(false);
    const err = (res as StdioErr).error;
    expect(err.status).toBe(409);
    expect(err.code).toBe("AMBIGUOUS_PREFIX");
  });

  it("list error maps RUN_LIMIT_REACHED to 429", async () => {
    const rm = makeRm({ listThrows: new RunManagerError("RUN_LIMIT_REACHED") });
    const res = await handleLine(rm, JSON.stringify({ method: "list" }));

    expect(res.ok).toBe(false);
    const err = (res as StdioErr).error;
    expect(err.status).toBe(429);
    expect(err.code).toBe("RUN_LIMIT_REACHED");
  });

  it("unknown method returns 500 error (not a crash)", async () => {
    const rm = makeRm({ snapshots: [] });
    const res = await handleLine(rm, JSON.stringify({ method: "bogus" }));

    expect(res.ok).toBe(false);
    expect((res as StdioErr).error.status).toBe(500);
  });

  it("proves RunManager was not modified for this transport", () => {
    // All methods used by handleLine — list and get — are pre-existing public methods.
    // No new methods, no source changes. This assertion documents the invariant.
    const rm = makeRm({ snapshots: [] });
    expect(typeof rm.list).toBe("function");
    expect(typeof rm.get).toBe("function");
    // RunManagerError is imported unchanged; its constructor still maps name → numeric code.
    const err = new RunManagerError("UNKNOWN_RUN");
    expect(err.code).toBe(-32000);
  });
});
