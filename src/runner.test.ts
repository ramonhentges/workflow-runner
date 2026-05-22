import { expect, describe, it } from "bun:test";
import { buildKickoffPrompt, formatRunSummary, runWorkflow } from "./runner.js";
import type { RunSummary, RunnerUi } from "./runner.js";
import type { WorkflowMcpServer, StepOutcome } from "./mcp.js";
import type { Step } from "./workflow.js";

describe("formatRunSummary", () => {
  it("formats a successful run with single step", () => {
    const summary: RunSummary = {
      visited: ["step-1"],
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
      visited: ["step-1", "step-3", "step-2"],
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
      visited: ["step-1"],
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
      visited: ["step-1", "step-2"],
      finishMessage: "",
      durationMs: 7000,
      failure: {
        failedStep: "step-2",
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
      visited: ["step-1"],
      finishMessage: "",
      durationMs: 2000,
      failure: {
        failedStep: "step-1",
        reason: "'step-999' is not a valid target from step 'step-1'",
      },
    };

    const formatted = formatRunSummary(summary);

    expect(formatted).toContain("Workflow halted at step 'step-1'");
    expect(formatted).toContain("'step-999' is not a valid target");
    expect(formatted).toContain("Duration: 2.0s");
  });

  it("formats a failed run with autonomous step that didn't call tool", () => {
    const summary: RunSummary = {
      visited: ["step-1", "step-2"],
      finishMessage: "",
      durationMs: 8000,
      failure: {
        failedStep: "step-2",
        reason:
          "Autonomous step completed without calling handoff or finish",
      },
    };

    const formatted = formatRunSummary(summary);

    expect(formatted).toContain("Workflow halted at step 'step-2'");
    expect(formatted).toContain(
      "Autonomous step completed without calling handoff or finish",
    );
    expect(formatted).toContain("Duration: 8.0s");
  });

  it("formats duration in seconds with decimals", () => {
    const summary: RunSummary = {
      visited: ["step-1"],
      finishMessage: "Done",
      durationMs: 1234,
    };

    const formatted = formatRunSummary(summary);

    expect(formatted).toContain("Duration: 1.2s");
  });

  it("formats very short durations", () => {
    const summary: RunSummary = {
      visited: ["step-1"],
      finishMessage: "Done",
      durationMs: 50,
    };

    const formatted = formatRunSummary(summary);

    expect(formatted).toContain("Duration: 0.1s");
  });

  it("formats subprocess exit failure", () => {
    const summary: RunSummary = {
      visited: ["step-1"],
      finishMessage: "",
      durationMs: 1500,
      failure: {
        failedStep: "step-1",
        reason: "Subprocess exited with code 1",
      },
    };

    const formatted = formatRunSummary(summary);

    expect(formatted).toContain("Workflow halted at step 'step-1'");
    expect(formatted).toContain("Subprocess exited with code 1");
  });

  it("returns a string with proper formatting", () => {
    const summary: RunSummary = {
      visited: ["step-a"],
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
  const makeStep = (overrides: Partial<Step> = {}): Step => ({
    id: "test",
    agent: "test-agent",
    model: "test-model",
    mode: "autonomous",
    description: "Do the thing",
    ide: "vscode",
    edges: [],
    ...overrides,
  });

  it("places interactive instruction before description", () => {
    const step = makeStep({ mode: "interactive" });
    const result = buildKickoffPrompt(step, null);
    expect(result).toStartWith(
      "This is an interactive step — you must ask the user to approve a handoff or finish before completing.\n\nDo the thing",
    );
  });

  it("places autonomous instruction before description", () => {
    const step = makeStep({ mode: "autonomous" });
    const result = buildKickoffPrompt(step, null);
    expect(result).toStartWith(
      "This is an autonomous step — after completing the work, **call handoff (if continuing to a next step is appropriate) or finish with a summary**. Do NOT wait for user approval — you must resolve the outcome yourself.\n\nDo the thing",
    );
  });

  it("appends inbound context after description when present", () => {
    const step = makeStep({ mode: "interactive" });
    const result = buildKickoffPrompt(step, "Previous result");
    expect(result).toBe(
      "This is an interactive step — you must ask the user to approve a handoff or finish before completing.\n\nDo the thing\n\nContext from previous step: Previous result",
    );
  });

  it("orders sections: instruction, description, context", () => {
    const step = makeStep({ mode: "autonomous", description: "Middle" });
    const result = buildKickoffPrompt(step, "Last");
    const instructionIdx = result.indexOf("autonomous step");
    const descIdx = result.indexOf("Middle");
    const contextIdx = result.indexOf("Last");
    expect(instructionIdx).toBeLessThan(descIdx);
    expect(descIdx).toBeLessThan(contextIdx);
  });

  it("does not include context when inboundMessage is null", () => {
    const step = makeStep({ mode: "autonomous" });
    const result = buildKickoffPrompt(step, null);
    expect(result).not.toContain("Context from previous step");
  });
});

describe("runWorkflow orchestration", () => {
  const makeStep = (id: string): Step => ({
    id,
    agent: "test-agent",
    model: "test-model",
    mode: "autonomous",
    description: "Test step",
    ide: "vscode",
    edges: [],
  });

  const makeWorkflow = (steps: Step[]) => ({
    id: "test-workflow",
    name: "Test Workflow",
    description: "A test workflow",
    version: "1.0.0",
    steps,
  });

  const makeMcpServer = (
    beginStepHandler?: (step: Step, resolve: (outcome: StepOutcome) => void) => void,
  ): WorkflowMcpServer => ({
    url: "http://test",
    beginStep: (step, resolve) => {
      if (beginStepHandler) {
        beginStepHandler(step, resolve);
      }
      return "test-token";
    },
    resetStep: () => {},
    close: async () => {},
  });

  it("executes a single-step workflow that finishes", async () => {
    const step1 = makeStep("step-1");
    const workflow = makeWorkflow([step1]);
    const mcp = makeMcpServer((step, resolve) => {
      resolve({ kind: "finish", message: "All done" });
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(summary.visited).toEqual(["step-1"]);
    expect(summary.finishMessage).toBe("All done");
    expect(summary.failure).toBeUndefined();
  });

  it("executes a handoff chain across multiple steps", async () => {
    const step1 = makeStep("step-1");
    const step2 = makeStep("step-2");
    step1.edges = [{ next_step: "step-2", intent: "Continue to step 2" }];

    const workflow = makeWorkflow([step1, step2]);
    const executionOrder: string[] = [];

    const mcp = makeMcpServer((step, resolve) => {
      executionOrder.push(step.id);
      if (step.id === "step-1") {
        resolve({
          kind: "handoff",
          nextStep: "step-2",
          message: "Context for step 2",
        });
      } else {
        resolve({ kind: "finish", message: "Done" });
      }
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(executionOrder).toEqual(["step-1", "step-2"]);
    expect(summary.visited).toEqual(["step-1", "step-2"]);
    expect(summary.finishMessage).toBe("Done");
  });

  it("fails when starting step does not exist", async () => {
    const workflow = makeWorkflow([]);
    const mcp = makeMcpServer();

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "nonexistent",
      cwd: "/tmp",
      mcp,
      ui,
    });

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.failedStep).toBe("nonexistent");
    expect(summary.failure?.reason).toContain("not found");
    expect(summary.visited).toEqual([]);
  });

  it("fails when handoff target is invalid", async () => {
    const step1 = makeStep("step-1");
    const workflow = makeWorkflow([step1]);
    const mcp = makeMcpServer((_step, resolve) => {
      resolve({
        kind: "handoff",
        nextStep: "nonexistent-step",
        message: "Going to invalid step",
      });
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.failedStep).toBe("nonexistent-step");
    expect(summary.failure?.reason).toContain("not found");
  });

  it("propagates failure outcome from step", async () => {
    const step1 = makeStep("step-1");
    const workflow = makeWorkflow([step1]);
    const mcp = makeMcpServer((_step, resolve) => {
      resolve({
        kind: "failure",
        failedStep: "step-1",
        reason: "'step-999' is not a valid target from step 'step-1'",
      });
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.failedStep).toBe("step-1");
    expect(summary.failure?.reason).toContain("not a valid target");
    expect(summary.visited).toEqual(["step-1"]);
  });

  it("preserves inbound message through handoff chain", async () => {
    const step1 = makeStep("step-1");
    const step2 = makeStep("step-2");
    step1.edges = [{ next_step: "step-2", intent: "Continue to step 2" }];

    const workflow = makeWorkflow([step1, step2]);
    const mcp = makeMcpServer((step, resolve) => {
      if (step.id === "step-1") {
        resolve({
          kind: "handoff",
          nextStep: "step-2",
          message: "Important context",
        });
      } else {
        resolve({ kind: "finish", message: "Received and processed" });
      }
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(summary.visited).toEqual(["step-1", "step-2"]);
    expect(summary.finishMessage).toBe("Received and processed");
  });

  it("handles subprocess exit race condition", async () => {
    const step1 = makeStep("step-1");
    const workflow = makeWorkflow([step1]);
    const mcp = makeMcpServer();

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async () => {
      const mockProcess = {
        kill: () => {},
        once: (event: string, callback: (code: number) => void) => {
          if (event === "exit") {
            setTimeout(() => callback(127), 10);
          }
        },
      } as any;

      return {
        process: mockProcess,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise: new Promise(() => {}),
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.reason).toContain("Subprocess exited with code 127");
  });

  it("detects step cycles and halts with appropriate message", async () => {
    const step1 = makeStep("step-1");
    const step2 = makeStep("step-2");
    step1.edges = [{ next_step: "step-2", intent: "Go to step 2" }];
    step2.edges = [{ next_step: "step-1", intent: "Go to step 1" }];

    const workflow = makeWorkflow([step1, step2]);
    const iterationCount = { count: 0 };

    const mcp = makeMcpServer((step, resolve) => {
      iterationCount.count++;
      resolve({
        kind: "handoff",
        nextStep: step.id === "step-1" ? "step-2" : "step-1",
        message: "Continuing cycle",
      });
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      maxIterations: 5,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.reason).toContain("Exceeded maximum iterations");
    expect(summary.failure?.reason).toContain("Possible step cycle detected");
    expect(iterationCount.count).toBe(5);
  });

  it("resets currentInputHandler handle after step completes", async () => {
    const step1 = makeStep("step-1");
    const workflow = makeWorkflow([step1]);
    const mcp = makeMcpServer((_step, resolve) => {
      resolve({ kind: "finish", message: "Done" });
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const currentInputHandler = { handle: async () => {} };
    const originalHandle = currentInputHandler.handle;

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      currentInputHandler,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(currentInputHandler.handle).not.toBe(originalHandle);
  });

  it("uses default maxIterations based on step count", async () => {
    const step1 = makeStep("step-1");
    const step2 = makeStep("step-2");
    step1.edges = [{ next_step: "step-2", intent: "Go to step 2" }];
    step2.edges = [{ next_step: "step-1", intent: "Go to step 1" }];

    const workflow = makeWorkflow([step1, step2]);
    const iterationCount = { count: 0 };

    const mcp = makeMcpServer((step, resolve) => {
      iterationCount.count++;
      resolve({
        kind: "handoff",
        nextStep: step.id === "step-1" ? "step-2" : "step-1",
        message: "Continuing cycle",
      });
    });

    const ui: RunnerUi = {
      banner: () => {},
      log: () => {},
      appendStream: () => {},
      setInteractive: () => {},
      setStatus: () => {},
      summary: () => {},
    };

    const mockSessionFactory = async (
      step: Step,
      cwd: string,
      mcp: WorkflowMcpServer,
    ) => {
      const outcomePromise = new Promise<StepOutcome>((resolve) => {
        mcp.beginStep(step, resolve);
      });

      return {
        process: { kill: () => {} } as any,
        connection: {} as any,
        sessionId: "test-session",
        outcomePromise,
      };
    };

    const summary = await runWorkflow({
      workflow,
      startStepId: "step-1",
      cwd: "/tmp",
      mcp,
      ui,
      _testSessionFactory: mockSessionFactory as any,
    });

    expect(summary.failure).toBeDefined();
    expect(summary.failure?.reason).toContain("Exceeded maximum iterations");
    expect(iterationCount.count).toBe(20);
  });
});
