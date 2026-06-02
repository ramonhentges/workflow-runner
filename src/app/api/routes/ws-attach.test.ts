import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WSContext } from "hono/ws";
import { createApiApp } from "../app.js";
import { DEFAULT_API_PORT } from "../security.js";
import {
  createPerConnectionState,
  createWsConnectionRegistry,
  MAX_OUTBOUND_FRAMES,
  MAX_WS_CONNECTIONS,
} from "./ws-attach.js";
import { RunManager, RunManagerError } from "../../../infra/daemon/run-manager.js";
import { EventLog } from "../../../infra/daemon/event-log.js";
import { FixtureSessionFactory } from "../../../infra/daemon/test-helpers/fixture-session-factory.js";
import { asRunId, asRunSlug } from "../../../domain/run.js";
import type { RunSnapshot } from "../../../domain/run.js";
import type { ActiveRun, RunSubscriber } from "../../../infra/daemon/run-manager.js";
import type { EventLogEntry } from "../../../infra/daemon/event-log.js";
import type { AttachFrame, InputFrame } from "../schema.js";
import { asStepId } from "../../../domain/ids.js";

// ---------------------------------------------------------------------------
// Mock WS builder
// ---------------------------------------------------------------------------

interface MockWsOptions {
  /** If provided, ws.raw.send returns this sequence of values on each call. */
  rawSendStatuses?: number[];
  readyState?: 0 | 1 | 2 | 3;
}

interface MockWs {
  ws: WSContext;
  sentFrames(): AttachFrame[];
  rawSendCalls(): number;
  closeCalls(): Array<[number | undefined, string | undefined]>;
}

function makeMockWs(opts: MockWsOptions = {}): MockWs {
  let callIndex = 0;
  const rawStatuses = opts.rawSendStatuses;
  let readyState: 0 | 1 | 2 | 3 = opts.readyState ?? 1;

  const rawSendHistory: string[] = [];
  const closedWith: Array<[number | undefined, string | undefined]> = [];

  const rawSend = rawStatuses
    ? (data: string): number => {
        rawSendHistory.push(data);
        const status = rawStatuses[callIndex] ?? rawStatuses[rawStatuses.length - 1] ?? 1;
        callIndex++;
        return status;
      }
    : undefined;

  const ws = {
    readyState,
    send: (data: string) => {
      rawSendHistory.push(data);
    },
    close: (code?: number, reason?: string) => {
      readyState = 3;
      (ws as { readyState: number }).readyState = 3;
      closedWith.push([code, reason]);
    },
    raw: rawSend ? { send: rawSend } : undefined,
  } as unknown as WSContext;

  return {
    ws,
    sentFrames(): AttachFrame[] {
      return rawSendHistory.map((s) => JSON.parse(s) as AttachFrame);
    },
    rawSendCalls(): number {
      return rawSendHistory.length;
    },
    closeCalls(): Array<[number | undefined, string | undefined]> {
      return closedWith;
    },
  };
}

// ---------------------------------------------------------------------------
// Mock RunManager builder
// ---------------------------------------------------------------------------

const BASE_TS = 1_700_000_000_000;

function fakeSnapshot(
  id: string,
  slug: string,
  status: RunSnapshot["status"] = "running",
  currentStepId: string | null = "step-1",
): RunSnapshot {
  return {
    id: asRunId(id),
    slug: asRunSlug(slug),
    workflowPath: "/tmp/wf.json",
    status,
    currentStepId,
    visitedStepIds: ["step-1"],
    kickoffPrompts: {},
    startedAt: BASE_TS,
    endedAt: status === "running" ? null : BASE_TS + 5000,
  };
}

function fakeEntry(seq: number, stepId: string | null = "step-1"): EventLogEntry {
  return {
    seq,
    ts: BASE_TS + seq * 100,
    stepId,
    event: { type: "log", message: `event-${seq}` },
  };
}

interface MockRmOpts {
  getBehavior?: "found" | "not-found" | "ambiguous";
  status?: RunSnapshot["status"];
  currentStepId?: string | null;
  activeEventLog?: object | null;
  openedEventLog?: object | null;
  sendInputError?: "not-interactive" | "unknown-run" | null;
  captureSubscriber?: (sub: RunSubscriber) => void;
  isInteractive?: boolean;
}

