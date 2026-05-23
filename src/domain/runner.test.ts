import { expect, describe, it } from "bun:test";
import { Runner, formatRunSummary } from "./runner.js";
import type {
  RunSummary,
  RunnerObserver,
  RunnerAgentSession,
  RunnerAgentSessionArgs,
  RunnerAgentSessionFactory,
  RunnerTools,
} from "./runner.js";
import type { StepOutcome } from "./outcome.js";
import { Workflow } from "./workflow.js";
import { asStepId, asStepToken, type StepId } from "./ids.js";
import type { Step } from "./workflow.js";
import { buildKickoffPrompt } from "../infra/acp/agent-session.js";

const sid = asStepId;

const stepShape = (id: string, overrides: Partial<Step> = {}): Step => ({
  id: sid(id),
  agent: "test-agent",
  model: "test-model",
  mode: "autonomous",
  description: "Test step",
  ide: "vscode",
  edges: [],
  ...overrides,
});

function makeWorkflow(steps: Step[]): Workflow {
  return Workflow.fromJson({
    id: "test-workflow",
    name: "Test Workflow",
    description: "A test workflow",
    version: "1.0.0",
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

const noopObserver: RunnerObserver = { onEvent: () => {} };

describe("formatRunSummary", () => {
  it("formats a successful run with single step", () => {
    const summary: RunSummary = {
      visited: [sid("step-1")],
      finishMessage: "Task completed",
      durationMs: 5000,
    };
    const formatted = formatRunSummary(summary);
    expect(formatted).toContain("Workflow completed:");
    expect(formatted).toContain("- step-1");
    expect(formatted).toContain("Finish message: Task completed");
    expect(formatted).toContain("Duration: 5.0s");
  });

  it("formats a successful run with multiple steps in order", () => {
    const summary: RunSummary = {
      visited: [sid("step-1"), sid("step-3"), sid("step-2")],
      finishMessage: "All done",
      durationMs: 12000,
    };
    const formatted = formatRunSummary(summary);
    expect(formatted).toContain("Workflow completed:");
    expect(formatted).toContain("- step-1");
    expect(formatted).toContain("- step-3");
    expect(formatted).toContain("- step-2");
    expect(formatted).toContain("Finish message: All done");
    expect(formatted).toContain("Duration: 12.0s");
    const step1Idx = formatted.indexOf("- step-1");
    const step3Idx = formatted.indexOf("- step-3");
    const step2Idx = formatted.indexOf("- step-2");
    expect(step1Idx < step3Idx).toBe(true);
    expect(step3Idx < step2Idx).toBe(true);
  });

  it("formats a run with no finish message", () => {
    const summary: RunSummary = {
      visited: [sid("step-1")],
      finishMessage: "",
      durationMs: 3000,
    };
    const formatted = formatRunSummary(summary);
    expect(formatted).toContain("Workflow completed:");
    expect(formatted).toContain("- step-1");
    expect(formatted).not.toContain("Finish message:");
    expect(formatted).toContain("Duration: 3.0s");
  });

  it("formats a failed run with failure reason", () => {
    const summary: RunSummary = {
      visited: [sid("step-1"), sid("step-2")],
      finishMessage: "",
      durationMs: 7000,
      failure: {
        failedStep: sid("step-2"),
        reason: "Agent crashed unexpectedly",
      },
    };
    const formatted = formatRunSummary(summary);
    expect(formatted).toContain("Workflow halted at step 'step-2'");
    expect(formatted).toContain("Reason: Agent crashed unexpectedly");
    expect(formatted).not.toContain("Workflow completed:");
    expect(formatted).not.toContain("Finish message:");
    expect(formatted).toContain("Duration: 7.0s");
  });

  it("formats a failed run with undeclared handoff target", () => {
    const summary: RunSummary = {
      visited: [sid("step-1")],
      finishMessage: "",
      durationMs: 2000,
      failure: {
        failedStep: sid("step-1"),
        reason: "'step-999' is not a valid target from step 'step-1'",
      },
    };
    const formatted = formatRunSummary(summary);
    expect(formatted).toContain("Workflow halted at step 'step-1'");
    expect(formatted).toContain("'step-999' is not a valid target");
    expect(formatted).toContain("Duration: 2.0s");
  });

  it("formats duration in seconds with decimals", () => {
    const summary: RunSummary = {
      visited: [sid("step-1")],
      finishMessage: "Done",
      durationMs: 1234,
    };
    expect(formatRunSummary(summary)).toContain("Duration: 1.2s");
  });

  it("formats very short durations", () => {
    const summary: RunSummary = {
      visited: [sid("step-1")],
      finishMessage: "Done",
      durationMs: 50,
    };
    expect(formatRunSummary(summary)).toContain("Duration: 0.1s");
  });

  it("returns a string with proper formatting", () => {
    const summary: RunSummary = {
      visited: [sid("step-a")],
      finishMessage: "Complete",
      durationMs: 4500,
    };
    const formatted = formatRunSummary(summary);
    expect(typeof formatted).toBe("string");
    expect(formatted.length).toBeGreaterThan(0);
    expect(formatted.includes("\n")).toBe(true);
  });
});

describe("buildKickoffPrompt", () => {
  it("places interactive instruction before description", () => {
    const step = stepShape("test", { mode: "interactive", description: "Do the thing" });
    const result = buildKickoffPrompt(step, null);
    expect(result).toStartWith(
      "This is an interactive step — you must ask the user to approve a handoff or finish before completing.\n\nDo the thing",
    );
  });

  it("places autonomous instruction before description", () => {
    const step = stepShape("test", { mode: "autonomous", description: "Do the thing" });
    const result = buildKickoffPrompt(step, null);
    expect(result).toStartWith(
      "This is an autonomous step — after completing the work, **call handoff (if continuing to a next step is appropriate) or finish with a summary**. Do NOT wait for user approval — you must resolve the outcome yourself.\n\nDo the thing",
    );
  });

  it("appends inbound context after description when present", () => {
    const step = stepShape("test", { mode: "interactive", description: "Do the thing" });
    const result = buildKickoffPrompt(step, "Previous result");
    expect(result).toBe(
      "This is an interactive step — you must ask the user to approve a handoff or finish before completing.\n\nDo the thing\n\nContext from previous step: Previous result",
    );
  });

  it("orders sections: instruction, description, context", () => {
    const step = stepShape("test", { mode: "autonomous", description: "Middle" });
    const result = buildKickoffPrompt(step, "Last");
    const instructionIdx = result.indexOf("autonomous step");
    const descIdx = result.indexOf("Middle");
    const contextIdx = result.indexOf("Last");
    expect(instructionIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(contextIdx);
  });

  it("does not include context when inboundMessage is null", () => {
    const step = stepShape("test", { mode: "autonomous" });
    const result = buildKickoffPrompt(step, null);
    expect(result).not.toContain("Context from previous step");
  });
});

interface FakeSessionConfig {
  resolveOutcome?: (step: Step) => StepOutcome | Promise<StepOutcome>;
  rejectWith?: (step: Step) => Error;
  onCreate?: (args: RunnerAgentSessionArgs) => void;
}

function makeFakeSessionFactory(cfg: FakeSessionConfig): RunnerAgentSessionFactory {
  return {
    create: async (args) => {
      cfg.onCreate?.(args);
      const outcomePromise: Promise<StepOutcome> = cfg.rejectWith
        ? Promise.reject(cfg.rejectWith(args.step))
        : Promise.resolve(cfg.resolveOutcome!(args.step));

      const session: RunnerAgentSession = {
        mode: args.step.mode,
        outcome: outcomePromise,
        sendUserInput: async () => {},
        dispose: async () => {},
      };
      return session;
    },
  };
}

describe("Runner.run orchestration", () => {
  it("executes a single-step workflow that finishes", async () => {
    const workflow = makeWorkflow([stepShape("step-1")]);
    const factory = makeFakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "All done" }),
    });
    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    runner.addObserver(noopObserver);

    const summary = await runner.run(sid("step-1"));

    expect(summary.visited).toEqual([sid("step-1")]);
    expect(summary.finishMessage).toBe("All done");
    expect(summary.failure).toBeUndefined();
  });

  it("executes a handoff chain across multiple steps", async () => {
    const step1 = stepShape("step-1", {
      edges: [{ next_step: sid("step-2"), intent: "go to step 2" }],
    });
    const step2 = stepShape("step-2");
    const workflow = makeWorkflow([step1, step2]);
    const executionOrder: StepId[] = [];

    const factory = makeFakeSessionFactory({
      onCreate: (args) => executionOrder.push(args.step.id),
      resolveOutcome: (step): StepOutcome =>
        step.id === sid("step-1")
          ? { kind: "handoff", nextStep: sid("step-2"), message: "Context for step 2" }
          : { kind: "finish", message: "Done" },
    });

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    const summary = await runner.run(sid("step-1"));

    expect(executionOrder).toEqual([sid("step-1"), sid("step-2")]);
    expect(summary.visited).toEqual([sid("step-1"), sid("step-2")]);
    expect(summary.finishMessage).toBe("Done");
  });

  it("fails when starting step does not exist", async () => {
    const workflow = makeWorkflow([stepShape("step-1")]);
    const factory = makeFakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "" }),
    });
    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });

    const summary = await runner.run(sid("nonexistent"));
    expect(summary.failure).toBeDefined();
    expect(summary.failure?.failedStep).toBe(sid("nonexistent"));
    expect(summary.failure?.reason).toContain("not found");
    expect(summary.visited).toEqual([]);
  });

  it("fails when handoff target is invalid (step not in workflow)", async () => {
    const workflow = makeWorkflow([stepShape("step-1")]);
    const factory = makeFakeSessionFactory({
      resolveOutcome: () => ({
        kind: "handoff",
        nextStep: sid("nonexistent-step"),
        message: "Going to invalid step",
      }),
    });

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    const summary = await runner.run(sid("step-1"));

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.failedStep).toBe(sid("nonexistent-step"));
    expect(summary.failure?.reason).toContain("not found");
  });

  it("propagates failure outcome from step", async () => {
    const workflow = makeWorkflow([stepShape("step-1")]);
    const factory = makeFakeSessionFactory({
      resolveOutcome: () => ({
        kind: "failure",
        failedStep: sid("step-1"),
        reason: "'step-999' is not a valid target from step 'step-1'",
      }),
    });

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    const summary = await runner.run(sid("step-1"));

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.failedStep).toBe(sid("step-1"));
    expect(summary.failure?.reason).toContain("not a valid target");
    expect(summary.visited).toEqual([sid("step-1")]);
  });

  it("preserves inbound message through handoff chain", async () => {
    const step1 = stepShape("step-1", {
      edges: [{ next_step: sid("step-2"), intent: "go to step 2" }],
    });
    const step2 = stepShape("step-2");
    const workflow = makeWorkflow([step1, step2]);

    const captured: { inbound: string | null } = { inbound: null };
    const factory: RunnerAgentSessionFactory = {
      create: async (args) => {
        if (args.step.id === sid("step-2")) captured.inbound = args.inboundMessage;
        const outcome: StepOutcome =
          args.step.id === sid("step-1")
            ? {
                kind: "handoff",
                nextStep: sid("step-2"),
                message: "Important context",
              }
            : { kind: "finish", message: "Received and processed" };
        return {
          mode: args.step.mode,
          outcome: Promise.resolve(outcome),
          sendUserInput: async () => {},
          dispose: async () => {},
        };
      },
    };

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    const summary = await runner.run(sid("step-1"));

    expect(summary.visited).toEqual([sid("step-1"), sid("step-2")]);
    expect(summary.finishMessage).toBe("Received and processed");
    expect(captured.inbound).toBe("Important context");
  });

  it("treats session creation failure as step failure", async () => {
    const workflow = makeWorkflow([stepShape("step-1")]);
    const factory = makeFakeSessionFactory({
      rejectWith: () => new Error("Subprocess exited with code 127"),
    });

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    const summary = await runner.run(sid("step-1"));

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.reason).toContain("Subprocess exited with code 127");
  });

  it("detects step cycles and halts with appropriate message", async () => {
    const step1 = stepShape("step-1", {
      edges: [{ next_step: sid("step-2"), intent: "go to step 2" }],
    });
    const step2 = stepShape("step-2", {
      edges: [{ next_step: sid("step-1"), intent: "go to step 1" }],
    });
    const workflow = makeWorkflow([step1, step2]);
    let count = 0;
    const factory = makeFakeSessionFactory({
      resolveOutcome: (step): StepOutcome => {
        count++;
        return {
          kind: "handoff",
          nextStep: step.id === sid("step-1") ? sid("step-2") : sid("step-1"),
          message: "Continuing cycle",
        };
      },
    });

    const runner = new Runner(workflow, factory, makeTools(), {
      cwd: "/tmp",
      maxIterations: 5,
    });
    const summary = await runner.run(sid("step-1"));

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.reason).toContain("Exceeded maximum iterations");
    expect(summary.failure?.reason).toContain("Possible step cycle detected");
    expect(count).toBe(5);
  });

  it("uses default maxIterations based on step count", async () => {
    const step1 = stepShape("step-1", {
      edges: [{ next_step: sid("step-2"), intent: "go to step 2" }],
    });
    const step2 = stepShape("step-2", {
      edges: [{ next_step: sid("step-1"), intent: "go to step 1" }],
    });
    const workflow = makeWorkflow([step1, step2]);
    let count = 0;
    const factory = makeFakeSessionFactory({
      resolveOutcome: (step): StepOutcome => {
        count++;
        return {
          kind: "handoff",
          nextStep: step.id === sid("step-1") ? sid("step-2") : sid("step-1"),
          message: "Continuing cycle",
        };
      },
    });

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    const summary = await runner.run(sid("step-1"));

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.reason).toContain("Exceeded maximum iterations");
    expect(count).toBe(20);
  });

  it("emits banner/status/interactive/summary events to observers", async () => {
    const workflow = makeWorkflow([stepShape("step-1", { mode: "interactive" })]);
    const factory = makeFakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "ok" }),
    });

    const events: string[] = [];
    const observer: RunnerObserver = {
      onEvent: (e) => {
        events.push(e.type);
      },
    };

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    runner.addObserver(observer);
    await runner.run(sid("step-1"));

    expect(events).toContain("banner");
    expect(events).toContain("status");
    expect(events).toContain("interactive");
    expect(events).toContain("summary");
  });

  it("multiple observers all receive events", async () => {
    const workflow = makeWorkflow([stepShape("step-1")]);
    const factory = makeFakeSessionFactory({
      resolveOutcome: () => ({ kind: "finish", message: "ok" }),
    });
    const a: string[] = [];
    const b: string[] = [];
    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    runner.addObserver({
      onEvent: (e) => {
        a.push(e.type);
      },
    });
    runner.addObserver({
      onEvent: (e) => {
        b.push(e.type);
      },
    });
    await runner.run(sid("step-1"));
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("provideInput forwards to the active interactive session", async () => {
    const inputState: { received: string | null } = { received: null };
    const workflow = makeWorkflow([stepShape("step-1", { mode: "interactive" })]);

    const factory: RunnerAgentSessionFactory = {
      create: async (args) => {
        let resolveOutcome: (o: StepOutcome) => void;
        const outcome = new Promise<StepOutcome>((r) => {
          resolveOutcome = r;
        });
        const session: RunnerAgentSession = {
          mode: args.step.mode,
          outcome,
          sendUserInput: async (text: string) => {
            inputState.received = text;
            resolveOutcome!({ kind: "finish", message: "got input" });
          },
          dispose: async () => {},
        };
        return session;
      },
    };

    const runner = new Runner(workflow, factory, makeTools(), { cwd: "/tmp" });
    const runPromise = runner.run(sid("step-1"));

    // Drive an input after a microtask to ensure session is active.
    await new Promise((r) => setTimeout(r, 5));
    await runner.provideInput("hello");

    const summary = await runPromise;
    expect(inputState.received).toBe("hello");
    expect(summary.finishMessage).toBe("got input");
  });
});
