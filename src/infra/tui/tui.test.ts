import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRenderer, MockInput } from "@opentui/core/testing";

import { Tui } from "./tui.js";
import type { TuiEventSource } from "./event-source.js";
import type { RunnerEvent, RunSummary } from "../../domain/runner.js";
import { asStepId } from "../../domain/ids.js";
import type { Step } from "../../domain/workflow.js";

const sid = asStepId;

interface SourceCallLog {
  subscribeCalls: number;
  unsubscribeCalls: number;
  sendInputCalls: string[];
  detachCalls: number;
}

interface FakeSource extends TuiEventSource {
  emit(event: RunnerEvent): void;
  calls: SourceCallLog;
}

function makeFakeSource(): FakeSource {
  const calls: SourceCallLog = {
    subscribeCalls: 0,
    unsubscribeCalls: 0,
    sendInputCalls: [],
    detachCalls: 0,
  };
  let observer: ((event: RunnerEvent) => void) | null = null;

  return {
    calls,
    subscribe(o) {
      calls.subscribeCalls++;
      observer = o;
      return () => {
        calls.unsubscribeCalls++;
        observer = null;
      };
    },
    async sendInput(text) {
      calls.sendInputCalls.push(text);
    },
    async detach() {
      calls.detachCalls++;
    },
    emit(event) {
      if (observer) observer(event);
    },
  };
}

interface HookCapture {
  exits: number[];
  banners: string[];
}

function makeHookCapture(): HookCapture & {
  hooks: { exit: (code: number) => void; writeBanner: (m: string) => void };
} {
  const capture: HookCapture = { exits: [], banners: [] };
  return {
    ...capture,
    get exits() {
      return capture.exits;
    },
    get banners() {
      return capture.banners;
    },
    hooks: {
      exit: (code) => {
        capture.exits.push(code);
      },
      writeBanner: (m) => {
        capture.banners.push(m);
      },
    },
  };
}

const sampleStep: Step = {
  id: sid("step-1"),
  agent: "test-agent",
  model: "test-model",
  mode: "autonomous",
  description: "Test step",
  ide: "vscode",
  edges: [],
};

const sampleSummary: RunSummary = {
  visited: [sid("step-1")],
  finishMessage: "done",
  durationMs: 1234,
};

async function makeTui(renderer: TestRenderer, hooks?: ReturnType<typeof makeHookCapture>) {
  const tui = await Tui.create({
    renderer,
    hooks: hooks?.hooks ?? {
      exit: () => {},
      writeBanner: () => {},
    },
  });
  return tui;
}

describe("Tui.attachSource", () => {
  let renderer: TestRenderer;
  let mockInput: MockInput;
  let renderOnce: () => Promise<void>;
  let captureCharFrame: () => string;

  beforeEach(async () => {
    const created = await createTestRenderer({ width: 80, height: 24 });
    renderer = created.renderer;
    mockInput = created.mockInput;
    renderOnce = created.renderOnce;
    captureCharFrame = created.captureCharFrame;
  });

  afterEach(() => {
    try {
      renderer.destroy();
    } catch {
      // ignore — some tests may already destroy via shutdown
    }
  });

  it("registers a subscription via source.subscribe and the returned detach tears it down", async () => {
    const tui = await makeTui(renderer);
    const source = makeFakeSource();

    const detach = tui.attachSource(source);
    expect(source.calls.subscribeCalls).toBe(1);
    expect(source.calls.unsubscribeCalls).toBe(0);

    detach();
    expect(source.calls.unsubscribeCalls).toBe(1);
  });

  it("throws when attaching twice without detaching first", async () => {
    const tui = await makeTui(renderer);
    const source = makeFakeSource();
    tui.attachSource(source);
    expect(() => tui.attachSource(makeFakeSource())).toThrow(
      /already attached/,
    );
  });

  it("delivers source events into onEvent in arrival order without crashing on a 50-event burst", async () => {
    const tui = await makeTui(renderer);
    const source = makeFakeSource();
    tui.attachSource(source);

    // Deliver 50 events synchronously — backlog burst.
    for (let i = 0; i < 50; i++) {
      const evt: RunnerEvent =
        i % 3 === 0
          ? { type: "log", message: `log ${i}` }
          : i % 3 === 1
            ? { type: "stream", kind: "message", chunk: `chunk ${i}` }
            : { type: "status", text: `status ${i}` };
      source.emit(evt);
    }

    // Now deliver a live event (out-of-order vs historical timestamps but in arrival order).
    source.emit({ type: "log", message: "live event" });

    // No crash; render should succeed; input field still accepts focus.
    await renderOnce();
    // Snapshot of input field acceptance: rendering doesn't throw, frame produced.
    const frame = captureCharFrame();
    expect(frame.length).toBeGreaterThan(0);
  });

  it("renders each RunnerEvent type without crashing (snapshot-style)", async () => {
    const tui = await makeTui(renderer);
    const source = makeFakeSource();
    tui.attachSource(source);

    const events: RunnerEvent[] = [
      { type: "banner", step: sampleStep, index: 1 },
      { type: "log", message: "hello" },
      { type: "stream", kind: "message", chunk: "streamed" },
      { type: "stream", kind: "message", chunk: " more" },
      { type: "interactive", enabled: true },
      { type: "status", text: "running" },
      { type: "summary", summary: sampleSummary },
    ];

    for (const e of events) source.emit(e);
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("step-1");
    expect(frame).toContain("hello");
    expect(frame).toContain("streamed more");
    expect(frame).toContain("Workflow completed");
  });
});

