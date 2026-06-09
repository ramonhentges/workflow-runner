import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { Writable, Readable } from "node:stream";
import { ClientSideConnection, ndJsonStream } from "@agentclientprotocol/sdk";
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  WriteTextFileRequest,
  WriteTextFileResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
} from "@agentclientprotocol/sdk";

import type { Step } from "../../domain/workflow.js";
import type { StepOutcome } from "../../domain/outcome.js";
import { asSessionId, type SessionId, type StepToken } from "../../domain/ids.js";
import type {
  RunnerAgentSessionFactory,
  ToolCallView,
} from "../../domain/runner.js";
import { AcpClient } from "./acp-client.js";
import type { IdeProfile } from "./ide-profile.js";
import { resolveIdeProfile } from "./ide-profiles.js";
import { ToolCallAccumulator } from "./tool-call-accumulator.js";

export interface AgentSessionSink {
  log(message: string, color?: string): void;
  stream(kind: "message" | "thought", chunk: string, color?: string): void;
  status(text: string, color?: string): void;
  toolCall(view: ToolCallView): void;
}

/**
 * Route one ACP session update to the sink: message/thought chunks stream as
 * text, while `tool_call`/`tool_call_update` notifications are folded through
 * the per-session {@link ToolCallAccumulator} and emitted as a complete
 * {@link ToolCallView}. Other update kinds are ignored. Extracted from the
 * `sessionUpdate` handler so the routing is unit-testable without a subprocess.
 */
export function handleSessionUpdate(
  update: SessionNotification["update"],
  cwd: string,
  sink: AgentSessionSink,
  toolCalls: ToolCallAccumulator,
): void {
  switch (update.sessionUpdate) {
    case "agent_message_chunk": {
      const text =
        update.content.type === "text"
          ? update.content.text
          : `[${update.content.type}]`;
      sink.stream("message", text);
      break;
    }
    case "agent_thought_chunk":
      if (update.content.type === "text") {
        sink.stream("thought", update.content.text);
      }
      break;
    case "tool_call":
    case "tool_call_update":
      sink.toolCall(toolCalls.apply(update, cwd));
      break;
  }
}

export interface AgentSessionTools {
  readonly url: string;
  beginStep(step: Step, resolve: (outcome: StepOutcome) => void): StepToken;
  resetStep(): void;
}

export interface AgentSessionArgs {
  step: Step;
  cwd: string;
  tools: AgentSessionTools;
  inboundMessage: string | null;
  sink: AgentSessionSink;
}

const MODE_INSTRUCTIONS: Record<Step["mode"], string> = {
  interactive:
    "This is an interactive step — you must ask the user to approve a handoff or finish before completing.",
  autonomous:
    "This is an autonomous step — after completing the work, **call handoff (if continuing to a next step is appropriate) or finish with a summary**. Do NOT wait for user approval — you must resolve the outcome yourself.",
};

export function buildKickoffPrompt(
  step: Step,
  inboundMessage: string | null,
): string {
  let prompt = `${MODE_INSTRUCTIONS[step.mode]}\n\n${step.description}`;
  if (inboundMessage) {
    prompt += `\n\nContext from previous step: ${inboundMessage}`;
  }
  return prompt;
}

type SpawnFn = (
  cmd: string,
  spawnArgs: string[],
  opts: SpawnOptions,
) => ChildProcess;

export class IdeDispatchSessionFactory implements RunnerAgentSessionFactory {
  #spawnFn: SpawnFn;

  constructor(spawnFn: SpawnFn = spawn) {
    this.#spawnFn = spawnFn;
  }

  async create(args: AgentSessionArgs): Promise<AgentSession> {
    const profile = resolveIdeProfile(args.step.ide);
    return AgentSession.start(args, profile, this.#spawnFn);
  }
}

export class AgentSession {
  readonly mode: Step["mode"];
  readonly outcome: Promise<StepOutcome>;
  readonly sessionId: SessionId;

  #process: ChildProcess;
  #connection: ClientSideConnection;
  #sink: AgentSessionSink;
  #disposed = false;

