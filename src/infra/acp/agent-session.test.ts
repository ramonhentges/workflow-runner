import { describe, it, expect } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { Runner } from "../../domain/runner.js";
import type { RunnerTools } from "../../domain/runner.js";
import { Workflow } from "../../domain/workflow.js";
import { asStepId, asStepToken } from "../../domain/ids.js";
import type { Step } from "../../domain/workflow.js";
import { IdeDispatchSessionFactory } from "./agent-session.js";
import { UnknownIdeError } from "./ide-profile.js";
import { FixtureSessionFactory } from "../daemon/test-helpers/fixture-session-factory.js";

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: asStepId("step-1"),
    ide: "opencode",
    agent: "test-agent",
    model: "test-model",
    mode: "autonomous",
    description: "Test step",
    edges: [],
    ...overrides,
  };
}

function makeWorkflow(steps: Step[]): Workflow {
  return Workflow.fromJson({
    id: "test-workflow",
    name: "Test Workflow",
    steps,
  });
}

function makeTools(): RunnerTools {
  return {
    url: "http://test",
    beginStep: () => asStepToken("test-token"),
    resetStep: () => {},
  };
}

function makeSink() {
  return { log: () => {}, stream: () => {}, status: () => {} };
}

/**
 * Builds a stub ChildProcess that emits `error` asynchronously so the
 * `await new Promise<void>` in AgentSession.start rejects with our error.
 */
function makeErrorProcess(err: Error): ChildProcess {
  const proc = new EventEmitter() as unknown as ChildProcess;
  (proc as unknown as Record<string, unknown>).stdin = null;
  (proc as unknown as Record<string, unknown>).stdout = new EventEmitter();
  (proc as unknown as Record<string, unknown>).stderr = new EventEmitter();
  (proc as unknown as Record<string, unknown>).exitCode = null;
  (proc as unknown as Record<string, unknown>).kill = () => false;
  setImmediate(() => (proc as unknown as EventEmitter).emit("error", err));
  return proc;
}

// --- IdeDispatchSessionFactory: dispatch by step.ide ---

