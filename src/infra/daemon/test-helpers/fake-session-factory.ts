import type {
  RunnerAgentSession,
  RunnerAgentSessionArgs,
  RunnerAgentSessionFactory,
} from "../../../domain/runner.js";
import type { StepOutcome } from "../../../domain/outcome.js";
import type { Step } from "../../../domain/workflow.js";

export interface FakeSessionConfig {
  onCreate?: (args: RunnerAgentSessionArgs) => void;
  resolveOutcome?: (step: Step) => StepOutcome | Promise<StepOutcome>;
  rejectWith?: (step: Step) => Error;
}

export class FakeSession implements RunnerAgentSession {
  readonly mode: Step["mode"];
  readonly outcome: Promise<StepOutcome>;

  disposeCallCount = 0;
  inputReceived: string[] = [];

  private _resolveOutcome: ((o: StepOutcome) => void) | null = null;

  constructor(mode: Step["mode"], outcomePromise?: Promise<StepOutcome>) {
    this.mode = mode;
    if (outcomePromise) {
      this.outcome = outcomePromise;
    } else {
      this.outcome = new Promise<StepOutcome>((resolve) => {
        this._resolveOutcome = resolve;
      });
    }
  }

  resolveWith(outcome: StepOutcome): void {
    this._resolveOutcome?.(outcome);
  }

  async sendUserInput(text: string): Promise<void> {
    this.inputReceived.push(text);
  }

  async dispose(): Promise<void> {
    this.disposeCallCount++;
    this._resolveOutcome?.({ kind: "finish", message: "disposed" });
  }
}

export class FakeSessionFactory implements RunnerAgentSessionFactory {
  readonly sessions: FakeSession[] = [];
  createCallCount = 0;

  constructor(private readonly cfg: FakeSessionConfig = {}) {}

  async create(args: RunnerAgentSessionArgs): Promise<RunnerAgentSession> {
    this.createCallCount++;
    this.cfg.onCreate?.(args);

    let outcomePromise: Promise<StepOutcome>;
    if (this.cfg.rejectWith) {
      outcomePromise = Promise.reject(this.cfg.rejectWith(args.step));
    } else if (this.cfg.resolveOutcome) {
      outcomePromise = Promise.resolve(this.cfg.resolveOutcome(args.step));
    } else {
      outcomePromise = Promise.resolve({ kind: "finish", message: "Done" });
    }

    const session = new FakeSession(args.step.mode, outcomePromise);
    this.sessions.push(session);
    return session;
  }

  get lastSession(): FakeSession | undefined {
    return this.sessions[this.sessions.length - 1];
  }
}

export class ControllableSessionFactory implements RunnerAgentSessionFactory {
  readonly sessions: FakeSession[] = [];
  createCallCount = 0;

  async create(args: RunnerAgentSessionArgs): Promise<RunnerAgentSession> {
    this.createCallCount++;
    const session = new FakeSession(args.step.mode);
    this.sessions.push(session);
    return session;
  }

  get lastSession(): FakeSession | undefined {
    return this.sessions[this.sessions.length - 1];
  }
}
