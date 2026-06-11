import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asStepId } from "../../../domain/ids.js";
import type {
  RunnerAgentSessionArgs,
  RunnerSessionSink,
  RunnerTools,
} from "../../../domain/runner.js";
import type { Step } from "../../../domain/workflow.js";
import {
  FixtureSessionFactory,
  parseFakeMarker,
} from "./fixture-session-factory.js";

function makeStep(description: string, mode: Step["mode"] = "autonomous"): Step {
  return {
    id: asStepId("step-1"),
    agent: "fake-agent/AGENT",
    description,
    mode,
    ide: "fake",
    model: "fake/model",
    edges: [],
  };
}

function makeArgs(step: Step, cwd = "/tmp"): RunnerAgentSessionArgs {
  const tools: RunnerTools = {
    url: "http://0.0.0.0:0",
    beginStep: () => "tok" as never,
    resetStep: () => {},
  };
  const sink: RunnerSessionSink = {
    log: () => {},
    stream: () => {},
    status: () => {},
    toolCall: () => {},
  };
  return { step, cwd, tools, inboundMessage: null, sink };
}

describe("parseFakeMarker", () => {
  test("recognizes all marker kinds", () => {
    expect(parseFakeMarker("fake:complete")).toEqual({ kind: "complete" });
    expect(parseFakeMarker("fake:handoff step-2")).toEqual({
      kind: "handoff",
      nextStep: "step-2",
    });
    expect(parseFakeMarker("fake:fail boom")).toEqual({
      kind: "fail",
      reason: "boom",
    });
    expect(parseFakeMarker("fake:hang")).toEqual({ kind: "hang" });
    expect(parseFakeMarker("fake:interactive")).toEqual({ kind: "interactive" });
    expect(parseFakeMarker("fake:write shared.txt marker-a")).toEqual({
      kind: "write",
      relPath: "shared.txt",
      content: "marker-a",
    });
  });

  test("fake:write content may contain spaces; missing content defaults to empty", () => {
    expect(parseFakeMarker("fake:write out.txt hello world")).toEqual({
      kind: "write",
      relPath: "out.txt",
      content: "hello world",
    });
    expect(parseFakeMarker("fake:write out.txt")).toEqual({
      kind: "write",
      relPath: "out.txt",
      content: "",
    });
  });

  test("defaults to complete for unknown descriptions", () => {
    expect(parseFakeMarker("some real description")).toEqual({ kind: "complete" });
  });
});

describe("FixtureSession", () => {
  test("fake:complete resolves with finish outcome", async () => {
    const factory = new FixtureSessionFactory();
    const s = await factory.create(makeArgs(makeStep("fake:complete")));
    const o = await s.outcome;
    expect(o).toEqual({ kind: "finish", message: "fake complete" });
  });

  test("fake:write writes content into cwd then resolves with finish", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wfr-fake-write-"));
    try {
      const factory = new FixtureSessionFactory();
      const s = await factory.create(
        makeArgs(makeStep("fake:write nested/shared.txt marker-a"), dir),
      );
      const o = await s.outcome;
      expect(o).toEqual({ kind: "finish", message: "fake write" });
      expect(readFileSync(join(dir, "nested/shared.txt"), "utf8")).toBe("marker-a");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("fake:handoff resolves with handoff outcome and parsed next step", async () => {
    const factory = new FixtureSessionFactory();
    const s = await factory.create(makeArgs(makeStep("fake:handoff step-2")));
    const o = await s.outcome;
    expect(o).toEqual({
      kind: "handoff",
      nextStep: "step-2",
      message: "fake handoff",
    });
  });

  test("fake:fail resolves with failure outcome carrying the reason", async () => {
    const factory = new FixtureSessionFactory();
    const s = await factory.create(makeArgs(makeStep("fake:fail boom")));
    const o = await s.outcome;
    expect(o).toEqual({
      kind: "failure",
      failedStep: "step-1",
      reason: "boom",
    });
  });

  test("fake:hang does not resolve until dispose is called", async () => {
    const factory = new FixtureSessionFactory();
    const s = await factory.create(makeArgs(makeStep("fake:hang")));
    let settled = false;
    s.outcome.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(settled).toBe(false);
    await s.dispose();
    const o = await s.outcome;
    expect(o.kind).toBe("finish");
  });

  test("fake:interactive resolves when sendUserInput is called", async () => {
    const factory = new FixtureSessionFactory();
    const s = await factory.create(makeArgs(makeStep("fake:interactive", "interactive")));
    let settled = false;
    s.outcome.then(() => {
      settled = true;
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(settled).toBe(false);
    await s.sendUserInput("hello");
    const o = await s.outcome;
    expect(o).toEqual({ kind: "finish", message: "fake interactive: hello" });
  });

  test("override forces every step to follow the override marker", async () => {
    const factory = new FixtureSessionFactory("complete");
    const s = await factory.create(makeArgs(makeStep("fake:hang")));
    const o = await s.outcome;
    expect(o.kind).toBe("finish");
  });
});
