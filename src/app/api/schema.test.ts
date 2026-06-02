import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRenderer } from "@opentui/core/testing";
import type { RunnerEvent } from "../../domain/runner.js";
import { Tui } from "../../infra/tui/tui.js";
import type { TuiEventSource } from "../../infra/tui/event-source.js";
import {
  RunEventSchema,
  RunSummarySchema,
  RunDetailSchema,
  AttachFrameSchema,
  InputFrameSchema,
  StartRunRequestSchema,
  EventsQuerySchema,
  EventsPageSchema,
  HealthReportSchema,
  DiscoveryFileSchema,
  WorkflowListSchema,
  WorkflowsQuerySchema,
} from "./schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFakeSource(): TuiEventSource & { emit(e: RunnerEvent): void } {
  let observer: ((e: RunnerEvent) => void) | null = null;
  return {
    emit(e) { if (observer) observer(e); },
    subscribe(o) {
      observer = o;
      return () => { observer = null; };
    },
    async sendInput() {},
    async detach() {},
  };
}

// ---------------------------------------------------------------------------
// StartRunRequest
// ---------------------------------------------------------------------------

describe("StartRunRequestSchema", () => {
  it("accepts a valid body", () => {
    const result = StartRunRequestSchema.safeParse({ workflowPath: "/wf.json", cwd: "/home/user" });
    expect(result.success).toBe(true);
  });

  it("rejects a body missing cwd", () => {
    const result = StartRunRequestSchema.safeParse({ workflowPath: "/wf.json" });
    expect(result.success).toBe(false);
  });

  it("rejects a body missing workflowPath", () => {
    const result = StartRunRequestSchema.safeParse({ cwd: "/home/user" });
    expect(result.success).toBe(false);
  });

  it("rejects empty workflowPath", () => {
    const result = StartRunRequestSchema.safeParse({ workflowPath: "", cwd: "/home/user" });
    expect(result.success).toBe(false);
  });

  it("rejects empty cwd", () => {
    const result = StartRunRequestSchema.safeParse({ workflowPath: "/wf.json", cwd: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EventsQuery
// ---------------------------------------------------------------------------

describe("EventsQuerySchema", () => {
  it("accepts empty params (all optional)", () => {
    const result = EventsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromSeq).toBeUndefined();
      expect(result.data.stepId).toBeUndefined();
    }
  });

  it("coerces fromSeq string to a non-negative integer", () => {
    const result = EventsQuerySchema.safeParse({ fromSeq: "42" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromSeq).toBe(42);
    }
  });

  it("coerces fromSeq '0' (zero is valid)", () => {
    const result = EventsQuerySchema.safeParse({ fromSeq: "0" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.fromSeq).toBe(0);
    }
  });

  it("rejects negative fromSeq", () => {
    const result = EventsQuerySchema.safeParse({ fromSeq: "-1" });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer fromSeq", () => {
    const result = EventsQuerySchema.safeParse({ fromSeq: "1.5" });
    expect(result.success).toBe(false);
  });

  it("accepts stepId when provided", () => {
    const result = EventsQuerySchema.safeParse({ stepId: "step-1" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stepId).toBe("step-1");
    }
  });

  it("rejects empty stepId", () => {
    const result = EventsQuerySchema.safeParse({ stepId: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AttachFrame
// ---------------------------------------------------------------------------

const sampleRunDetail = {
  id: "run-1",
  slug: "run-slug",
  workflowPath: "/wf.json",
  status: "running" as const,
  currentStepId: "step-1",
  visitedStepIds: ["step-1"],
  startedAt: 1748548800000,
  endedAt: null,
  attachedCount: 1,
};

const sampleRunEvent = {
  seq: 1,
  ts: 1748548800000,
  stepId: "step-1",
  event: { type: "log", message: "hello" },
};

describe("AttachFrameSchema", () => {
  it("parses snapshot variant", () => {
    const frame = { type: "snapshot", snapshot: sampleRunDetail };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  it("parses backlog variant", () => {
    const frame = {
      type: "backlog",
      entries: [sampleRunEvent],
      truncated: false,
    };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  it("parses event variant", () => {
    const frame = { type: "event", entry: sampleRunEvent };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  it("parses status variant", () => {
    const frame = { type: "status", status: "completed" };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  it("parses error variant", () => {
    const frame = { type: "error", code: "UNKNOWN_RUN", message: "Not found" };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown type", () => {
    const frame = { type: "ping" };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  it("rejects status variant with invalid status value", () => {
    const frame = { type: "status", status: "unknown-status" };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });

  it("rejects backlog variant missing truncated", () => {
    const frame = { type: "backlog", entries: [sampleRunEvent] };
    const result = AttachFrameSchema.safeParse(frame);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// InputFrame
// ---------------------------------------------------------------------------

describe("InputFrameSchema", () => {
  it("accepts a valid input frame", () => {
    const result = InputFrameSchema.safeParse({ type: "input", message: "hello" });
    expect(result.success).toBe(true);
  });

  it("rejects empty message", () => {
    const result = InputFrameSchema.safeParse({ type: "input", message: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing message", () => {
    const result = InputFrameSchema.safeParse({ type: "input" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RunEvent
// ---------------------------------------------------------------------------

describe("RunEventSchema", () => {
  it("accepts a real EventLogEntry shape", () => {
    const entry = {
      seq: 1,
      ts: Date.now(),
      stepId: "step-1",
      event: { type: "log", message: "hello" },
    };
    const result = RunEventSchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("accepts a null stepId", () => {
    const entry = {
      seq: 5,
      ts: Date.now(),
      stepId: null,
      event: { type: "summary", summary: { visited: [], finishMessage: "done", durationMs: 1000 } },
    };
    const result = RunEventSchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("rejects an entry missing seq", () => {
    const entry = { ts: Date.now(), stepId: "step-1", event: { type: "log", message: "x" } };
    const result = RunEventSchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("rejects seq = 0 (must be positive)", () => {
    const entry = { seq: 0, ts: Date.now(), stepId: "step-1", event: { type: "log", message: "x" } };
    const result = RunEventSchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("rejects negative seq", () => {
    const entry = { seq: -1, ts: Date.now(), stepId: "step-1", event: { type: "log", message: "x" } };
    const result = RunEventSchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("rejects non-integer seq", () => {
    const entry = { seq: 1.5, ts: Date.now(), stepId: "step-1", event: { type: "log", message: "x" } };
    const result = RunEventSchema.safeParse(entry);
    expect(result.success).toBe(false);
  });

  it("accepts arbitrary event payload (z.unknown)", () => {
    const entry = { seq: 1, ts: Date.now(), stepId: null, event: { type: "custom", data: [1, 2, 3] } };
    const result = RunEventSchema.safeParse(entry);
    expect(result.success).toBe(true);
  });

  it("preserves the event payload reference through parse", () => {
    const eventPayload = { type: "log", message: "exact-match" };
    const entry = { seq: 1, ts: 1748548800000, stepId: "s", event: eventPayload };
    const parsed = RunEventSchema.parse(entry);
    expect(parsed.event).toEqual(eventPayload);
  });
});

// ---------------------------------------------------------------------------
// RunSummary
// ---------------------------------------------------------------------------

describe("RunSummarySchema", () => {
  it("accepts a valid summary", () => {
    const summary = {
      id: "run-abc",
      slug: "abc",
      workflowPath: "/wf.json",
      currentStepId: "step-1",
      status: "running",
      startedAt: 1748548800000,
      endedAt: null,
      attachedCount: 0,
    };
    expect(RunSummarySchema.safeParse(summary).success).toBe(true);
  });

  it("rejects negative attachedCount", () => {
    const summary = {
      id: "run-abc",
      slug: "abc",
      workflowPath: "/wf.json",
      currentStepId: null,
      status: "completed",
      startedAt: 1748548800000,
      endedAt: 1748548801000,
      attachedCount: -1,
    };
    expect(RunSummarySchema.safeParse(summary).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RunDetail
// ---------------------------------------------------------------------------

describe("RunDetailSchema", () => {
  it("accepts a valid detail", () => {
    expect(RunDetailSchema.safeParse(sampleRunDetail).success).toBe(true);
  });

  it("rejects missing visitedStepIds", () => {
    const { visitedStepIds: _, ...rest } = sampleRunDetail;
    expect(RunDetailSchema.safeParse(rest).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// EventsPage
// ---------------------------------------------------------------------------

describe("EventsPageSchema", () => {
  it("accepts entries + truncated", () => {
    const page = { entries: [sampleRunEvent], truncated: false };
    expect(EventsPageSchema.safeParse(page).success).toBe(true);
  });

  it("rejects missing truncated", () => {
    const page = { entries: [sampleRunEvent] };
    expect(EventsPageSchema.safeParse(page).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HealthReport
// ---------------------------------------------------------------------------

describe("HealthReportSchema", () => {
  it("accepts a valid health report", () => {
    const report = { status: "ok", pid: 1234, uptimeMs: 5000, activeRuns: 2, version: "0.1.0" };
    expect(HealthReportSchema.safeParse(report).success).toBe(true);
  });

  it("rejects status other than 'ok'", () => {
    const report = { status: "degraded", pid: 1234, uptimeMs: 5000, activeRuns: 2, version: "0.1.0" };
    expect(HealthReportSchema.safeParse(report).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DiscoveryFile
// ---------------------------------------------------------------------------

describe("DiscoveryFileSchema", () => {
  it("accepts a valid discovery file", () => {
    const file = { pid: 1234, apiPort: 4517, socket: "/tmp/wr.sock" };
    expect(DiscoveryFileSchema.safeParse(file).success).toBe(true);
  });

  it("rejects missing socket", () => {
    const file = { pid: 1234, apiPort: 4517 };
    expect(DiscoveryFileSchema.safeParse(file).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// WorkflowsQuery
// ---------------------------------------------------------------------------

describe("WorkflowsQuerySchema", () => {
  it("accepts a cwd string", () => {
    const result = WorkflowsQuerySchema.safeParse({ cwd: "/home/user/project" });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (cwd is optional)", () => {
    const result = WorkflowsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.cwd).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// WorkflowList
// ---------------------------------------------------------------------------

describe("WorkflowListSchema", () => {
  it("accepts a valid workflow list", () => {
    const result = WorkflowListSchema.safeParse({
      workflows: [
        { name: "who-is.json", path: "/home/user/project/workflows/who-is.json" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an empty workflows array", () => {
    const result = WorkflowListSchema.safeParse({ workflows: [] });
    expect(result.success).toBe(true);
  });

  it("rejects missing workflows field", () => {
    const result = WorkflowListSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects a workflow item missing name", () => {
    const result = WorkflowListSchema.safeParse({
      workflows: [{ path: "/home/user/wf.json" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a workflow item missing path", () => {
    const result = WorkflowListSchema.safeParse({
      workflows: [{ name: "wf.json" }],
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Round-trip conformance test
// ---------------------------------------------------------------------------

describe("RunEvent round-trip conformance", () => {
  let renderer1: TestRenderer;
  let renderer2: TestRenderer;

  beforeEach(async () => {
    const r1 = await createTestRenderer({ width: 80, height: 24 });
    const r2 = await createTestRenderer({ width: 80, height: 24 });
    renderer1 = r1.renderer;
    renderer2 = r2.renderer;
  });

  afterEach(() => {
    try { renderer1.destroy(); } catch {}
    try { renderer2.destroy(); } catch {}
  });

  it("events.jsonl parsed through RunEvent renders identically via TUI (no drift)", async () => {
    const fixturePath = new URL("./__fixtures__/events.jsonl", import.meta.url);
    const content = await Bun.file(fixturePath).text();
    const rawEntries: unknown[] = content
      .trim()
      .split("\n")
      .filter(l => l.trim())
      .map(l => JSON.parse(l));

    // Validate every raw entry parses through RunEvent without error.
    for (const entry of rawEntries) {
      const result = RunEventSchema.safeParse(entry);
      expect(result.success).toBe(true);
    }

    const { renderer: r1, renderOnce: ro1, captureCharFrame: ccf1 } =
      await createTestRenderer({ width: 80, height: 24 });
    const { renderer: r2, renderOnce: ro2, captureCharFrame: ccf2 } =
      await createTestRenderer({ width: 80, height: 24 });

    try {
      const tui1 = await Tui.create({
        renderer: r1,
        hooks: { exit: () => {}, writeBanner: () => {} },
      });
      const tui2 = await Tui.create({
        renderer: r2,
        hooks: { exit: () => {}, writeBanner: () => {} },
      });

      // Direct path: feed entry.event straight to TUI (JSON-RPC / existing path).
      for (const entry of rawEntries) {
        tui1.onEvent((entry as { event: RunnerEvent }).event);
      }

      // Parsed path: parse through RunEvent then feed event to TUI (HTTP/WS path).
      for (const entry of rawEntries) {
        const parsed = RunEventSchema.parse(entry);
        tui2.onEvent(parsed.event as RunnerEvent);
      }

      await ro1();
      await ro2();

      const frame1 = ccf1();
      const frame2 = ccf2();

      // Frames must be identical — any drift in RunEvent payload surfaces here.
      expect(frame2).toEqual(frame1);

      r1.destroy();
      r2.destroy();
    } catch (err) {
      try { r1.destroy(); } catch {}
      try { r2.destroy(); } catch {}
      throw err;
    }
  });

  it("RunEvent.event payload is preserved through parse (deep equality)", () => {
    const events = [
      { seq: 1, ts: 1748548800000, stepId: "s", event: { type: "log", message: "hello", color: "green" } },
      { seq: 2, ts: 1748548800001, stepId: null, event: { type: "status", text: "running" } },
      {
        seq: 3,
        ts: 1748548800002,
        stepId: "s",
        event: { type: "stream", kind: "message", chunk: "text" },
      },
    ];

    for (const entry of events) {
      const parsed = RunEventSchema.parse(entry);
      expect(parsed.event).toEqual(entry.event);
      expect(parsed.seq).toBe(entry.seq);
      expect(parsed.ts).toBe(entry.ts);
      expect(parsed.stepId).toBe(entry.stepId);
    }
  });
});
