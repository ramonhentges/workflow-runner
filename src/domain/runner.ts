import type { Step, Workflow } from "./workflow.js";
import type { StepOutcome } from "./outcome.js";
import type { StepId, StepToken } from "./ids.js";

export type StreamKind = "message" | "thought";

export type RunnerEvent =
  | { type: "banner"; step: Step; index: number }
  | { type: "log"; message: string; color?: string }
  | { type: "stream"; kind: StreamKind; chunk: string; color?: string }
  | { type: "interactive"; enabled: boolean }
  | { type: "status"; text: string; color?: string }
  | { type: "summary"; summary: RunSummary };

export interface RunnerObserver {
  onEvent(event: RunnerEvent): void | Promise<void>;
}

export interface RunSummary {
  visited: StepId[];
  finishMessage: string;
  durationMs: number;
  failure?: { failedStep: StepId; reason: string };
}

// Minimal port shapes the domain Runner needs. Concrete implementations live in src/infra/.

export interface RunnerTools {
  readonly url: string;
  beginStep(step: Step, resolve: (o: StepOutcome) => void): StepToken;
  resetStep(): void;
}

export interface RunnerSessionSink {
  log(message: string, color?: string): void;
  stream(kind: StreamKind, chunk: string, color?: string): void;
  status(text: string, color?: string): void;
}

export interface RunnerAgentSessionArgs {
  step: Step;
  cwd: string;
  tools: RunnerTools;
  inboundMessage: string | null;
  sink: RunnerSessionSink;
}

export interface RunnerAgentSession {
  readonly mode: Step["mode"];
  readonly outcome: Promise<StepOutcome>;
  sendUserInput(text: string): Promise<void>;
  dispose(): Promise<void>;
}

export interface RunnerAgentSessionFactory {
  create(args: RunnerAgentSessionArgs): Promise<RunnerAgentSession>;
}

export interface RunnerOptions {
  cwd?: string;
  maxIterations?: number;
}

export function formatRunSummary(summary: RunSummary): string {
  const lines: string[] = [];

  if (summary.failure) {
    lines.push(`Workflow halted at step '${summary.failure.failedStep}'`);
    lines.push(`Reason: ${summary.failure.reason}`);
  } else {
    lines.push("Workflow completed:");
    for (const stepId of summary.visited) {
      lines.push(`  - ${stepId}`);
    }
    if (summary.finishMessage) {
      lines.push(`Finish message: ${summary.finishMessage}`);
    }
  }

  const seconds = summary.durationMs / 1000;
  lines.push(`Duration: ${seconds.toFixed(1)}s`);

  return lines.join("\n");
}

export class Runner {
  readonly workflow: Workflow;

  #sessionFactory: RunnerAgentSessionFactory;
  #tools: RunnerTools;
  #cwd: string;
  #maxIterations?: number;
  #observers: Set<RunnerObserver> = new Set();
  #activeSession: RunnerAgentSession | null = null;

  constructor(
    workflow: Workflow,
    sessionFactory: RunnerAgentSessionFactory,
    tools: RunnerTools,
    opts: RunnerOptions = {},
  ) {
    this.workflow = workflow;
    this.#sessionFactory = sessionFactory;
    this.#tools = tools;
    this.#cwd = opts.cwd ?? process.cwd();
    this.#maxIterations = opts.maxIterations;
  }

  addObserver(observer: RunnerObserver): () => void {
    this.#observers.add(observer);
    return () => this.#observers.delete(observer);
  }

  async provideInput(text: string): Promise<void> {
    if (!this.#activeSession) return;
    await this.#activeSession.sendUserInput(text);
  }

  async run(startStepId?: StepId): Promise<RunSummary> {
    const startTime = Date.now();
    const visited: StepId[] = [];
    let finishMessage = "";
    let failure: { failedStep: StepId; reason: string } | undefined;

    const entryStepId = startStepId ?? this.workflow.firstStepId();
    const maxIterations =
      this.#maxIterations ?? Math.max(1, this.workflow.steps.length * 10);

    let currentStepId: StepId = entryStepId;
    let inboundMessage: string | null = null;
    let stepIndex = 1;
    let iterationCount = 0;

    const sink: RunnerSessionSink = {
      log: (message, color) => this.emit({ type: "log", message, color }),
      stream: (kind, chunk, color) =>
        this.emit({ type: "stream", kind, chunk, color }),
      status: (text, color) => this.emit({ type: "status", text, color }),
    };

    while (true) {
      iterationCount++;
      if (iterationCount > maxIterations) {
        const recentSteps = visited.slice(-5).join(" → ");
        failure = {
          failedStep: currentStepId,
          reason: `Exceeded maximum iterations (${maxIterations}). Possible step cycle detected. Recent steps: ${recentSteps}`,
        };
        break;
      }

      const step = this.workflow.getStep(currentStepId);
      if (!step) {
        failure = {
          failedStep: currentStepId,
          reason: `Step '${currentStepId}' not found in workflow`,
        };
        break;
      }

      visited.push(step.id);
      this.emit({ type: "banner", step, index: stepIndex });
      this.emit({ type: "status", text: `Running step ${step.id}...` });
      this.emit({ type: "interactive", enabled: step.mode === "interactive" });
      stepIndex++;

      let session: RunnerAgentSession | null = null;
      try {
        session = await this.#sessionFactory.create({
          step,
          cwd: this.#cwd,
          tools: this.#tools,
          inboundMessage,
          sink,
        });
        this.#activeSession = session;

        const stepOutcome = await session.outcome;

        await session.dispose();
        this.#activeSession = null;
        this.#tools.resetStep();
        session = null;

        if (stepOutcome.kind === "finish") {
          finishMessage = stepOutcome.message;
          break;
        } else if (stepOutcome.kind === "handoff") {
          currentStepId = stepOutcome.nextStep;
          inboundMessage = stepOutcome.message;
        } else if (stepOutcome.kind === "failure") {
          failure = {
            failedStep: stepOutcome.failedStep,
            reason: stepOutcome.reason,
          };
          break;
        }
      } catch (err) {
        if (session) {
          await session.dispose().catch(() => {});
          this.#activeSession = null;
        }
        this.#tools.resetStep();
        failure = { failedStep: step.id, reason: String(err) };
        break;
      }
    }

    const durationMs = Date.now() - startTime;
    const summary: RunSummary = {
      visited,
      finishMessage,
      durationMs,
      ...(failure && { failure }),
    };

    this.emit({ type: "summary", summary });
    return summary;
  }

  private emit(event: RunnerEvent): void {
    for (const observer of this.#observers) {
      try {
        const result = observer.onEvent(event);
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch {
        // Swallow observer errors so one bad observer can't kill a run.
      }
    }
  }
}
