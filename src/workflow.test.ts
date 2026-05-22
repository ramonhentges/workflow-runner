import { describe, it, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { loadWorkflow, WorkflowConfigError } from "./workflow.js";

async function writeTempFile(content: string): Promise<string> {
  const path = join(tmpdir(), `workflow-test-${randomBytes(6).toString("hex")}.json`);
  await writeFile(path, content, "utf-8");
  return path;
}

const VALID_CONFIG = {
  id: "test-workflow",
  name: "Test Workflow",
  description: "A test workflow",
  version: "1",
  steps: [
    {
      id: "step-1",
      agent: "architect-advisor",
      description: "First step",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [
        { next_step: "step-2", intent: "Route to step-2" },
        { next_step: "step-3", intent: "Route to step-3" },
      ],
    },
    {
      id: "step-2",
      agent: "devils-advocate",
      description: "Second step",
      mode: "autonomous",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    },
    {
      id: "step-3",
      agent: "pragmatic-engineer",
      description: "Third step",
      mode: "autonomous",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    },
  ],
};

describe("loadWorkflow", () => {
  describe("valid config", () => {
    it("loads a who-is.json-shaped config and returns a Workflow with 3 steps", async () => {
      const path = await writeTempFile(JSON.stringify(VALID_CONFIG));
      const workflow = await loadWorkflow(path);
      expect(workflow.steps).toHaveLength(3);
      expect(workflow.steps[0].id).toBe("step-1");
      expect(workflow.steps[0].mode).toBe("interactive");
      expect(workflow.steps[1].id).toBe("step-2");
      expect(workflow.steps[2].id).toBe("step-3");
      expect(workflow.steps[0].edges).toHaveLength(2);
      expect(workflow.steps[0].edges[0].next_step).toBe("step-2");
    });
  });

  describe("rejection cases", () => {
    it("throws WorkflowConfigError for malformed JSON (trailing comma)", async () => {
      const path = await writeTempFile('{"id": "x", "name": "y",}');
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
    });

    it("throws WorkflowConfigError naming 'steps' for empty steps array", async () => {
      const path = await writeTempFile(JSON.stringify({ ...VALID_CONFIG, steps: [] }));
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
      expect((err as WorkflowConfigError).message).toContain("steps");
    });

    it("throws WorkflowConfigError naming the step id and 'agent' when agent is missing", async () => {
      const badConfig = {
        ...VALID_CONFIG,
        steps: [{ ...VALID_CONFIG.steps[0], agent: "" }],
      };
      const path = await writeTempFile(JSON.stringify(badConfig));
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
      expect((err as WorkflowConfigError).message).toContain("step-1");
      expect((err as WorkflowConfigError).message).toContain("agent");
    });

    it("throws WorkflowConfigError naming the step id and 'mode' for mode: 'auto'", async () => {
      const badConfig = {
        ...VALID_CONFIG,
        steps: [{ ...VALID_CONFIG.steps[0], mode: "auto" }],
      };
      const path = await writeTempFile(JSON.stringify(badConfig));
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
      expect((err as WorkflowConfigError).message).toContain("step-1");
      expect((err as WorkflowConfigError).message).toContain("mode");
    });

    it("throws WorkflowConfigError naming the duplicate step id", async () => {
      const badConfig = {
        ...VALID_CONFIG,
        steps: [
          VALID_CONFIG.steps[0],
          { ...VALID_CONFIG.steps[1], id: "step-1" },
        ],
      };
      const path = await writeTempFile(JSON.stringify(badConfig));
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
      expect((err as WorkflowConfigError).message).toContain("step-1");
    });

    it("throws WorkflowConfigError naming the dangling edge target 'step-9'", async () => {
      const badConfig = {
        ...VALID_CONFIG,
        steps: [
          {
            ...VALID_CONFIG.steps[0],
            edges: [{ next_step: "step-9", intent: "Goes nowhere" }],
          },
          VALID_CONFIG.steps[1],
          VALID_CONFIG.steps[2],
        ],
      };
      const path = await writeTempFile(JSON.stringify(badConfig));
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
      expect((err as WorkflowConfigError).message).toContain("step-9");
    });

    it("throws WorkflowConfigError when step is missing 'model'", async () => {
      const { model: _m, ...stepNoModel } = VALID_CONFIG.steps[0];
      const badConfig = { ...VALID_CONFIG, steps: [stepNoModel] };
      const path = await writeTempFile(JSON.stringify(badConfig));
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
      expect((err as WorkflowConfigError).message).toContain("step-1");
      expect((err as WorkflowConfigError).message).toContain("model");
    });

    it("throws WorkflowConfigError for a non-object workflow (e.g. JSON array)", async () => {
      const path = await writeTempFile("[]");
      let err: unknown;
      try {
        await loadWorkflow(path);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
    });

    it("throws WorkflowConfigError when file does not exist", async () => {
      let err: unknown;
      try {
        await loadWorkflow("/nonexistent/path/workflow.json");
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WorkflowConfigError);
    });
  });

  describe("integration test", () => {
    it("loads workflows/who-is.json and deep-equals the on-disk config", async () => {
      const raw = await readFile("workflows/who-is.json", "utf-8");
      const onDisk = JSON.parse(raw) as {
        id: string;
        name: string;
        description: string;
        version: string;
        steps: Array<{
          id: string;
          agent: string;
          description: string;
          mode: "interactive" | "autonomous";
          ide: string;
          model: string;
          edges: Array<{ next_step: string; intent: string }>;
        }>;
      };

      const workflow = await loadWorkflow("workflows/who-is.json");

      expect(workflow.id).toBe(onDisk.id);
      expect(workflow.name).toBe(onDisk.name);
      expect(workflow.description).toBe(onDisk.description);
      expect(workflow.version).toBe(onDisk.version);
      expect(workflow.steps).toHaveLength(onDisk.steps.length);

      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        const expected = onDisk.steps[i];
        expect(step.id).toBe(expected.id);
        expect(step.agent).toBe(expected.agent);
        expect(step.description).toBe(expected.description);
        expect(step.mode).toBe(expected.mode);
        expect(step.ide).toBe(expected.ide);
        expect(step.model).toBe(expected.model);
        expect(step.edges).toHaveLength(expected.edges.length);
        for (let j = 0; j < step.edges.length; j++) {
          expect(step.edges[j].next_step).toBe(expected.edges[j].next_step);
          expect(step.edges[j].intent).toBe(expected.edges[j].intent);
        }
      }
    });
  });
});
