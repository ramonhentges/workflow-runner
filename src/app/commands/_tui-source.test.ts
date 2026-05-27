import { describe, expect, it } from "bun:test";

import { asRunId } from "../../domain/run.js";
import { asStepId } from "../../domain/ids.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import type { RunnerEvent } from "../../domain/runner.js";
import { createTuiEventSource } from "./_tui-source.js";

describe("_tui-source", () => {
  it("subscribe() delivers entry.event to the observer for matching run notifications", () => {
    const mock = createMockClient();
    const runId = asRunId("abc123");
    const otherRunId = asRunId("zzz999");
    const source = createTuiEventSource(mock.asClient(), runId);

    const received: RunnerEvent[] = [];
    const unsubscribe = source.subscribe((ev) => received.push(ev));

    // Matching run, matching method.
    mock.emit({
      method: "event.run.event",
      params: {
        runId,
        entry: {
          seq: 1,
          ts: 100,
          stepId: asStepId("step-1"),
          event: { type: "log", message: "hello" },
        },
      },
    });
    // Different run — must be filtered out.
    mock.emit({
      method: "event.run.event",
      params: {
        runId: otherRunId,
        entry: {
          seq: 2,
          ts: 200,
          stepId: null,
          event: { type: "log", message: "wrong run" },
        },
      },
    });
    // Status change — must not be delivered as a RunnerEvent.
    mock.emit({
      method: "event.run.statusChanged",
      params: { runId, status: "completed" },
    });

    expect(received).toEqual([{ type: "log", message: "hello" } as RunnerEvent]);
    unsubscribe();
  });

  it("sendInput() calls run.send with the given message exactly once", async () => {
    const mock = createMockClient({
      responders: {
        "run.send": () => ({ acceptedSeq: 7 }),
      },
    });
    const runId = asRunId("abc123");
    const source = createTuiEventSource(mock.asClient(), runId);

    await source.sendInput("hi");

    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toEqual({
      method: "run.send",
      params: { runId, message: "hi" },
    });
  });

  it("detach() invokes the unsubscribe returned from client.subscribe", async () => {
    const mock = createMockClient();
    const runId = asRunId("abc123");
    const source = createTuiEventSource(mock.asClient(), runId);

    const received: RunnerEvent[] = [];
    source.subscribe((ev) => received.push(ev));
    expect(mock.subscriptions).toHaveLength(1);
    expect(mock.subscriptions[0].active).toBe(true);

    await source.detach();
    expect(mock.subscriptions[0].active).toBe(false);

    // Subsequent emits don't reach the observer.
    mock.emit({
      method: "event.run.event",
      params: {
        runId,
        entry: {
          seq: 1,
          ts: 0,
          stepId: null,
          event: { type: "log", message: "after-detach" },
        },
      },
    });
    expect(received).toEqual([]);
  });
});
