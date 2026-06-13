import { expect, describe, it, beforeEach, afterEach } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRenderer, MockInput } from "@opentui/core/testing";

import { Tui } from "./tui.js";
import type { TimerHandle, TuiClock } from "./tui.js";
import type { TuiEventSource } from "./event-source.js";
import type {
  RunnerEvent,
  RunSummary,
  ToolCallStatus,
  ToolCallView,
} from "../../domain/runner.js";
import { asStepId } from "../../domain/ids.js";
import type { Step } from "../../domain/workflow.js";
import { SPINNER_FRAMES } from "./tool-call-format.js";

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

describe("Tui.setIsolation", () => {
  let renderer: TestRenderer;
  let renderOnce: () => Promise<void>;
  let captureCharFrame: () => string;

  beforeEach(async () => {
    const created = await createTestRenderer({ width: 80, height: 24 });
    renderer = created.renderer;
    renderOnce = created.renderOnce;
    captureCharFrame = created.captureCharFrame;
  });

  afterEach(() => {
    try {
      renderer.destroy();
    } catch {
      // ignore
    }
  });

  it("renders branch and worktree in the header for an isolated snapshot", async () => {
    const tui = await makeTui(renderer);
    tui.setIsolation({ branch: "feat/iso", worktreePath: "/tmp/wt-iso" });
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("branch feat/iso");
    expect(frame).toContain("worktree /tmp/wt-iso");
  });

  it("renders only branch when worktree is absent", async () => {
    const tui = await makeTui(renderer);
    tui.setIsolation({ branch: "feat/iso" });
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("branch feat/iso");
    expect(frame).not.toContain("worktree");
  });

  it("shows no isolation segment for a non-isolated snapshot", async () => {
    const tui = await makeTui(renderer);
    tui.setIsolation({});
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).not.toContain("branch");
    expect(frame).not.toContain("worktree");
    expect(frame).not.toContain("↳");
  });

  it("clears a previously shown isolation segment when re-set empty", async () => {
    const tui = await makeTui(renderer);
    tui.setIsolation({ branch: "feat/iso", worktreePath: "/tmp/wt-iso" });
    await renderOnce();
    expect(captureCharFrame()).toContain("branch feat/iso");

    tui.setIsolation({});
    await renderOnce();
    const frame = captureCharFrame();
    expect(frame).not.toContain("branch feat/iso");
    expect(frame).not.toContain("worktree");
  });
});

describe("Tui.showInitialPrompt", () => {
  let renderer: TestRenderer;
  let renderOnce: () => Promise<void>;
  let captureCharFrame: () => string;

  beforeEach(async () => {
    const created = await createTestRenderer({ width: 80, height: 24 });
    renderer = created.renderer;
    renderOnce = created.renderOnce;
    captureCharFrame = created.captureCharFrame;
  });

  afterEach(() => {
    try {
      renderer.destroy();
    } catch {
      // ignore
    }
  });

  it("renders the prompt text as the opening transcript entry when present", async () => {
    const tui = await makeTui(renderer);
    tui.showInitialPrompt("review PR #42");
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("> review PR #42");
  });

  it("renders no prompt entry when initialPrompt is absent (frame unchanged)", async () => {
    const tui = await makeTui(renderer);
    await renderOnce();
    const before = captureCharFrame();

    tui.showInitialPrompt(undefined);
    await renderOnce();

    expect(captureCharFrame()).toBe(before);
  });

  it("renders no prompt entry for an empty-string prompt (frame unchanged)", async () => {
    const tui = await makeTui(renderer);
    await renderOnce();
    const before = captureCharFrame();

    tui.showInitialPrompt("");
    await renderOnce();

    expect(captureCharFrame()).toBe(before);
  });
});