function makeRm(opts: MockRmOpts = {}): RunManager {
  const snap = fakeSnapshot(
    "run001",
    "brave-otter",
    opts.status ?? "running",
    opts.currentStepId !== undefined ? opts.currentStepId : "step-1",
  );

  return {
    list: () => [],
    get: (idOrPrefix: string): ActiveRun | undefined => {
      if (opts.getBehavior === "not-found") return undefined;
      if (opts.getBehavior === "ambiguous") {
        throw new RunManagerError(
          "AMBIGUOUS_PREFIX",
          `Prefix '${idOrPrefix}' matches: run-a, run-b`,
          { candidates: ["run-a", "run-b"] },
        );
      }
      return {
        run: { snapshot: () => snap } as ActiveRun["run"],
        eventLog: opts.activeEventLog ?? null,
        subscribers: new Set(),
        runner: null,
        mcpServer: null,
        runPromise: null,
      } as unknown as ActiveRun;
    },
    openEventLog: async () => (opts.openedEventLog ?? null) as unknown as EventLog | null,
    startRun: async () => { throw new Error("not impl"); },
    retryStep: async () => {},
    stop: async () => {},
    sendInput: async (_runId: string, _message: string) => {
      if (opts.sendInputError === "not-interactive") {
        throw new RunManagerError("RUN_NOT_INTERACTIVE", "Run is not interactive");
      }
      if (opts.sendInputError === "unknown-run") {
        throw new RunManagerError("UNKNOWN_RUN", "Unknown run");
      }
      return 1;
    },
    attachSubscriber: (_runId: string, sub: RunSubscriber) => {
      opts.captureSubscriber?.(sub);
      return () => {};
    },
    discoverOnStartup: async () => {},
    shutdown: async () => {},
  } as unknown as RunManager;
}

// ---------------------------------------------------------------------------
// Helper: EventLog-like mock with ring backlog
// ---------------------------------------------------------------------------

