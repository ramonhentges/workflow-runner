import { readFile } from "node:fs/promises";

export interface Edge {
  next_step: string;
  intent: string;
}

export interface Step {
  id: string;
  agent: string;
  description: string;
  mode: "interactive" | "autonomous";
  ide: string;
  model: string;
  edges: Edge[];
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  version: string;
  steps: Step[];
}

export class WorkflowConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowConfigError";
  }
}

export async function loadWorkflow(path: string): Promise<Workflow> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (err) {
    throw new WorkflowConfigError(`Cannot read workflow file '${path}': ${err}`);
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new WorkflowConfigError(`Malformed JSON in '${path}': ${err}`);
  }

  return validateWorkflow(data);
}

function validateWorkflow(data: unknown): Workflow {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new WorkflowConfigError("Workflow must be a JSON object");
  }

  const obj = data as Record<string, unknown>;

  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new WorkflowConfigError("Field 'steps' must be a non-empty array");
  }

  // First pass: validate per-step scalar fields and collect all step ids.
  // Edge validation requires all ids to be known first (forward references).
  const stepIds = new Set<string>();
  const validatedSteps: Step[] = [];

  for (const rawStep of obj.steps) {
    const step = validateStep(rawStep, stepIds);
    stepIds.add(step.id);
    validatedSteps.push(step);
  }

  // Second pass: validate edges now that all step ids are known
  for (let i = 0; i < obj.steps.length; i++) {
    const rawStep = obj.steps[i] as Record<string, unknown>;
    const step = validatedSteps[i];
    step.edges = validateEdges(rawStep.edges, step.id, stepIds);
  }

  return {
    id: typeof obj.id === "string" ? obj.id : "",
    name: typeof obj.name === "string" ? obj.name : "",
    description: typeof obj.description === "string" ? obj.description : "",
    version: typeof obj.version === "string" ? obj.version : "",
    steps: validatedSteps,
  };
}

function validateStep(rawStep: unknown, existingIds: Set<string>): Step {
  if (typeof rawStep !== "object" || rawStep === null) {
    throw new WorkflowConfigError("Each step must be an object");
  }

  const s = rawStep as Record<string, unknown>;

  if (typeof s.id !== "string" || s.id.trim() === "") {
    throw new WorkflowConfigError("Step is missing a non-empty 'id'");
  }

  if (existingIds.has(s.id)) {
    throw new WorkflowConfigError(`Duplicate step id: '${s.id}'`);
  }

  if (typeof s.agent !== "string" || s.agent.trim() === "") {
    throw new WorkflowConfigError(`Step '${s.id}': missing or empty 'agent'`);
  }

  if (typeof s.model !== "string" || s.model.trim() === "") {
    throw new WorkflowConfigError(`Step '${s.id}': missing or empty 'model'`);
  }

  if (s.mode !== "interactive" && s.mode !== "autonomous") {
    throw new WorkflowConfigError(
      `Step '${s.id}': 'mode' must be 'interactive' or 'autonomous', got '${String(s.mode)}'`,
    );
  }

  return {
    id: s.id,
    agent: s.agent,
    description: typeof s.description === "string" ? s.description : "",
    mode: s.mode,
    ide: typeof s.ide === "string" ? s.ide : "",
    model: s.model,
    edges: [],
  };
}

function validateEdges(
  rawEdges: unknown,
  stepId: string,
  allStepIds: Set<string>,
): Edge[] {
  if (!Array.isArray(rawEdges)) {
    return [];
  }

  return rawEdges.map((rawEdge) => {
    if (typeof rawEdge !== "object" || rawEdge === null) {
      throw new WorkflowConfigError(
        `Step '${stepId}': each edge must be an object`,
      );
    }
    const e = rawEdge as Record<string, unknown>;
    if (typeof e.next_step !== "string" || !allStepIds.has(e.next_step)) {
      throw new WorkflowConfigError(
        `Step '${stepId}': edge.next_step '${String(e.next_step)}' does not reference an existing step id`,
      );
    }
    return {
      next_step: e.next_step,
      intent: typeof e.intent === "string" ? e.intent : "",
    };
  });
}
