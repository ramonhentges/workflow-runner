import type { StepId } from "./ids.js";

export type RunId = string & { readonly __brand: "RunId" };
export type RunSlug = string & { readonly __brand: "RunSlug" };

export const asRunId = (s: string): RunId => s as RunId;
export const asRunSlug = (s: string): RunSlug => s as RunSlug;

export type RunStatus =
  | "running"
  | "completed"
  | "failed"
  | "crashed"
  | "aborted";

export interface RunSnapshot {
  id: RunId;
  slug: RunSlug;
  workflowPath: string;
  status: RunStatus;
  currentStepId: StepId | null;
  visitedStepIds: StepId[];
  kickoffPrompts: Record<StepId, string>;
  startedAt: number;
  endedAt: number | null;
  endReason?: string;
}

const LEGAL_TRANSITIONS: Record<RunStatus, ReadonlySet<RunStatus>> = {
  running: new Set(["completed", "failed", "crashed", "aborted"]),
  completed: new Set(),
  failed: new Set(),
  crashed: new Set(),
  aborted: new Set(),
};

export class Run {
  #id: RunId;
  #slug: RunSlug;
  #workflowPath: string;
  #status: RunStatus;
  #currentStepId: StepId | null;
  #visitedStepIds: StepId[];
  #kickoffPrompts: Record<StepId, string>;
  #startedAt: number;
  #endedAt: number | null;
  #endReason: string | undefined;

  private constructor(snap: RunSnapshot) {
    this.#id = snap.id;
    this.#slug = snap.slug;
    this.#workflowPath = snap.workflowPath;
    this.#status = snap.status;
    this.#currentStepId = snap.currentStepId;
    this.#visitedStepIds = [...snap.visitedStepIds];
    this.#kickoffPrompts = { ...snap.kickoffPrompts };
    this.#startedAt = snap.startedAt;
    this.#endedAt = snap.endedAt;
    this.#endReason = snap.endReason;
  }

  static create(args: {
    id: RunId;
    slug: RunSlug;
    workflowPath: string;
  }): Run {
    return new Run({
      id: args.id,
      slug: args.slug,
      workflowPath: args.workflowPath,
      status: "running",
      currentStepId: null,
      visitedStepIds: [],
      kickoffPrompts: {},
      startedAt: Date.now(),
      endedAt: null,
    });
  }

  static fromSnapshot(snap: RunSnapshot): Run {
    return new Run(snap);
  }

  snapshot(): RunSnapshot {
    const snap: RunSnapshot = {
      id: this.#id,
      slug: this.#slug,
      workflowPath: this.#workflowPath,
      status: this.#status,
      currentStepId: this.#currentStepId,
      visitedStepIds: [...this.#visitedStepIds],
      kickoffPrompts: { ...this.#kickoffPrompts },
      startedAt: this.#startedAt,
      endedAt: this.#endedAt,
    };
    if (this.#endReason !== undefined) {
      snap.endReason = this.#endReason;
    }
    return snap;
  }

  markStepEntered(stepId: StepId, kickoffPrompt: string): void {
    this.#assertRunning("enter step");
    this.#currentStepId = stepId;
    this.#visitedStepIds.push(stepId);
    this.#kickoffPrompts[stepId] = kickoffPrompt;
  }

  markCompleted(): void {
    this.#assertTransition("completed");
    this.#status = "completed";
    this.#endedAt = Date.now();
  }

  markFailed(reason: string): void {
    this.#assertTransition("failed");
    this.#status = "failed";
    this.#endedAt = Date.now();
    this.#endReason = reason;
  }

  markCrashed(reason: string): void {
    this.#assertTransition("crashed");
    this.#status = "crashed";
    this.#endedAt = Date.now();
    this.#endReason = reason;
  }

  markAborted(): void {
    this.#assertTransition("aborted");
    this.#status = "aborted";
    this.#endedAt = Date.now();
  }

  eligibleForRetry(): boolean {
    return (
      this.#status === "crashed" ||
      this.#status === "failed" ||
      this.#status === "aborted"
    );
  }

  #assertTransition(to: RunStatus): void {
    if (!LEGAL_TRANSITIONS[this.#status].has(to)) {
      throw new Error(
        `Illegal status transition from '${this.#status}' to '${to}'`,
      );
    }
  }

  #assertRunning(action: string): void {
    if (this.#status !== "running") {
      throw new Error(`Cannot ${action} from status '${this.#status}'`);
    }
  }
}