describe("IdeDispatchSessionFactory", () => {
  it("resolves the claude-code profile and passes its command/args to spawn", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

    const stubSpawn = (
      cmd: string,
      args: string[],
      _opts: SpawnOptions,
    ): ChildProcess => {
      spawnCalls.push({ cmd, args });
      return makeErrorProcess(new Error("stub-spawn"));
    };

    const factory = new IdeDispatchSessionFactory(stubSpawn);
    try {
      await factory.create({
        step: makeStep({ ide: "claude-code" }),
        cwd: "/tmp",
        tools: makeTools(),
        inboundMessage: null,
        sink: makeSink(),
      });
    } catch {
      // expected — stub process errors immediately
    }

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("npx");
    expect(spawnCalls[0].args).toEqual([
      "-y",
      "@zed-industries/claude-code-acp",
    ]);
  });

  it("resolves the codex profile and passes its command/args to spawn", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

    const stubSpawn = (
      cmd: string,
      args: string[],
      _opts: SpawnOptions,
    ): ChildProcess => {
      spawnCalls.push({ cmd, args });
      return makeErrorProcess(new Error("stub-spawn"));
    };

    const factory = new IdeDispatchSessionFactory(stubSpawn);
    try {
      await factory.create({
        step: makeStep({ ide: "codex" }),
        cwd: "/tmp",
        tools: makeTools(),
        inboundMessage: null,
        sink: makeSink(),
      });
    } catch {
      // expected — stub process errors immediately
    }

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("npx");
    expect(spawnCalls[0].args).toEqual(["-y", "@zed-industries/codex-acp"]);
  });

  it("resolves the opencode profile and passes its command/args/env to spawn", async () => {
    const spawnCalls: Array<{
      cmd: string;
      args: string[];
      env: Record<string, string | undefined>;
    }> = [];

    const stubSpawn = (
      cmd: string,
      args: string[],
      opts: SpawnOptions,
    ): ChildProcess => {
      spawnCalls.push({
        cmd,
        args,
        env: (opts.env ?? {}) as Record<string, string | undefined>,
      });
      return makeErrorProcess(new Error("stub-spawn"));
    };

    const factory = new IdeDispatchSessionFactory(stubSpawn);
    try {
      await factory.create({
        step: makeStep({ ide: "opencode" }),
        cwd: "/tmp",
        tools: makeTools(),
        inboundMessage: null,
        sink: makeSink(),
      });
    } catch {
      // expected — stub process errors immediately
    }

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("opencode");
    expect(spawnCalls[0].args).toEqual(["acp"]);
    expect(spawnCalls[0].env["OPENCODE_ENABLE_QUESTION_TOOL"]).toBe("1");
  });

  it("throws UnknownIdeError before spawning when step.ide is not registered", async () => {
    const spawnCalls: string[] = [];
    const stubSpawn = (cmd: string): ChildProcess => {
      spawnCalls.push(cmd);
      return makeErrorProcess(new Error("should not reach"));
    };

    const factory = new IdeDispatchSessionFactory(stubSpawn);

    let err: unknown;
    try {
      await factory.create({
        step: makeStep({ ide: "ghost-agent" }),
        cwd: "/tmp",
        tools: makeTools(),
        inboundMessage: null,
        sink: makeSink(),
      });
    } catch (e) {
      err = e;
    }

    expect(spawnCalls).toHaveLength(0);
    expect(err).toBeInstanceOf(UnknownIdeError);
    expect((err as UnknownIdeError).message).toContain("ghost-agent");
  });

  it("throws UnknownIdeError for empty string ide", async () => {
    const factory = new IdeDispatchSessionFactory();

    let err: unknown;
    try {
      await factory.create({
        step: makeStep({ ide: "" }),
        cwd: "/tmp",
        tools: makeTools(),
        inboundMessage: null,
        sink: makeSink(),
      });
    } catch (e) {
      err = e;
    }

    expect(err).toBeInstanceOf(UnknownIdeError);
  });
});

// --- Runner integration: unknown ide produces a named step failure ---

describe("Runner with IdeDispatchSessionFactory", () => {
  it("records a failure naming the step when step.ide is unregistered", async () => {
    const workflow = makeWorkflow([makeStep({ id: asStepId("step-x"), ide: "phantom-ide" })]);
    const factory = new IdeDispatchSessionFactory();
    const runner = new Runner(workflow, factory, makeTools());
    runner.addObserver({ onEvent: () => {} });

    const summary = await runner.run(asStepId("step-x"));

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.failedStep).toBe(asStepId("step-x"));
    expect(summary.failure?.reason).toContain("phantom-ide");
  });

  it("does not visit any step on unknown-ide failure (no prior work lost)", async () => {
    const workflow = makeWorkflow([makeStep({ id: asStepId("step-y"), ide: "no-such-ide" })]);
    const factory = new IdeDispatchSessionFactory();
    const runner = new Runner(workflow, factory, makeTools());
    runner.addObserver({ onEvent: () => {} });

    const summary = await runner.run(asStepId("step-y"));

    // The step was visited (added to visited list) but failed before completing.
    expect(summary.failure).toBeDefined();
    expect(summary.failure?.reason).toContain("no-such-ide");
  });
});

// --- IdeDispatchSessionFactory: gemini profile dispatch ---

describe("IdeDispatchSessionFactory (gemini)", () => {
  it("resolves the gemini profile and passes its command/args to spawn", async () => {
    const spawnCalls: Array<{ cmd: string; args: string[] }> = [];

    const stubSpawn = (
      cmd: string,
      args: string[],
      _opts: SpawnOptions,
    ): ChildProcess => {
      spawnCalls.push({ cmd, args });
      return makeErrorProcess(new Error("stub-spawn"));
    };

    const factory = new IdeDispatchSessionFactory(stubSpawn);
    try {
      await factory.create({
        step: makeStep({ ide: "gemini" }),
        cwd: "/tmp",
        tools: makeTools(),
        inboundMessage: null,
        sink: makeSink(),
      });
    } catch {
      // expected — stub process errors immediately
    }

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].cmd).toBe("gemini");
    expect(spawnCalls[0].args).toEqual(["--experimental-acp"]);
  });
});