  private constructor(init: {
    mode: Step["mode"];
    outcome: Promise<StepOutcome>;
    sessionId: SessionId;
    process: ChildProcess;
    connection: ClientSideConnection;
    sink: AgentSessionSink;
  }) {
    this.mode = init.mode;
    this.outcome = init.outcome;
    this.sessionId = init.sessionId;
    this.#process = init.process;
    this.#connection = init.connection;
    this.#sink = init.sink;
  }

  static async start(
    args: AgentSessionArgs,
    profile: IdeProfile,
    spawnFn: SpawnFn = spawn,
  ): Promise<AgentSession> {
    const { step, cwd, tools, inboundMessage, sink } = args;
    sink.status(`Starting step ${step.id}...`);

    const agentProcess = spawnFn(profile.spawn.command, profile.spawn.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...globalThis.process.env,
        ...profile.spawn.env,
      },
    });

    if (agentProcess.stderr) {
      agentProcess.stderr.on("data", (data: Buffer) => {
        const lines = data
          .toString()
          .split("\n")
          .filter((line) => line.trim());
        for (const line of lines) {
          sink.log(`[${step.id} stderr] ${line}`, "dim");
        }
      });
    }

    await new Promise<void>((resolve, reject) => {
      agentProcess.once("error", (err) => {
        reject(
          new Error(
            `Failed to spawn agent '${profile.spawn.command}': ${String(err)}`,
          ),
        );
      });
      agentProcess.once("spawn", resolve);
    });

    try {
      const writable = Writable.toWeb(
        agentProcess.stdin!,
      ) as WritableStream<Uint8Array>;
      const readable = Readable.toWeb(
        agentProcess.stdout!,
      ) as ReadableStream<Uint8Array>;
      const stream = ndJsonStream(writable, readable);

      // Folds the session's ACP tool-call updates into complete views; scoped
      // to this session and discarded when it ends (ids are unique per session).
      const toolCalls = new ToolCallAccumulator();

      const acpClient = new AcpClient({
        log: (msg, color) => sink.log(msg, color),
        requestPermission: async (
          params: RequestPermissionRequest,
        ): Promise<RequestPermissionResponse> => {
          sink.log(`Permission requested: ${params.toolCall.title}`);
          sink.log(`  Kind: ${params.toolCall.kind}`);
          for (const loc of params.toolCall.locations ?? []) {
            sink.log(`  Path: ${loc.path}`);
          }

          const allowOption = params.options.find(
            (opt) => !opt.kind.startsWith("reject"),
          );

          if (allowOption) {
            sink.log(`Auto-approving: ${allowOption.name}`);
            return {
              outcome: { outcome: "selected", optionId: allowOption.optionId },
            };
          }

          sink.log("No non-reject option available, cancelling");
          return { outcome: { outcome: "cancelled" } };
        },
        sessionUpdate: async (params: SessionNotification): Promise<void> => {
          handleSessionUpdate(params.update, cwd, sink, toolCalls);
        },
        writeTextFile: async (
          params: WriteTextFileRequest,
        ): Promise<WriteTextFileResponse> => {
          const { writeFile } = await import("node:fs/promises");
          await writeFile(params.path, params.content, "utf-8");
          sink.log(`Wrote ${params.path}`);
          return {};
        },
        readTextFile: async (
          params: ReadTextFileRequest,
        ): Promise<ReadTextFileResponse> => {
          const { readFile } = await import("node:fs/promises");
          const content = await readFile(params.path, "utf-8");
          return { content };
        },
      });

      const connection = new ClientSideConnection(() => acpClient, stream);

      let outcomeResolve: (outcome: StepOutcome) => void;
      const toolOutcomePromise = new Promise<StepOutcome>((resolve) => {
        outcomeResolve = resolve;
      });
      const stepToken = tools.beginStep(step, outcomeResolve!);

      const initResult = await connection.initialize({
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
        },
      });

      if (
        !(initResult as { agentCapabilities?: { mcpCapabilities?: { http?: unknown } } })
          .agentCapabilities?.mcpCapabilities?.http
      ) {
        throw new Error(
          "Agent does not support HTTP MCP capabilities, which are required for workflow orchestration",
        );
      }

