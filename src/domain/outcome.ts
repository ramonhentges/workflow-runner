import type { StepId } from "./ids.js";

export type StepOutcome =
  | { kind: "handoff"; nextStep: StepId; message: string }
  | { kind: "finish"; message: string }
  | { kind: "failure"; failedStep: StepId; reason: string };
