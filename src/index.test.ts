import { describe, it, expect } from "bun:test";
import { parseCliArgs, resolveEntryStep } from "./index.js";
import type { Workflow } from "./workflow.js";

describe("parseCliArgs", () => {
  it("requires a workflow path argument", () => {
    const result = parseCliArgs(["node", "script.js"]);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Usage:");
    expect(result.workflowPath).toBe("");
  });

  it("parses workflow path as argv[2]", () => {
    const result = parseCliArgs(["node", "script.js", "workflows/test.json"]);
    expect(result.error).toBeUndefined();
    expect(result.workflowPath).toBe("workflows/test.json");
    expect(result.startStepId).toBeNull();
  });

  it("parses --start flag with step id", () => {
    const result = parseCliArgs([
      "node",
      "script.js",
      "workflows/test.json",
      "--start",
      "step-2",
    ]);
    expect(result.error).toBeUndefined();
    expect(result.workflowPath).toBe("workflows/test.json");
    expect(result.startStepId).toBe("step-2");
  });

  it("ignores --start without a step id", () => {
    const result = parseCliArgs([
      "node",
      "script.js",
      "workflows/test.json",
      "--start",
    ]);
    expect(result.workflowPath).toBe("workflows/test.json");
    expect(result.startStepId).toBeNull();
  });

  it("ignores unknown flags", () => {
    const result = parseCliArgs([
      "node",
      "script.js",
      "workflows/test.json",
      "--unknown",
      "value",
    ]);
    expect(result.workflowPath).toBe("workflows/test.json");
    expect(result.startStepId).toBeNull();
  });
});

describe("resolveEntryStep", () => {
  const testWorkflow: Workflow = {
    id: "test",
    name: "Test",
    description: "Test workflow",
    version: "1.0",
    steps: [
      {
        id: "step-1",
        agent: "agent1",
        description: "First step",
        mode: "interactive",
        ide: "opencode",
        model: "model1",
        edges: [],
      },
      {
        id: "step-2",
        agent: "agent2",
        description: "Second step",
        mode: "autonomous",
        ide: "opencode",
        model: "model2",
        edges: [],
      },
      {
        id: "step-3",
        agent: "agent3",
        description: "Third step",
        mode: "interactive",
        ide: "opencode",
        model: "model3",
        edges: [],
      },
    ],
  };

  it("returns first step when no --start is provided", () => {
    const result = resolveEntryStep(testWorkflow, null);
    expect(result.error).toBeUndefined();
    expect(result.stepId).toBe("step-1");
  });

  it("returns the specified step with --start", () => {
    const result = resolveEntryStep(testWorkflow, "step-2");
    expect(result.error).toBeUndefined();
    expect(result.stepId).toBe("step-2");
  });

  it("returns last step when specified", () => {
    const result = resolveEntryStep(testWorkflow, "step-3");
    expect(result.error).toBeUndefined();
    expect(result.stepId).toBe("step-3");
  });

  it("returns error when --start step does not exist", () => {
    const result = resolveEntryStep(testWorkflow, "step-99");
    expect(result.error).toBeDefined();
    expect(result.error).toContain("step-99");
    expect(result.error).toContain("not found");
    expect(result.stepId).toBe("");
  });

  it("handles empty workflow gracefully", () => {
    const emptyWorkflow: Workflow = {
      id: "empty",
      name: "Empty",
      description: "Empty workflow",
      version: "1.0",
      steps: [],
    };
    const result = resolveEntryStep(emptyWorkflow, null);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("no steps");
    expect(result.stepId).toBe("");
  });

  it("respects exact step id match", () => {
    const result = resolveEntryStep(testWorkflow, "step-1");
    expect(result.error).toBeUndefined();
    expect(result.stepId).toBe("step-1");
  });

  it("does not match partial step ids", () => {
    const result = resolveEntryStep(testWorkflow, "step");
    expect(result.error).toBeDefined();
    expect(result.stepId).toBe("");
  });

  it("does not match with case variation", () => {
    const result = resolveEntryStep(testWorkflow, "Step-1");
    expect(result.error).toBeDefined();
    expect(result.stepId).toBe("");
  });
});
