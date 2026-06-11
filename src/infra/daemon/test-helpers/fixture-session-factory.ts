import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type {
  RunnerAgentSession,
  RunnerAgentSessionArgs,
  RunnerAgentSessionFactory,
} from "../../../domain/runner.js";
import type { StepOutcome } from "../../../domain/outcome.js";
import type { Step } from "../../../domain/workflow.js";

export type FakeMarker =
  | { kind: "complete" }
  | { kind: "handoff"; nextStep: string }
  | { kind: "fail"; reason: string }
  | { kind: "hang" }
  | { kind: "interactive" }
  | { kind: "write"; relPath: string; content: string };

export function parseFakeMarker(description: string): FakeMarker {
  const trimmed = description.trim().split("\n", 1)[0]?.trim() ?? "";
  if (trimmed.startsWith("fake:complete")) return { kind: "complete" };
  if (trimmed.startsWith("fake:write ")) {
    const rest = trimmed.slice("fake:write ".length).trim();
    const sep = rest.indexOf(" ");
    const relPath = sep === -1 ? rest : rest.slice(0, sep);
    const content = sep === -1 ? "" : rest.slice(sep + 1);
    return { kind: "write", relPath, content };
  }
  if (trimmed.startsWith("fake:handoff ")) {
    return {
      kind: "handoff",
      nextStep: trimmed.slice("fake:handoff ".length).trim(),
    };
  }
  if (trimmed.startsWith("fake:fail ")) {
    return { kind: "fail", reason: trimmed.slice("fake:fail ".length).trim() };
  }
  if (trimmed === "fake:fail") {
    return { kind: "fail", reason: "fake failure" };
  }
  if (trimmed.startsWith("fake:hang")) return { kind: "hang" };
  if (trimmed.startsWith("fake:interactive")) return { kind: "interactive" };
  return { kind: "complete" };
}

const RESOLVE_DELAY_MS = 50;

export class FixtureSession implements RunnerAgentSession {
  readonly mode: Step["mode"];
  readonly outcome: Promise<StepOutcome>;

  #resolve!: (o: StepOutcome) => void;
  #disposed = false;
  #marker: FakeMarker;
  #step: Step;

  constructor(args: RunnerAgentSessionArgs, marker: FakeMarker) {
    this.mode = args.step.mode;
    this.#step = args.step;
    this.#marker = marker;
    this.outcome = new Promise<StepOutcome>((resolve) => {
      this.#resolve = resolve;
    });
    this.outcome.catch(() => {});

    if (marker.kind === "complete") {
      this.#scheduleResolve({ kind: "finish", message: "fake complete" });
    } else if (marker.kind === "write") {
      // Perform a real file edit inside this step's worktree (`args.cwd`) so
      // tests can exercise the no-clobber guarantee: concurrent isolated runs
      // writing the same relative path land in their own worktrees.
      const target = join(args.cwd, marker.relPath);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, marker.content);
      this.#scheduleResolve({ kind: "finish", message: "fake write" });
    } else if (marker.kind === "handoff") {
      this.#scheduleResolve({
        kind: "handoff",
        nextStep: marker.nextStep,
        message: "fake handoff",
      });
    } else if (marker.kind === "fail") {
      this.#scheduleResolve({
        kind: "failure",
        failedStep: args.step.id,
        reason: marker.reason,
      });
    }
    // "hang" and "interactive" intentionally do not auto-resolve.
  }

  #scheduleResolve(outcome: StepOutcome): void {
    setTimeout(() => {
      if (!this.#disposed) this.#resolve(outcome);
    }, RESOLVE_DELAY_MS);
  }

  async sendUserInput(text: string): Promise<void> {
    if (this.#marker.kind === "interactive" && !this.#disposed) {
      this.#resolve({
        kind: "finish",
        message: `fake interactive: ${text}`,
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    // Resolve the outcome so any awaiter unblocks. For markers that already
    // scheduled a resolve, this is a no-op (the promise has settled or the
    // scheduled callback short-circuits on `#disposed`).
    this.#resolve({ kind: "finish", message: "fake disposed" });
  }
}

/**
 * Test-only factory that interprets step descriptions for `fake:*` markers.
 * Loaded by `daemon.ts` only when both `NODE_ENV === "test"` and
 * `WORKFLOW_RUNNER_FAKE_FACTORY === "1"` are set.
 *
 * The optional `WORKFLOW_RUNNER_FAKE_OVERRIDE` env var, if set, replaces the
 * marker from every step's description with the override value — for example
 * `WORKFLOW_RUNNER_FAKE_OVERRIDE=complete` forces every step to resolve as
 * `fake:complete`. Used by the daemon-restart-discovery test to retry a hung
 * run against a factory that completes.
 */
export class FixtureSessionFactory implements RunnerAgentSessionFactory {
  readonly #override: FakeMarker | null;

  constructor(override?: string) {
    const raw = override ?? process.env.WORKFLOW_RUNNER_FAKE_OVERRIDE ?? null;
    this.#override = raw ? parseFakeMarker(`fake:${raw}`) : null;
  }

  async create(args: RunnerAgentSessionArgs): Promise<RunnerAgentSession> {
    const marker = this.#override ?? parseFakeMarker(args.step.description);
    return new FixtureSession(args, marker);
  }
}