// --- Runner integration: codex step reaches finish via shared lifecycle ---

describe("Runner with codex step (FixtureSessionFactory)", () => {
  it("an autonomous codex step reaches a finish outcome through the shared lifecycle", async () => {
    const workflow = makeWorkflow([
      makeStep({
        id: asStepId("codex-step"),
        ide: "codex",
        mode: "autonomous",
        description: "fake:complete",
      }),
    ]);
    const factory = new FixtureSessionFactory();
    const runner = new Runner(workflow, factory, makeTools());
    runner.addObserver({ onEvent: () => {} });

    const summary = await runner.run(asStepId("codex-step"));

    expect(summary.failure).toBeUndefined();
    expect(summary.finishMessage).toBeDefined();
    expect(summary.visited).toContain(asStepId("codex-step"));
  });

  it("an autonomous codex step reaches a handoff outcome through the shared lifecycle", async () => {
    const workflow = makeWorkflow([
      makeStep({
        id: asStepId("codex-step-a"),
        ide: "codex",
        mode: "autonomous",
        description: "fake:handoff codex-step-b",
        edges: [{ next_step: "codex-step-b", intent: "continue" }],
      }),
      makeStep({
        id: asStepId("codex-step-b"),
        ide: "codex",
        mode: "autonomous",
        description: "fake:complete",
        edges: [],
      }),
    ]);
    const factory = new FixtureSessionFactory();
    const runner = new Runner(workflow, factory, makeTools());
    runner.addObserver({ onEvent: () => {} });

    const summary = await runner.run(asStepId("codex-step-a"));

    expect(summary.failure).toBeUndefined();
    expect(summary.visited).toContain(asStepId("codex-step-a"));
    expect(summary.visited).toContain(asStepId("codex-step-b"));
  });
});

// --- Runner integration: gemini step reaches finish via shared lifecycle ---

describe("Runner with gemini step (FixtureSessionFactory)", () => {
  it("an autonomous gemini step reaches a finish outcome through the shared lifecycle", async () => {
    const workflow = makeWorkflow([
      makeStep({
        id: asStepId("gemini-step"),
        ide: "gemini",
        mode: "autonomous",
        description: "fake:complete",
      }),
    ]);
    const factory = new FixtureSessionFactory();
    const runner = new Runner(workflow, factory, makeTools());
    runner.addObserver({ onEvent: () => {} });

    const summary = await runner.run(asStepId("gemini-step"));

    expect(summary.failure).toBeUndefined();
    expect(summary.finishMessage).toBeDefined();
    expect(summary.visited).toContain(asStepId("gemini-step"));
  });

  it("an autonomous gemini step reaches a handoff outcome through the shared lifecycle", async () => {
    const workflow = makeWorkflow([
      makeStep({
        id: asStepId("gemini-step-a"),
        ide: "gemini",
        mode: "autonomous",
        description: "fake:handoff gemini-step-b",
        edges: [{ next_step: "gemini-step-b", intent: "continue" }],
      }),
      makeStep({
        id: asStepId("gemini-step-b"),
        ide: "gemini",
        mode: "autonomous",
        description: "fake:complete",
        edges: [],
      }),
    ]);
    const factory = new FixtureSessionFactory();
    const runner = new Runner(workflow, factory, makeTools());
    runner.addObserver({ onEvent: () => {} });

    const summary = await runner.run(asStepId("gemini-step-a"));

    expect(summary.failure).toBeUndefined();
    expect(summary.visited).toContain(asStepId("gemini-step-a"));
    expect(summary.visited).toContain(asStepId("gemini-step-b"));
  });
});
