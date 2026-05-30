import { join } from "node:path";
import {
  Run,
  type RunId,
  type RunSlug,
  type RunSnapshot,
  type RunStatus,
} from "../../domain/run.js";
import { generateRunId, generateSlug, parseIdentifier } from "../../domain/run-id.js";
import {
  Runner,
  type RunnerAgentSessionFactory,
  type RunnerEvent,
  type RunnerObserver,
  type RunSummary,
} from "../../domain/runner.js";
import type { StepId } from "../../domain/ids.js";
import { Workflow } from "../../domain/workflow.js";
import { McpServer } from "../mcp/mcp-server.js";
import { RunStore } from "./run-store.js";
import { EventLog, type EventLogEntry } from "./event-log.js";
import { RpcErrorCode } from "./protocol.js";
import type { DaemonLogger } from "./daemon-log.js";

const RUN_LIMIT_DEFAULT = 16;
const STOP_TIMEOUT_MS = 5000;
const TERMINAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface RunSubscriber {
  onEvent(entry: EventLogEntry): void;
  onStatusChanged?(status: RunStatus): void;
}

export interface ActiveRun {
  run: Run;
  runner: Runner | null;
  mcpServer: McpServer | null;
  eventLog: EventLog | null;
  subscribers: Set<RunSubscriber>;
  runPromise: Promise<RunSummary> | null;
}

interface InternalRecord extends ActiveRun {
  stopRequested: boolean;
  isInteractive: boolean;
}

export class RunManagerError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(name: keyof typeof RpcErrorCode, message?: string, data?: unknown) {
    super(message ?? name);
    this.name = "RunManagerError";
    this.code = RpcErrorCode[name];
    this.data = data;
  }
}

export interface RunManagerOptions {
  runLimit?: number;
  /** Injected for testing: override id generation to force collisions. */
  generateId?: () => RunId;
  /** Injected for testing: override slug generation to force collisions. */
  generateSlug?: () => RunSlug;
  /** Injected for testing: override MCP server creation. */
  createMcpServer?: () => Promise<McpServer>;
  /** Optional logger for recording errors and events. */
  logger?: DaemonLogger | null;
}

export class RunManager {
  readonly #store: RunStore;
  readonly #sessionFactory: RunnerAgentSessionFactory;
  readonly #registry = new Map<RunId, InternalRecord>();
  readonly #runLimit: number;
  readonly #generateId: () => RunId;
  readonly #generateSlug: () => RunSlug;
  readonly #createMcpServer: () => Promise<McpServer>;
  readonly #logger: DaemonLogger | null;

  constructor(
    storageRoot: string,
    sessionFactory: RunnerAgentSessionFactory,
    options: RunManagerOptions = {},
  ) {
    this.#store = new RunStore({ storageRoot });
    this.#sessionFactory = sessionFactory;
    this.#runLimit = options.runLimit ?? RUN_LIMIT_DEFAULT;
    this.#generateId = options.generateId ?? generateRunId;
    this.#generateSlug = options.generateSlug ?? generateSlug;
    this.#createMcpServer = options.createMcpServer ?? McpServer.start.bind(McpServer);
    this.#logger = options.logger ?? null;
  }

