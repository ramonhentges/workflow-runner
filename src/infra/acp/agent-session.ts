import { spawn, type ChildProcess } from "node:child_process";
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
  NewSessionResponse,
  SessionConfigSelectOption,
  SessionConfigSelectGroup,
} from "@agentclientprotocol/sdk";

import type { Step } from "../../domain/workflow.js";
import type { StepOutcome } from "../../domain/outcome.js";
import { asSessionId, type SessionId, type StepToken } from "../../domain/ids.js";
import { AcpClient } from "./acp-client.js";

export interface AgentSessionSink {
  log(message: string, color?: string): void;
  stream(kind: "message" | "thought", chunk: string, color?: string): void;
  status(text: string, color?: string): void;
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

export interface AgentSessionFactory {
  create(args: AgentSessionArgs): Promise<AgentSession>;
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

/**
 * Extracts the set of valid mode (agent) ids from a `newSession` response.
 *
 * Standard ACP agents advertise modes via the `modes` field, but opencode leaves
 * that unset and instead exposes mode selection as a `configOptions` entry
 * (`id`/`category` of `"mode"`, a `select` whose option `value`s are the agent
 * names). We read the standard field first for forward-compatibility, then fall
 * back to the config option.
 */
export function availableModeIds(result: NewSessionResponse): string[] {
  const standard = result.modes?.availableModes?.map((m) => m.id);
  if (standard && standard.length > 0) return standard;

  const modeOption = result.configOptions?.find(
    (o) => o.type === "select" && (o.id === "mode" || o.category === "mode"),
  );
  if (!modeOption || modeOption.type !== "select") return [];

  return modeOption.options.flatMap((entry) =>
    "group" in entry
      ? (entry as SessionConfigSelectGroup).options.map((o) => o.value)
      : [(entry as SessionConfigSelectOption).value],
  );
}

export class AcpAgentSessionFactory implements AgentSessionFactory {
  async create(args: AgentSessionArgs): Promise<AgentSession> {
    return AgentSession.start(args);
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

  static async start(args: AgentSessionArgs): Promise<AgentSession> {
    const { step, cwd, tools, inboundMessage, sink } = args;
    sink.status(`Starting step ${step.id}...`);

    const agentProcess = spawn("opencode", ["acp"], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...globalThis.process.env,
        OPENCODE_ENABLE_QUESTION_TOOL: "1",
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
        reject(new Error(`Failed to spawn opencode agent: ${String(err)}`));
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
          const update = params.update;
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
              sink.log(`Tool: ${update.title} (${update.status})`);
              break;
            case "tool_call_update":
              sink.log(`Tool: ${update.toolCallId}: ${update.status}`);
              break;
          }
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

      
      const modeIds = availableModeIds(sessionResult);
      if (modeIds.length > 0 && !modeIds.includes(step.agent)) {
        throw new Error(
          `Step '${step.id}': agent '${step.agent}' is not a valid mode (available: ${modeIds.join(", ")})`,
        );
      }

      try {
        await connection.setSessionMode({ sessionId, modeId: step.agent });
      } catch (err) {
        throw new Error(
          `Step '${step.id}': failed to set agent '${step.agent}': ${err}`,
        );
      }
      sink.log(`Mode set: ${step.agent}`);

      try {
        await connection.unstable_setSessionModel({
          sessionId,
          modelId: step.model,
        });
        sink.log(`Model set: ${step.model}`);
      } catch (err) {
        throw new Error(
          `Step '${step.id}': failed to set model '${step.model}': ${err}`,
        );
      }

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