describe("Tui.submitInput", () => {
  let renderer: TestRenderer;

  beforeEach(async () => {
    const created = await createTestRenderer({ width: 80, height: 24 });
    renderer = created.renderer;
  });

  afterEach(() => {
    try {
      renderer.destroy();
    } catch {
      // ignore
    }
  });

  it("calls source.sendInput exactly once with the trimmed text", async () => {
    const tui = await makeTui(renderer);
    const source = makeFakeSource();
    tui.attachSource(source);

    await tui.submitInput("  hello world  ");
    expect(source.calls.sendInputCalls).toEqual(["hello world"]);
    expect(source.calls.detachCalls).toBe(0);
  });

  it("ignores empty / whitespace-only input", async () => {
    const tui = await makeTui(renderer);
    const source = makeFakeSource();
    tui.attachSource(source);

    await tui.submitInput("   ");
    expect(source.calls.sendInputCalls).toEqual([]);
  });

  it("typing /detach calls source.detach() exactly once and triggers banner + exit", async () => {
    const hooks = makeHookCapture();
    const tui = await makeTui(renderer, hooks);
    const source = makeFakeSource();
    tui.attachSource(source);

    await tui.submitInput("/detach");

    expect(source.calls.detachCalls).toBe(1);
    expect(source.calls.sendInputCalls).toEqual([]);
    expect(hooks.banners).toEqual([
      "run still alive — `attach` to return",
    ]);
    expect(hooks.exits).toEqual([0]);
  });

  it("typing /quit triggers banner + exit (does NOT call source.detach)", async () => {
    const hooks = makeHookCapture();
    const tui = await makeTui(renderer, hooks);
    const source = makeFakeSource();
    tui.attachSource(source);

    await tui.submitInput("/quit");

    expect(source.calls.detachCalls).toBe(0);
    expect(hooks.banners).toEqual([
      "run still alive — `attach` to return",
    ]);
    expect(hooks.exits).toEqual([0]);
  });

  it("typing /exit triggers banner + exit (does NOT call source.detach)", async () => {
    const hooks = makeHookCapture();
    const tui = await makeTui(renderer, hooks);
    const source = makeFakeSource();
    tui.attachSource(source);

    await tui.submitInput("/exit");

    expect(source.calls.detachCalls).toBe(0);
    expect(hooks.banners).toEqual([
      "run still alive — `attach` to return",
    ]);
    expect(hooks.exits).toEqual([0]);
  });

  it("shutdown banner is idempotent on repeated /quit", async () => {
    const hooks = makeHookCapture();
    const tui = await makeTui(renderer, hooks);
    const source = makeFakeSource();
    tui.attachSource(source);

    await tui.submitInput("/quit");
    await tui.submitInput("/quit");

    expect(hooks.banners.length).toBe(1);
    expect(hooks.exits.length).toBe(1);
  });
});

describe("Tui Ctrl-C handling", () => {
  let renderer: TestRenderer;
  let mockInput: MockInput;

  beforeEach(async () => {
    const created = await createTestRenderer({ width: 80, height: 24 });
    renderer = created.renderer;
    mockInput = created.mockInput;
  });

  afterEach(() => {
    try {
      renderer.destroy();
    } catch {
      // ignore
    }
  });

  it("Ctrl-C triggers shutdown with banner and does NOT call source.detach", async () => {
    const hooks = makeHookCapture();
    const tui = await makeTui(renderer, hooks);
    const source = makeFakeSource();
    tui.attachSource(source);

    mockInput.pressCtrlC();
    // shutdownWithBanner is async because callDetach is false the await is short
    await new Promise((r) => setTimeout(r, 0));

    expect(source.calls.detachCalls).toBe(0);
    expect(hooks.banners).toEqual([
      "run still alive — `attach` to return",
    ]);
    expect(hooks.exits).toEqual([0]);
  });
});