  async discoverOnStartup(): Promise<void> {
    const snapshots = await this.#store.discoverAndMarkOrphans();
    for (const snapshot of snapshots) {
      if (this.#registry.has(snapshot.id)) continue;
      const run = Run.fromSnapshot(snapshot);
      const record: InternalRecord = {
        run,
        runner: null,
        mcpServer: null,
        eventLog: null,
        subscribers: new Set(),
        runPromise: null,
        stopRequested: false,
        isInteractive: false,
      };
      this.#registry.set(snapshot.id, record);
    }
  }

  async startRun(workflowPath: string, cwd: string): Promise<{ runId: RunId; slug: RunSlug }> {
    if (this.#activeRunCount() >= this.#runLimit) {
      throw new RunManagerError(
        "RUN_LIMIT_REACHED",
        `Run limit of ${this.#runLimit} reached`,
      );
    }

    const workflow = await Workflow.load(workflowPath);

    let runId: RunId;
    let slug: RunSlug;
    let attempts = 0;

    do {
      if (attempts++ > 50) {
        throw new Error("Failed to generate unique run id/slug");
      }
      runId = this.#generateId();
      slug = this.#generateSlug();
    } while ([...this.#registry.values()].some((r) => {
      const s = r.run.snapshot();
      return s.id === runId || s.slug === slug;
    }));

    const run = Run.create({ id: runId, slug, workflowPath });
    const runDir = join(this.#store.runsRoot, runId);

    // Reserve the slot synchronously before any I/O so a concurrent startRun
    // call that executes its do-while loop after this point sees the taken id/slug
    // and retries rather than claiming the same pair.
    const record: InternalRecord = {
      run,
      runner: null,
      mcpServer: null,
      eventLog: null,
      subscribers: new Set(),
      runPromise: null,
      stopRequested: false,
      isInteractive: false,
    };
    this.#registry.set(runId, record);

    try {
      await this.#store.persist(run.snapshot());
      record.eventLog = await EventLog.open(runDir);
      record.mcpServer = await this.#createMcpServer();
    } catch (err) {
      this.#registry.delete(runId);
      throw err;
    }

    const runner = new Runner(workflow, this.#sessionFactory, record.mcpServer!, {
      cwd,
      onStepBoundary: async (visited, nextStepId, nextInboundMessage) => {
        if (nextStepId !== null) {
          run.markStepEntered(nextStepId, nextInboundMessage ?? "");
        }
        await this.#store.persist(run.snapshot());
      },
    });
    record.runner = runner;
    runner.addObserver(makeEventLogObserver(record, record.eventLog!));

    record.runPromise = this.#launchRunner(runner, record, workflow.firstStepId());

    return { runId, slug };
  }

