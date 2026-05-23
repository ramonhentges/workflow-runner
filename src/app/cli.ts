import type { Workflow } from "../domain/workflow.js";
import { asStepId, type StepId } from "../domain/ids.js";

export interface CliArgs {
  workflowPath: string;
  startStepId: StepId | null;
  error?: string;
}

export function parseCliArgs(argv: string[]): CliArgs {
  if (argv.length < 3) {
    return {
      workflowPath: "",
      startStepId: null,
      error: "Usage: workflow-runner <workflow.json> [--start <step-id>]",
    };
  }

  const workflowPath = argv[2];
  let startStepId: StepId | null = null;

  if (argv.length >= 5 && argv[3] === "--start") {
    startStepId = asStepId(argv[4]);
  }

  return { workflowPath, startStepId };
}

export interface ResolvedEntry {
  stepId: StepId;
  error?: string;
}

export function resolveEntryStep(
  workflow: Workflow,
  startStepId: StepId | null,
): ResolvedEntry {
  if (!startStepId) {
    if (workflow.steps.length === 0) {
      return { stepId: asStepId(""), error: "Workflow has no steps" };
    }
    return { stepId: workflow.steps[0].id };
  }

  const step = workflow.getStep(startStepId);
  if (!step) {
    return {
      stepId: asStepId(""),
      error: `Step '${startStepId}' not found in workflow`,
    };
  }

  return { stepId: step.id };
}