      const sessionResult = await connection.newSession({
        cwd,
        mcpServers: [
          {
            type: "http",
            name: "workflow",
            url: tools.url,
            headers: [{ name: "x-workflow-step-token", value: stepToken }],
          },
        ],
      });

      const sessionId = asSessionId(sessionResult.sessionId);
      sink.log(`Session created: ${sessionId}`);

      await profile.configureSession({
        connection,
        sessionId,
        session: sessionResult,
        step,
        log: (msg, color) => sink.log(msg, color),
      });

      const kickoffPrompt = buildKickoffPrompt(step, inboundMessage);
      sink.log(`Kickoff: ${step.description}`);

      // Build the outcome promise: races logical outcome vs subprocess exit
      // (and, for autonomous, kickoff finishing without resolving the outcome).
      const processExitPromise = new Promise<StepOutcome>((_, reject) => {
        agentProcess.once("exit", (code) => {
          reject(
            new Error(
              `Subprocess exited with code ${code} during step '${step.id}'`,
            ),
          );
        });
      });

      let finalOutcomePromise: Promise<StepOutcome>;

      if (step.mode === "autonomous") {
        const kickoffPromise = connection.prompt({
          sessionId,
          prompt: [{ type: "text", text: kickoffPrompt }],
        });

        const noToolFailure = kickoffPromise.then(
          (): StepOutcome => ({
            kind: "failure",
            failedStep: step.id,
            reason: "Autonomous step completed without calling handoff or finish",
          }),
        );

        finalOutcomePromise = Promise.race([
          toolOutcomePromise,
          noToolFailure,
          processExitPromise,
        ]);
      } else {
        // Interactive: fire kickoff and log stopReason; tool outcome comes via user-driven prompts.
        connection
          .prompt({
            sessionId,
            prompt: [{ type: "text", text: kickoffPrompt }],
          })
          .then((result) => {
            sink.log(`[${result.stopReason}]`);
          })
          .catch((err) => {
            const msg = String(err);
            if (
              !msg.includes("aborted") &&
              !msg.includes("cancelled") &&
              !msg.includes("canceled")
            ) {
              sink.log(`Error: ${err}`);
            }
          });

        finalOutcomePromise = Promise.race([
          toolOutcomePromise,
          processExitPromise,
        ]);
      }

      return new AgentSession({
        mode: step.mode,
        outcome: finalOutcomePromise,
        sessionId,
        process: agentProcess,
        connection,
        sink,
      });
    } catch (err) {
      agentProcess.kill();
      tools.resetStep();
      throw err;
    }
  }

  async sendUserInput(text: string): Promise<void> {
    if (this.mode !== "interactive") return;
    try {
      const result = await this.#connection.prompt({
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      });
      this.#sink.log(`[${result.stopReason}]`);
    } catch (err) {
      const msg = String(err);
      if (
        !msg.includes("aborted") &&
        !msg.includes("cancelled") &&
        !msg.includes("canceled")
      ) {
        this.#sink.log(`Error: ${err}`);
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;

    // Stop forwarding anything the dying subprocess emits. Without this, late
    // stderr lines and any buffered ACP chunks continue to flow through the
    // sink into the Runner's observers (the TUI) after dispose() resolves.
    this.#process.stderr?.removeAllListeners("data");
    this.#process.stdout?.removeAllListeners("data");

    try {
      await this.#connection.cancel({ sessionId: this.sessionId });
    } catch {
      // ignore
    }

    if (this.#process.exitCode !== null) return;

    await new Promise<void>((resolve) => {
      const onExit = () => resolve();
      this.#process.once("exit", onExit);

      try {
        this.#process.kill("SIGTERM");
      } catch {
        this.#process.off("exit", onExit);
        resolve();
        return;
      }

      // If the agent doesn't exit promptly, escalate.
      const killTimer = setTimeout(() => {
        try {
          this.#process.kill("SIGKILL");
        } catch {
          // already gone
        }
      }, 500);

      this.#process.once("exit", () => clearTimeout(killTimer));
    });
  }
}