  list(options?: { includeOldTerminal?: boolean }): RunSnapshot[] {
    const now = Date.now();
    const active: RunSnapshot[] = [];
    const terminal: RunSnapshot[] = [];

    for (const record of this.#registry.values()) {
      const snap = record.run.snapshot();
      if (snap.status === "running") {
        active.push(snap);
      } else {
        const endedAt = snap.endedAt ?? 0;
        if (options?.includeOldTerminal || now - endedAt <= TERMINAL_TTL_MS) {
          terminal.push(snap);
        }
      }
    }

    active.sort((a, b) => a.startedAt - b.startedAt);
    terminal.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));

    return [...active, ...terminal];
  }

  get(idOrPrefix: string): ActiveRun | undefined {
    const pairs = [...this.#registry.values()].map((r) => {
      const snap = r.run.snapshot();
      return { id: snap.id, slug: snap.slug };
    });

    const result = parseIdentifier(idOrPrefix, pairs);

    if (result.kind === "not-found") return undefined;
    if (result.kind === "ambiguous") {
      throw new RunManagerError(
        "AMBIGUOUS_PREFIX",
        `Prefix '${idOrPrefix}' matches multiple runs: ${result.candidates.join(", ")}`,
        { candidates: result.candidates },
      );
    }

    return this.#registry.get(result.match) ?? undefined;
  }

  async retryStep(runId: RunId): Promise<void> {
    const record = this.#registry.get(runId);
    if (!record) throw new RunManagerError("UNKNOWN_RUN");

    if (!record.run.eligibleForRetry()) {
      throw new RunManagerError(
        "RUN_NOT_RETRY_ELIGIBLE",
        `Run ${runId} is not eligible for retry (status: ${record.run.snapshot().status})`,
      );
    }

    const snap = record.run.snapshot();
    const failedStepId = snap.currentStepId;
    if (!failedStepId) {
      throw new RunManagerError("UNKNOWN_RUN", `Run ${runId} has no current step id`);
    }

    const workflow = await Workflow.load(snap.workflowPath);
    const rawInboundMessage = snap.kickoffPrompts[failedStepId] ?? null;

    const eventLog =
      record.eventLog ?? (await EventLog.open(join(this.#store.runsRoot, runId)));
    record.eventLog = eventLog;

    const bannerEvent: RunnerEvent = {
      type: "log",
      message: `↻ retrying ${failedStepId} — LLM output may differ from the previous attempt`,
    };
    const bannerEntry = await eventLog.append(bannerEvent, failedStepId);
    if (bannerEntry) {
      for (const sub of record.subscribers) {
        try {
          sub.onEvent(bannerEntry);
        } catch {}
      }
    }

    const newRun = Run.fromSnapshot({
      id: snap.id,
      slug: snap.slug,
      workflowPath: snap.workflowPath,
      status: "running",
      currentStepId: snap.currentStepId,
      visitedStepIds: [...snap.visitedStepIds],
      kickoffPrompts: { ...snap.kickoffPrompts },
      startedAt: snap.startedAt,
      endedAt: null,
    });
    record.run = newRun;
    record.stopRequested = false;
    record.isInteractive = false;

    await this.#store.persist(newRun.snapshot());

    if (record.mcpServer) {
      await record.mcpServer.close().catch(() => {});
    }
    const mcpServer = await this.#createMcpServer();
    record.mcpServer = mcpServer;

    const runner = new Runner(workflow, this.#sessionFactory, mcpServer, {
      onStepBoundary: async (visited, nextStepId, nextInboundMessage) => {
        if (nextStepId !== null) {
          newRun.markStepEntered(nextStepId, nextInboundMessage ?? "");
        }
        await this.#store.persist(newRun.snapshot());
      },
    });
    record.runner = runner;
    runner.addObserver(makeEventLogObserver(record, eventLog));

    record.runPromise = this.#launchRunner(
      runner,
      record,
      failedStepId,
      rawInboundMessage,
    );

    // After retryStep, status is back to "running"; notify any attached subscribers
    // so they can re-render their status banner. This runs after runPromise is
    // assigned so subscribers can subsequently observe the new lifecycle.
    this.#emitStatusChanged(record);
  }

  async stop(runId: RunId): Promise<void> {
    const record = this.#registry.get(runId);
    if (!record) throw new RunManagerError("UNKNOWN_RUN");

    if (record.run.snapshot().status !== "running") return;

    record.stopRequested = true;

    if (record.runner) {
      await record.runner.stop();
    }

    if (record.runPromise) {
      let timer!: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          record.runPromise,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("stop timeout")), STOP_TIMEOUT_MS);
          }),
        ]);
      } catch {
        // Either the run promise rejected or the timeout fired; both are acceptable.
      } finally {
        clearTimeout(timer);
      }
    }

    if (record.run.snapshot().status === "running") {
      try {
        record.run.markAborted();
        await this.#store.persist(record.run.snapshot());
        this.#emitStatusChanged(record);
      } catch {}
    }
  }

  async sendInput(runId: RunId, message: string): Promise<number> {
    const record = this.#registry.get(runId);
    if (!record || !record.runner) throw new RunManagerError("UNKNOWN_RUN");
    if (!record.isInteractive) {
      throw new RunManagerError(
        "RUN_NOT_INTERACTIVE",
        `Run ${runId} is not in an interactive step`,
      );
    }

    let acceptedSeq = 0;
    if (record.eventLog) {
      const stepId = record.run.snapshot().currentStepId;
      const entry = await record.eventLog
        .append({ type: "log", message: `→ ${message}` }, stepId)
        .catch(() => null);
      if (entry) {
        acceptedSeq = entry.seq;
        for (const sub of record.subscribers) {
          try {
            sub.onEvent(entry);
          } catch {}
        }
      }
    }

    await record.runner.provideInput(message);
    return acceptedSeq;
  }

  attachSubscriber(runId: RunId, sub: RunSubscriber): () => void {
    const record = this.#registry.get(runId);
    if (!record) throw new RunManagerError("UNKNOWN_RUN");

    record.subscribers.add(sub);
    return () => {
      record.subscribers.delete(sub);
    };
  }

  async openEventLog(runId: RunId): Promise<EventLog | null> {
    const record = this.#registry.get(runId);
    if (!record) return null;
    // Terminal runs have no live runner. Return an uncached, caller-owned handle
    // so the caller can close it when done and FDs do not accumulate.
    if (record.run.snapshot().status !== "running") {
      try {
        return await EventLog.open(join(this.#store.runsRoot, runId));
      } catch {
        return null;
      }
    }
    if (record.eventLog) return record.eventLog;
    try {
      const eventLog = await EventLog.open(join(this.#store.runsRoot, runId));
      record.eventLog = eventLog;
      return eventLog;
    } catch {
      return null;
    }
  }

  async shutdown(): Promise<void> {
    const closePromises: Promise<void>[] = [];

    for (const record of this.#registry.values()) {
      if (record.mcpServer) {
        closePromises.push(record.mcpServer.close().catch(() => {}));
        record.mcpServer = null;
      }
      if (record.eventLog) {
        closePromises.push(record.eventLog.close().catch(() => {}));
        record.eventLog = null;
      }
    }

    await Promise.all(closePromises);
  }

  #emitStatusChanged(record: InternalRecord): void {
    const status = record.run.snapshot().status;
    for (const sub of record.subscribers) {
      try {
        sub.onStatusChanged?.(status);
      } catch {}
    }
  }

  #activeRunCount(): number {
    let count = 0;
    for (const r of this.#registry.values()) {
      if (r.run.snapshot().status === "running") count++;
    }
    return count;
  }

  async #launchRunner(
    runner: Runner,
    record: InternalRecord,
    startStepId: StepId,
    startInboundMessage?: string | null,
  ): Promise<RunSummary> {
    try {
      const summary = await runner.run(startStepId, startInboundMessage ?? null);

      if (record.stopRequested) {
        try {
          record.run.markAborted();
        } catch {}
      } else if (summary.failure) {
        try {
          record.run.markFailed(summary.failure.reason);
        } catch {}
      } else {
        try {
          record.run.markCompleted();
        } catch {}
      }

      try {
        await this.#store.persist(record.run.snapshot());
      } catch (err) {
        this.#logger?.log({
          level: "ERROR",
          event: "run.terminalPersistFailed",
          runId: record.run.snapshot().id,
          msg: err instanceof Error ? err.message : String(err),
        });
      }
      this.#emitStatusChanged(record);

      if (record.mcpServer) {
        await record.mcpServer.close().catch(() => {});
        record.mcpServer = null;
      }

      if (record.eventLog) {
        await record.eventLog.close().catch(() => {});
        record.eventLog = null;
      }

      return summary;
    } catch (err) {
      if (record.stopRequested) {
        try {
          record.run.markAborted();
        } catch {}
      } else {
        try {
          record.run.markCrashed(String(err));
        } catch {}
      }
      try {
        await this.#store.persist(record.run.snapshot());
      } catch (persistErr) {
        this.#logger?.log({
          level: "ERROR",
          event: "run.terminalPersistFailed",
          runId: record.run.snapshot().id,
          msg: persistErr instanceof Error ? persistErr.message : String(persistErr),
        });
      }
      this.#emitStatusChanged(record);

      if (record.mcpServer) {
        await record.mcpServer.close().catch(() => {});
        record.mcpServer = null;
      }

      if (record.eventLog) {
        await record.eventLog.close().catch(() => {});
        record.eventLog = null;
      }

      const msg = err instanceof Error ? err.message : String(err);
      return {
        visited: [],
        finishMessage: "",
        durationMs: 0,
        failure: { failedStep: startStepId, reason: msg },
      };
    }
  }
}

function makeEventLogObserver(
  record: InternalRecord,
  eventLog: EventLog,
): RunnerObserver {
  let currentStepId: StepId | null = null;

  return {
    onEvent: async (event: RunnerEvent): Promise<void> => {
      // Capture subscribers before any async operation so late-attached
      // subscribers don't receive events that predate their attachment.
      const currentSubscribers = [...record.subscribers];

      if (event.type === "banner") {
        currentStepId = event.step.id;
      }
      if (event.type === "interactive") {
        record.isInteractive = event.enabled;
      }

      const entry = await eventLog.append(event, currentStepId).catch(() => null);
      if (entry) {
        for (const sub of currentSubscribers) {
          if (record.subscribers.has(sub)) {
            try {
              sub.onEvent(entry);
            } catch {}
          }
        }
      }
    },
  };
}