describe("Tui attach-flow wiring (initialPrompt + isolation)", () => {
  let renderer: TestRenderer;
  let renderOnce: () => Promise<void>;
  let captureCharFrame: () => string;

  beforeEach(async () => {
    const created = await createTestRenderer({ width: 80, height: 24 });
    renderer = created.renderer;
    renderOnce = created.renderOnce;
    captureCharFrame = created.captureCharFrame;
  });

  afterEach(() => {
    try {
      renderer.destroy();
    } catch {
      // ignore
    }
  });

  // Replicates the attach loop's wiring order (setIsolation -> showInitialPrompt
  // -> attachSource) since `_attach-loop.ts` itself is excluded from unit
  // coverage (it boots a real @opentui terminal renderer).
  it("shows the prompt as the opening entry above backlog, with isolation in the header", async () => {
    const tui = await makeTui(renderer);
    const initialSnapshot = {
      branch: "feat/iso",
      worktreePath: "/tmp/wt-iso",
      initialPrompt: "ship the initial prompt feature",
    };

    tui.setIsolation(initialSnapshot);
    tui.showInitialPrompt(initialSnapshot.initialPrompt);

    const source = makeFakeSource();
    tui.attachSource(source);
    source.emit({ type: "log", message: "first backlog line" });
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("> ship the initial prompt feature");
    expect(frame).toContain("branch feat/iso");
    expect(frame).toContain("worktree /tmp/wt-iso");
    // Opening entry: the prompt precedes replayed backlog in the transcript.
    expect(frame.indexOf("> ship the initial prompt feature")).toBeLessThan(
      frame.indexOf("first backlog line"),
    );
  });

  it("leaves the transcript empty when the snapshot has no initialPrompt", async () => {
    const tui = await makeTui(renderer);
    const initialSnapshot: { branch?: string; initialPrompt?: string } = {
      branch: "feat/iso",
    };

    tui.setIsolation(initialSnapshot);
    tui.showInitialPrompt(initialSnapshot.initialPrompt);
    await renderOnce();

    const frame = captureCharFrame();
    expect(frame).toContain("branch feat/iso");
    expect(frame).not.toContain(">");
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

interface FakeClock {
  clock: TuiClock;
  cleared: { timeouts: number; intervals: number };
  fireTimeouts(): void;
  tickIntervals(): void;
  activeTimeouts(): number;
  activeIntervals(): number;
}

function makeFakeClock(): FakeClock {
  let nextId = 1;
  const timeouts = new Map<number, () => void>();
  const intervals = new Map<number, () => void>();
  const cleared = { timeouts: 0, intervals: 0 };
  const asHandle = (id: number) => id as unknown as TimerHandle;
  const asId = (handle: TimerHandle) => handle as unknown as number;

  return {
    cleared,
    clock: {
      setTimeout(fn) {
        const id = nextId++;
        timeouts.set(id, fn);
        return asHandle(id);
      },
      clearTimeout(handle) {
        if (timeouts.delete(asId(handle))) cleared.timeouts++;
      },
      setInterval(fn) {
        const id = nextId++;
        intervals.set(id, fn);
        return asHandle(id);
      },
      clearInterval(handle) {
        if (intervals.delete(asId(handle))) cleared.intervals++;
      },
    },
    fireTimeouts() {
      for (const [id, fn] of [...timeouts]) {
        timeouts.delete(id);
        fn();
      }
    },
    tickIntervals() {
      for (const fn of [...intervals.values()]) fn();
    },
    activeTimeouts() {
      return timeouts.size;
    },
    activeIntervals() {
      return intervals.size;
    },
  };
}

function toolCallEvent(
  toolCallId: string,
  status: ToolCallStatus,
  title: string,
  errorText?: string,
): RunnerEvent {
  const call: ToolCallView = {
    toolCallId,
    status,
    kind: "execute",
    title,
    ...(errorText !== undefined ? { errorText } : {}),
  };
  return { type: "tool_call", call };
}

const occurrences = (haystack: string, needle: string) =>
  haystack.split(needle).length - 1;

describe("Tui tool_call rendering", () => {
  let renderer: TestRenderer;
  let renderOnce: () => Promise<void>;
  let captureCharFrame: () => string;

  beforeEach(async () => {
    const created = await createTestRenderer({ width: 80, height: 24 });
    renderer = created.renderer;
    renderOnce = created.renderOnce;
    captureCharFrame = created.captureCharFrame;
  });

  afterEach(() => {
    try {
      renderer.destroy();
    } catch {
      // ignore
    }
  });

  async function makeAttached(clock: TuiClock) {
    const tui = await Tui.create({
      renderer,
      hooks: { exit: () => {}, writeBanner: () => {} },
      clock,
    });
    const source = makeFakeSource();
    tui.attachSource(source);
    return { tui, source };
  }

  it("folds pending→in_progress→completed for one id into a single completed line", async () => {
    const fc = makeFakeClock();
    const { source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "pending", "Bash: npm test"));
    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: npm test"));
    source.emit(toolCallEvent("tc-1", "completed", "Bash: npm test"));
    await renderOnce();

    const frame = captureCharFrame();
    // One tracked renderable, mutated in place — the title appears exactly once.
    expect(occurrences(frame, "Bash: npm test")).toBe(1);
    expect(frame).toContain("✓ Bash: npm test");
  });

  it("renders a failed call with its error suffix", async () => {
    const fc = makeFakeClock();
    const { source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "failed", "Bash: npm test", "exit code 1"));
    await renderOnce();

    expect(captureCharFrame()).toContain("✗ Bash: npm test — exit code 1");
  });

  it("clears the tool-call map on banner so a re-seen id creates a new line", async () => {
    const fc = makeFakeClock();
    const { source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "completed", "Read file.ts"));
    source.emit({ type: "banner", step: sampleStep, index: 2 });
    source.emit(toolCallEvent("tc-1", "completed", "Read file.ts"));
    await renderOnce();

    // Map reset on banner: the second event appends a new line instead of
    // mutating the first, so the title now appears twice in the scroll log.
    expect(occurrences(captureCharFrame(), "Read file.ts")).toBe(2);
  });

  it("schedules the spinner behind the appearance delay, not immediately", async () => {
    const fc = makeFakeClock();
    const { source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: build"));

    expect(fc.activeTimeouts()).toBe(1);
    expect(fc.activeIntervals()).toBe(0);

    fc.fireTimeouts(); // appearance delay elapses
    expect(fc.activeIntervals()).toBe(1);
  });

  it("never starts the spinner for a call that settles before the delay", async () => {
    const fc = makeFakeClock();
    const { source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: quick"));
    source.emit(toolCallEvent("tc-1", "completed", "Bash: quick"));

    fc.fireTimeouts(); // delay fires, but nothing is in progress anymore
    expect(fc.activeIntervals()).toBe(0);
  });

  it("animates a long-running call with a braille frame once the interval ticks", async () => {
    const fc = makeFakeClock();
    const { source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: long"));
    fc.fireTimeouts(); // start interval
    fc.tickIntervals(); // advance one frame
    await renderOnce();

    const frame = captureCharFrame();
    const animated = SPINNER_FRAMES.some((f) =>
      frame.includes(`${f} Bash: long`),
    );
    expect(animated).toBe(true);
  });

  it("stops the interval after the last in_progress call settles", async () => {
    const fc = makeFakeClock();
    const { source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: long"));
    fc.fireTimeouts();
    expect(fc.activeIntervals()).toBe(1);

    source.emit(toolCallEvent("tc-1", "completed", "Bash: long"));
    fc.tickIntervals(); // tick sees nothing in progress → stops itself
    expect(fc.activeIntervals()).toBe(0);
  });

  it("stops the spinner interval on detach (no leaked timer)", async () => {
    const fc = makeFakeClock();
    const { tui, source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: build"));
    fc.fireTimeouts();
    expect(fc.activeIntervals()).toBe(1);

    tui.detach();
    expect(fc.activeIntervals()).toBe(0);
    expect(fc.cleared.intervals).toBeGreaterThanOrEqual(1);
  });

  it("stops the spinner interval on shutdown (no leaked timer)", async () => {
    const fc = makeFakeClock();
    const { tui, source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: build"));
    fc.fireTimeouts();
    expect(fc.activeIntervals()).toBe(1);

    tui.shutdown();
    expect(fc.activeIntervals()).toBe(0);
  });

  it("cancels a pending appearance delay on detach before the spinner starts", async () => {
    const fc = makeFakeClock();
    const { tui, source } = await makeAttached(fc.clock);

    source.emit(toolCallEvent("tc-1", "in_progress", "Bash: build"));
    expect(fc.activeTimeouts()).toBe(1);

    tui.detach();
    expect(fc.activeTimeouts()).toBe(0);
    expect(fc.cleared.timeouts).toBeGreaterThanOrEqual(1);
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
