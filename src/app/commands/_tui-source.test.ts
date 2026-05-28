import { describe, expect, it } from "bun:test";

import { asRunId } from "../../domain/run.js";
import { asStepId } from "../../domain/ids.js";
import { createMockClient } from "../../infra/client/__tests__/mock-client.js";
import type { RunnerEvent } from "../../domain/runner.js";
import type { EventLogEntry } from "../../infra/daemon/protocol.js";
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

  it("emits a gap-marker log event when droppedEarlyEvents > 0", () => {
    const mock = createMockClient();
    const runId = asRunId("abc123");

    const earlyEvents = [
      {
        runId,
        entry: {
          seq: 1,
          ts: 0,
          stepId: asStepId("step-1"),
          event: { type: "log", message: "early-1" } as RunnerEvent,
        },
      },
    ];

    const source = createTuiEventSource(
      mock.asClient(),
      runId,
      undefined,
      undefined,
      earlyEvents,
      3,
    );

    const received: RunnerEvent[] = [];
    source.subscribe((ev) => received.push(ev));

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual({ type: "log", message: "early-1" });
    // Second event must be the gap marker
    expect(received[1]).toMatchObject({
      type: "log",
      message: expect.stringContaining("3"),
    });
  });

  it("does not emit a gap-marker when droppedEarlyEvents is 0", () => {
    const mock = createMockClient();
    const runId = asRunId("abc123");

    const source = createTuiEventSource(
      mock.asClient(),
      runId,
      undefined,
      undefined,
      [],
      0,
    );

    const received: RunnerEvent[] = [];
    source.subscribe((ev) => received.push(ev));

    expect(received).toHaveLength(0);
  });

  it("replays early events captured before attachLoop's TUI subscribe call", () => {
    const mock = createMockClient();
    const runId = asRunId("abc123");
    const otherRunId = asRunId("zzz999");

    // Simulate events captured during the run.attach RPC
    // (this models the race condition where events arrive in the same TCP
    // segment as the response, before the TUI's subscription is registered).
    // Also simulate an event from a different run (in case the early
    // subscription caught it, e.g., if a prefix matched multiple runs).
    const earlyEvents = [
      {
        runId,
        entry: {
          seq: 1,
          ts: 0,
          stepId: asStepId("step-1"),
          event: { type: "log", message: "early-1" } as RunnerEvent,
        },
      },
      {
        runId,
        entry: {
          seq: 2,
          ts: 0,
          stepId: asStepId("step-1"),
          event: { type: "log", message: "early-2" } as RunnerEvent,
        },
      },
      {
        // This event is for a different run and should be filtered out.
        runId: otherRunId,
        entry: {
          seq: 3,
          ts: 0,
          stepId: null,
          event: { type: "log", message: "wrong-run" } as RunnerEvent,
        },
      },
    ];

    // Simulate the early subscription being active but now complete.
    let earlySubWasCalled = false;
    const earlyUnsubscribe = (): void => {
      earlySubWasCalled = true;
    };

    const source = createTuiEventSource(
      mock.asClient(),
      runId,
      undefined,
      earlyUnsubscribe,
      earlyEvents,
    );

    const received: RunnerEvent[] = [];
    source.subscribe((ev) => received.push(ev));

    // Verify only matching early events were replayed (wrong-run filtered out).
    expect(received).toEqual([
      { type: "log", message: "early-1" },
      { type: "log", message: "early-2" },
    ]);

    // Verify the early subscription was unsubscribed.
    expect(earlySubWasCalled).toBe(true);

    // Verify we can still receive live events.
    mock.emit({
      method: "event.run.event",
      params: {
        runId,
        entry: {
          seq: 100,
          ts: 0,
          stepId: null,
          event: { type: "log", message: "live-event" },
        },
      },
    });
    expect(received).toEqual([
      { type: "log", message: "early-1" },
      { type: "log", message: "early-2" },
      { type: "log", message: "live-event" },
    ]);
  });
});