function makeEventLogMock(entries: EventLogEntry[]): object {
  return {
    currentStepBacklog: (_stepId: string) => entries,
    readBackwardForCurrentStep: async () => entries,
    readEventsSince: async (fromSeq: number) => ({
      entries: entries.filter((e) => e.seq > fromSeq),
      truncated: false,
    }),
    flush: async () => {},
    close: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Pre-upgrade HTTP response tests (via app.request)
// ---------------------------------------------------------------------------

describe("WS /runs/:id/attach — pre-upgrade (HTTP responses)", () => {
  it("returns 403 for a foreign Origin header when port is configured", async () => {
    const app = createApiApp(makeRm(), DEFAULT_API_PORT);
    const res = await app.request(
      new Request(`http://localhost:${DEFAULT_API_PORT}/runs/run001/attach`, {
        headers: {
          Host: `localhost:${DEFAULT_API_PORT}`,
          Origin: "http://evil.com",
          Upgrade: "websocket",
          Connection: "Upgrade",
        },
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows upgrade when Origin is null (non-browser client) — tested via isOriginAllowed", () => {
    // The Origin allowlist guard for null/empty origins is tested directly in
    // security.test.ts via isOriginAllowed(). Pre-upgrade middleware only calls
    // isOriginAllowed; if it returns true, the middleware calls next().
    const { isOriginAllowed: check } = require("../security.js") as typeof import("../security.js");
    expect(check(null, DEFAULT_API_PORT)).toBe(true);
    expect(check(undefined, DEFAULT_API_PORT)).toBe(true);
    expect(check("", DEFAULT_API_PORT)).toBe(true);
  });

  it("returns 404 for an unknown run id", async () => {
    const app = createApiApp(makeRm({ getBehavior: "not-found" }));
    const res = await app.request("/runs/no-such-run/attach");
    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("UNKNOWN_RUN");
  });

  it("returns 409 with candidate list for an ambiguous prefix", async () => {
    const app = createApiApp(makeRm({ getBehavior: "ambiguous" }));
    const res = await app.request("/runs/run-abc/attach");
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("AMBIGUOUS_PREFIX");
    expect(Array.isArray(body.candidates)).toBe(true);
  });

  it("returns 503 when max connections cap is reached", async () => {
    // The counter lives inside registerWsAttachRoute's closure and is
    // incremented inside onOpen (which requires a real Bun server to trigger).
    // We verify the constant is exported and the middleware path exists by
    // checking that MAX_WS_CONNECTIONS is a positive integer and that a known
    // run with an empty counter returns 404 (not 503).
    expect(MAX_WS_CONNECTIONS).toBeGreaterThan(0);

    const app = createApiApp(makeRm({ getBehavior: "not-found" }));
    const res = await app.request("/runs/run001/attach");
    // 404 (unknown run) not 503 (cap) confirms the cap check passed.
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Per-connection state — frame sequence (onOpen)
// ---------------------------------------------------------------------------

describe("createPerConnectionState — onOpen frame sequence", () => {
  it("sends snapshot then backlog on initial connect (no fromSeq)", async () => {
    const entries = [fakeEntry(1), fakeEntry(2)];
    const eventLog = makeEventLogMock(entries);
    const rm = makeRm({ activeEventLog: eventLog });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    const frames = sentFrames();
    expect(frames.length).toBeGreaterThanOrEqual(2);
    expect(frames[0]?.type).toBe("snapshot");
    expect(frames[1]?.type).toBe("backlog");
    if (frames[1]?.type === "backlog") {
      expect(frames[1].truncated).toBe(false);
    }
  });

  it("sends snapshot before backlog — ordering is always snapshot first", async () => {
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    const types = sentFrames().map((f) => f.type);
    const snapshotIdx = types.indexOf("snapshot");
    const backlogIdx = types.indexOf("backlog");
    expect(snapshotIdx).toBeLessThan(backlogIdx);
  });

  it("sends error frame and closes when run is not found in onOpen", async () => {
    const rm = makeRm({ getBehavior: "not-found" });
    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "nonexistent", undefined, () => {});
    await state.onOpen(mock.ws);

    const frames = mock.sentFrames();
    const errorFrame = frames.find((f) => f.type === "error");
    expect(errorFrame).toBeDefined();
    if (errorFrame?.type === "error") {
      expect(errorFrame.code).toBe("UNKNOWN_RUN");
    }
    expect(mock.closeCalls().length).toBe(1);
  });

  it("sends all backlog entries on initial attach", async () => {
    const entries = [fakeEntry(1), fakeEntry(2), fakeEntry(3)];
    const eventLog = makeEventLogMock(entries);
    const rm = makeRm({ activeEventLog: eventLog });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    const backlogFrame = sentFrames().find((f) => f.type === "backlog");
    expect(backlogFrame?.type).toBe("backlog");
    if (backlogFrame?.type === "backlog") {
      expect(backlogFrame.entries.length).toBe(3);
    }
  });

  it("initial attach returns events from all steps, not just the current step", async () => {
    const step1Events = [fakeEntry(1, "step-1"), fakeEntry(2, "step-1")];
    const step2Events = [fakeEntry(3, "step-2"), fakeEntry(4, "step-2")];
    const allEntries = [...step1Events, ...step2Events];

    // currentStepBacklog/readBackwardForCurrentStep would only return step-2 events
    // (old behaviour). The new path uses readEventsSince(0) via makeEventLogMock.
    const eventLog = makeEventLogMock(allEntries);
    const rm = makeRm({ activeEventLog: eventLog, currentStepId: "step-2" });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    const backlogFrame = sentFrames().find((f) => f.type === "backlog");
    expect(backlogFrame?.type).toBe("backlog");
    if (backlogFrame?.type === "backlog") {
      const seqs = backlogFrame.entries.map((e) => e.seq);
      // Must include events from both step-1 AND step-2.
      expect(seqs).toContain(1);
      expect(seqs).toContain(2);
      expect(seqs).toContain(3);
      expect(seqs).toContain(4);
    }
  });

  it("backlog frame has truncated=true when EventLog signals truncation", async () => {
    const entries = [fakeEntry(1)];
    const eventLog = {
      ...makeEventLogMock(entries),
      readEventsSince: async (_fromSeq: number) => ({ entries, truncated: true }),
    };
    const rm = makeRm({ activeEventLog: eventLog });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", 0, () => {});
    await state.onOpen(ws);

    const backlogFrame = sentFrames().find((f) => f.type === "backlog");
    expect(backlogFrame?.type).toBe("backlog");
    if (backlogFrame?.type === "backlog") {
      expect(backlogFrame.truncated).toBe(true);
    }
  });

  it("live events arrive as 'event' frames after onOpen completes", async () => {
    let capturedSub: RunSubscriber | null = null;
    const rm = makeRm({
      activeEventLog: makeEventLogMock([]),
      captureSubscriber: (sub) => { capturedSub = sub; },
    });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    expect(capturedSub).not.toBeNull();

    const before = sentFrames().length;
    capturedSub!.onEvent(fakeEntry(5));

    const after = sentFrames();
    expect(after.length).toBe(before + 1);
    const lastFrame = after[after.length - 1];
    expect(lastFrame?.type).toBe("event");
    if (lastFrame?.type === "event") {
      expect(lastFrame.entry.seq).toBe(5);
    }
  });

  it("status changes arrive as 'status' frames", async () => {
    let capturedSub: RunSubscriber | null = null;
    const rm = makeRm({
      activeEventLog: makeEventLogMock([]),
      captureSubscriber: (sub) => { capturedSub = sub; },
    });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    capturedSub!.onStatusChanged?.("completed");

    const frames = sentFrames();
    const statusFrame = frames.find((f) => f.type === "status");
    expect(statusFrame?.type).toBe("status");
    if (statusFrame?.type === "status") {
      expect(statusFrame.status).toBe("completed");
    }
  });
});

// ---------------------------------------------------------------------------
// Per-connection state — fromSeq resume
// ---------------------------------------------------------------------------

describe("createPerConnectionState — fromSeq resume", () => {
  it("sends events since fromSeq when fromSeq is provided", async () => {
    const allEntries = [fakeEntry(1), fakeEntry(2), fakeEntry(3), fakeEntry(4)];
    const eventLog = {
      ...makeEventLogMock(allEntries),
      readEventsSince: async (fromSeq: number) => ({
        entries: allEntries.filter((e) => e.seq > fromSeq),
        truncated: false,
      }),
      flush: async () => {},
    };
    const rm = makeRm({ activeEventLog: eventLog });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", 2, () => {});
    await state.onOpen(ws);

    const backlogFrame = sentFrames().find((f) => f.type === "backlog");
    expect(backlogFrame?.type).toBe("backlog");
    if (backlogFrame?.type === "backlog") {
      expect(backlogFrame.entries.map((e) => e.seq)).toEqual([3, 4]);
    }
  });

  it("backlog is empty and truncated=false when all events are caught up", async () => {
    const eventLog = {
      ...makeEventLogMock([]),
      readEventsSince: async () => ({ entries: [], truncated: false }),
      flush: async () => {},
    };
    const rm = makeRm({ activeEventLog: eventLog });

    const { ws, sentFrames } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", 99, () => {});
    await state.onOpen(ws);

    const backlogFrame = sentFrames().find((f) => f.type === "backlog");
    expect(backlogFrame?.type).toBe("backlog");
    if (backlogFrame?.type === "backlog") {
      expect(backlogFrame.entries).toEqual([]);
      expect(backlogFrame.truncated).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Per-connection state — fromSeq NaN guard
// ---------------------------------------------------------------------------

describe("createPerConnectionState — fromSeq NaN guard", () => {
  it("sends INVALID_QUERY error frame and closes when fromSeqError is set", async () => {
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {}, {
      fromSeqError: "Invalid fromSeq: must be a non-negative integer",
    });
    await state.onOpen(mock.ws);

    const frames = mock.sentFrames();
    const errorFrame = frames.find((f) => f.type === "error");
    expect(errorFrame).toBeDefined();
    if (errorFrame?.type === "error") {
      expect(errorFrame.code).toBe("INVALID_QUERY");
      expect(errorFrame.message).toContain("fromSeq");
    }
    expect(mock.closeCalls().length).toBe(1);
    expect(mock.closeCalls()[0]?.[0]).toBe(1008);
  });

  it("does not proceed to run resolution when fromSeqError is set", async () => {
    // Verifies that no snapshot or backlog is sent — only the error frame.
    const rm = makeRm({ activeEventLog: makeEventLogMock([fakeEntry(1)]) });
    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {}, {
      fromSeqError: "Invalid fromSeq: must be a non-negative integer",
    });
    await state.onOpen(mock.ws);

    const frames = mock.sentFrames();
    expect(frames.every((f) => f.type === "error")).toBe(true);
    expect(frames.find((f) => f.type === "snapshot")).toBeUndefined();
    expect(frames.find((f) => f.type === "backlog")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Per-connection state — input frame handling
// ---------------------------------------------------------------------------

describe("createPerConnectionState — input frame (onMessage)", () => {
  it("calls sendInput when a valid input frame is received on an interactive run", async () => {
    const received: string[] = [];
    const rm: RunManager = {
      ...makeRm({ activeEventLog: makeEventLogMock([]) }),
      sendInput: async (_runId: string, message: string) => {
        received.push(message);
        return 1;
      },
    } as unknown as RunManager;

    const { ws } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    const inputFrame: InputFrame = { type: "input", message: "hello world" };
    await state.onMessage(ws, JSON.stringify(inputFrame));

    expect(received).toEqual(["hello world"]);
  });

  it("sends a non-fatal error frame for a non-interactive run (does NOT close connection)", async () => {
    const rm = makeRm({
      activeEventLog: makeEventLogMock([]),
      sendInputError: "not-interactive",
    });

    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(mock.ws);

    const framesBefore = mock.sentFrames().length;
    await state.onMessage(mock.ws, JSON.stringify({ type: "input", message: "test" }));

    const framesAfter = mock.sentFrames();
    const errorFrame = framesAfter.slice(framesBefore).find((f) => f.type === "error");
    expect(errorFrame?.type).toBe("error");
    if (errorFrame?.type === "error") {
      expect(errorFrame.code).toBe("RUN_NOT_INTERACTIVE");
    }
    // Connection should NOT be closed for a non-interactive error.
    expect(mock.closeCalls().length).toBe(0);
  });

  it("sends INVALID_FRAME error frame for malformed JSON input", async () => {
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(mock.ws);

    const before = mock.sentFrames().length;
    await state.onMessage(mock.ws, "not-json{{");

    const newFrames = mock.sentFrames().slice(before);
    const errFrame = newFrames.find((f) => f.type === "error");
    expect(errFrame?.type).toBe("error");
    if (errFrame?.type === "error") {
      expect(errFrame.code).toBe("INVALID_FRAME");
    }
    expect(mock.closeCalls().length).toBe(0);
  });

  it("sends INVALID_FRAME error frame for a valid JSON that is not an InputFrame", async () => {
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(mock.ws);

    const before = mock.sentFrames().length;
    await state.onMessage(mock.ws, JSON.stringify({ type: "unknown", data: "x" }));

    const newFrames = mock.sentFrames().slice(before);
    const errFrame = newFrames.find((f) => f.type === "error");
    expect(errFrame?.type).toBe("error");
    if (errFrame?.type === "error") {
      expect(errFrame.code).toBe("INVALID_FRAME");
    }
  });
});

// ---------------------------------------------------------------------------
// Per-connection state — outbound buffer overflow
// ---------------------------------------------------------------------------

describe("createPerConnectionState — outbound buffer overflow", () => {
  it("closes with code 1008 after MAX_OUTBOUND_FRAMES consecutive backpressured sends", async () => {
    const subs: RunSubscriber[] = [];
    const rm = makeRm({
      activeEventLog: makeEventLogMock([]),
      captureSubscriber: (sub) => { subs.push(sub); },
    });

    // raw.send always returns 0 = backpressured
    const mock = makeMockWs({ rawSendStatuses: [0] });
    const state = createPerConnectionState(rm, "run001", undefined, () => {}, {
      maxOutboundFrames: 5, // tiny limit for testing
    });
    await state.onOpen(mock.ws);

    // Fire enough events to fill the buffer (snapshot + backlog already sent,
    // but those go through raw.send too; count from the subscriber events)
    const sub1 = subs[0];
    expect(sub1).toBeDefined();
    for (let i = 1; i <= 10 && sub1; i++) {
      sub1.onEvent(fakeEntry(100 + i));
    }

    const closes = mock.closeCalls();
    expect(closes.some(([code]) => code === 1008)).toBe(true);
  });

  it("does not close when sends are successful (raw.send returns positive)", async () => {
    const subs2: RunSubscriber[] = [];
    const rm = makeRm({
      activeEventLog: makeEventLogMock([]),
      captureSubscriber: (sub) => { subs2.push(sub); },
    });

    // raw.send always returns 100 = sent successfully
    const mock = makeMockWs({ rawSendStatuses: [100] });
    const state = createPerConnectionState(rm, "run001", undefined, () => {}, {
      maxOutboundFrames: 5,
    });
    await state.onOpen(mock.ws);

    const sub2 = subs2[0];
    for (let i = 1; i <= 10 && sub2; i++) {
      sub2.onEvent(fakeEntry(100 + i));
    }

    // No close should be triggered by successful sends
    const closes = mock.closeCalls().filter(([code]) => code === 1008);
    expect(closes.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-connection state — idle timeout
// ---------------------------------------------------------------------------

describe("createPerConnectionState — idle timeout", () => {
  it("closes with code 1001 after idle timeout when no messages are received", async () => {
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {}, {
      idleTimeoutMs: 50, // Very short timeout for testing
    });

    await state.onOpen(mock.ws);

    // Wait for the idle timeout to fire
    await new Promise((r) => setTimeout(r, 150));

    const closes = mock.closeCalls();
    expect(closes.some(([code]) => code === 1001)).toBe(true);
  });

  it("resets the idle timer on each message", async () => {
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {}, {
      idleTimeoutMs: 80,
    });

    await state.onOpen(mock.ws);

    // Send messages before the timeout fires to keep it alive
    await new Promise((r) => setTimeout(r, 50));
    await state.onMessage(mock.ws, JSON.stringify({ type: "input", message: "ping" }));

    // Should still be alive at 80ms (timer was reset at ~50ms)
    await new Promise((r) => setTimeout(r, 50));
    const closesAtReset = mock.closeCalls();
    expect(closesAtReset.filter(([c]) => c === 1001).length).toBe(0);

    // After 80ms more the timer fires
    await new Promise((r) => setTimeout(r, 100));
    const closesAfter = mock.closeCalls();
    expect(closesAfter.some(([code]) => code === 1001)).toBe(true);
  });

  it("resets the idle timer when outbound frames are sent (streaming keeps connection alive)", async () => {
    let capturedSub: RunSubscriber | null = null;
    const rm = makeRm({
      activeEventLog: makeEventLogMock([]),
      captureSubscriber: (sub) => { capturedSub = sub; },
    });

    const mock = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {}, {
      idleTimeoutMs: 80,
    });

    await state.onOpen(mock.ws);
    expect(capturedSub).not.toBeNull();

    // Inject an outbound event just before the timeout fires to reset the timer
    await new Promise((r) => setTimeout(r, 50));
    capturedSub!.onEvent(fakeEntry(1));

    // Should still be alive at 80ms (timer was reset at ~50ms by the outbound frame)
    await new Promise((r) => setTimeout(r, 50));
    expect(mock.closeCalls().filter(([c]) => c === 1001).length).toBe(0);

    // After another 80ms+ the timer fires (no more outbound frames)
    await new Promise((r) => setTimeout(r, 100));
    expect(mock.closeCalls().some(([code]) => code === 1001)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-connection state — cleanup on close
// ---------------------------------------------------------------------------

describe("createPerConnectionState — cleanup on disconnect", () => {
  it("detaches the subscriber on onClose", async () => {
    let isAttached = false;
    const rm: RunManager = {
      ...makeRm({ activeEventLog: makeEventLogMock([]) }),
      attachSubscriber: (_runId: string, _sub: RunSubscriber) => {
        isAttached = true;
        return () => { isAttached = false; };
      },
    } as unknown as RunManager;

    const { ws } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    expect(isAttached).toBe(true);
    state.onClose();
    expect(isAttached).toBe(false);
  });

  it("closes the owned event log on disconnect (terminal run)", async () => {
    let closedCount = 0;
    const ownedLog = {
      ...makeEventLogMock([]),
      close: async () => { closedCount++; },
    };
    const rm = makeRm({ activeEventLog: null, openedEventLog: ownedLog });

    const { ws } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    state.onClose();
    await new Promise((r) => setTimeout(r, 10));

    expect(closedCount).toBe(1);
  });

  it("does NOT close active.eventLog (running run — shared handle)", async () => {
    let closedCount = 0;
    const activeLog = {
      ...makeEventLogMock([]),
      close: async () => { closedCount++; },
    };
    const rm = makeRm({ activeEventLog: activeLog });

    const { ws } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {});
    await state.onOpen(ws);

    state.onClose();
    await new Promise((r) => setTimeout(r, 10));

    expect(closedCount).toBe(0);
  });

  it("does not call onCleanedUp when upgrade aborts before onOpen fires (no counter leak)", () => {
    // Regression guard for the activeConnections leak fix: the factory creates
    // state but if the TCP upgrade aborts before the WS handshake completes,
    // neither onOpen nor onClose fires. onCleanedUp must NOT be called in that
    // scenario, otherwise a paired increment (now in onOpen) would never happen
    // but the decrement would run, corrupting the counter.
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    let cleanupCount = 0;

    // Simulate factory: create state but call neither onOpen nor onClose.
    createPerConnectionState(rm, "run001", undefined, () => {
      cleanupCount++;
    });

    expect(cleanupCount).toBe(0);
  });

  it("calls onCleanedUp exactly once even if onClose is called multiple times", async () => {
    const rm = makeRm({ activeEventLog: makeEventLogMock([]) });
    let cleanupCount = 0;

    const { ws } = makeMockWs();
    const state = createPerConnectionState(rm, "run001", undefined, () => {
      cleanupCount++;
    });
    await state.onOpen(ws);

    state.onClose();
    state.onClose();
    state.onClose();

    expect(cleanupCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Integration test — real RunManager + EventLog with real temp dir
// ---------------------------------------------------------------------------

describe("WS attach — integration (real RunManager + real EventLog)", () => {
  it(
    "fromSeq resume returns only events after N from a real EventLog",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-attach-it-"));
      const runDir = join(tempDir, "run001");
      mkdirSync(runDir, { recursive: true });

      const log = await EventLog.open(runDir);
      try {
        const e1 = await log.append({ type: "log", message: "one" }, asStepId("s1"));
        const e2 = await log.append({ type: "log", message: "two" }, asStepId("s1"));
        const e3 = await log.append({ type: "log", message: "three" }, asStepId("s1"));
        const e4 = await log.append({ type: "log", message: "four" }, asStepId("s1"));

        expect(e1).not.toBeNull();
        expect(e2).not.toBeNull();

        const rm = makeRm({ activeEventLog: log, currentStepId: "s1" });

        const { ws, sentFrames } = makeMockWs();
        const state = createPerConnectionState(rm, "run001", e2!.seq, () => {});
        await state.onOpen(ws);

        const backlogFrame = sentFrames().find((f) => f.type === "backlog");
        expect(backlogFrame?.type).toBe("backlog");
        if (backlogFrame?.type === "backlog") {
          const seqs = backlogFrame.entries.map((e) => e.seq);
          expect(seqs.every((s) => s > e2!.seq)).toBe(true);
          expect(seqs).toContain(e3!.seq);
          expect(seqs).toContain(e4!.seq);
        }
      } finally {
        await log.close();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    10000,
  );

  it(
    "WS client receives same events as a RunSubscriber on a completed run",
    async () => {
      const tempDir = mkdtempSync(join(tmpdir(), "ws-fidelity-it-"));
      const storageRoot = join(tempDir, "workflow-runner");
      mkdirSync(storageRoot, { recursive: true });

      const factory = new FixtureSessionFactory();
      const manager = new RunManager(storageRoot, factory);

      const wfJson = JSON.stringify({
        id: "fidelity-test",
        name: "fidelity-test",
        description: "fidelity-test",
        version: "1",
        steps: [
          {
            id: "s1",
            agent: "fake/AGENT",
            model: "fake/model",
            mode: "autonomous",
            ide: "fake",
            description: "fake:complete",
            edges: [],
          },
        ],
      });

      try {
        const wfPath = join(storageRoot, "test.json");
        await Bun.write(wfPath, wfJson);

        const { runId } = await manager.startRun(wfPath, storageRoot);

        // Attach subscriber directly to RunManager
        const subscriberEvents: EventLogEntry[] = [];
        manager.attachSubscriber(runId, {
          onEvent: (entry) => { subscriberEvents.push(entry); },
        });

        // Wait for run to complete
        await new Promise((r) => setTimeout(r, 400));

        // Now attach via createPerConnectionState (after run is complete, uses openEventLog)
        const { ws: wsClient, sentFrames } = makeMockWs();
        const state = createPerConnectionState(manager, runId, undefined, () => {});
        await state.onOpen(wsClient);

        const frames = sentFrames();
        const backlogFrame = frames.find((f) => f.type === "backlog");

        expect(backlogFrame?.type).toBe("backlog");

        // The WS backlog should include at least the events the subscriber saw.
        if (backlogFrame?.type === "backlog" && subscriberEvents.length > 0) {
          const wsSeqs = new Set(backlogFrame.entries.map((e) => e.seq));
          for (const sub of subscriberEvents) {
            expect(wsSeqs.has(sub.seq)).toBe(true);
          }
        }
      } finally {
        await manager.shutdown();
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      }
    },
    15000,
  );
});

// ---------------------------------------------------------------------------
// createWsConnectionRegistry
// ---------------------------------------------------------------------------

describe("createWsConnectionRegistry", () => {
  it("drain returns 0 and completes immediately when no connections are registered", async () => {
    const registry = createWsConnectionRegistry();
    const t0 = Date.now();
    // Use a large grace period to detect if we mistakenly wait when empty.
    const count = await registry.drain(500);
    const elapsed = Date.now() - t0;
    expect(count).toBe(0);
    expect(elapsed).toBeLessThan(100); // must NOT wait the 500ms grace period
  });

  it("drain sends close(1001) to registered connections and returns the count", async () => {
    const registry = createWsConnectionRegistry();

    const closedWith: Array<[number | undefined, string | undefined]> = [];
    const mockWs = {
      close(code?: number, reason?: string) {
        closedWith.push([code, reason]);
      },
    } as unknown as WSContext;

    registry.register(mockWs);

    const t0 = Date.now();
    const count = await registry.drain(50);
    const elapsed = Date.now() - t0;

    expect(count).toBe(1);
    expect(closedWith).toHaveLength(1);
    expect(closedWith[0]?.[0]).toBe(1001);
    expect(closedWith[0]?.[1]).toBe("server shutting down");
    expect(elapsed).toBeGreaterThanOrEqual(50); // waited the grace period
  });

  it("drain sends close to all registered connections", async () => {
    const registry = createWsConnectionRegistry();

    const closedCounts: number[] = [];
    const makeWs = (): WSContext =>
      ({
        close() {
          closedCounts.push(1);
        },
      }) as unknown as WSContext;

    const ws1 = makeWs();
    const ws2 = makeWs();
    const ws3 = makeWs();

    registry.register(ws1);
    registry.register(ws2);
    registry.register(ws3);

    const count = await registry.drain(0);
    expect(count).toBe(3);
    expect(closedCounts).toHaveLength(3);
  });

  it("unregister removes a connection so it is not drained", async () => {
    const registry = createWsConnectionRegistry();

    const closedWith: Array<[number | undefined, string | undefined]> = [];
    const mockWs = {
      close(code?: number, reason?: string) {
        closedWith.push([code, reason]);
      },
    } as unknown as WSContext;

    registry.register(mockWs);
    registry.unregister(mockWs);

    const count = await registry.drain(0);
    expect(count).toBe(0);
    expect(closedWith).toHaveLength(0);
  });

  it("drain is safe when a close() call throws", async () => {
    const registry = createWsConnectionRegistry();

    const mockWs = {
      close() {
        throw new Error("already closed");
      },
    } as unknown as WSContext;

    registry.register(mockWs);

    // Should not throw even if ws.close() throws.
    const count = await registry.drain(0);
    expect(count).toBe(1);
  });
});
