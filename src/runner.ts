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
} from "@agentclientprotocol/sdk";

import type { Step, Workflow } from "./workflow.js";
import type { StepOutcome, WorkflowMcpServer } from "./mcp.js";
import { AcpClient } from "./client.js";

export interface RunOptions {
  workflow: Workflow;
  startStepId: string;
  cwd: string;
  mcp: WorkflowMcpServer;
  ui: RunnerUi;
  currentInputHandler?: { handle: (text: string) => Promise<void> };
  maxIterations?: number;
  _testSessionFactory?: (
    step: Step,
    cwd: string,
    mcp: WorkflowMcpServer,
    ui: RunnerUi,
    inboundMessage: string | null,
    currentInputHandler?: { handle: (text: string) => Promise<void> },
  ) => Promise<StepSession>;
}

export interface RunSummary {
  visited: string[];
  finishMessage: string;
  durationMs: number;
  failure?: { failedStep: string; reason: string };
}

export interface RunnerUi {
  banner(step: Step, index: number, total: number): void;
  log(message: string, color?: string): void;
  appendStream(type: string, chunk: string, color?: string): void;
  setInteractive(enabled: boolean): void;
  setStatus(text: string, color?: string): void;
  summary(summary: RunSummary): void;
  onUserInput?(text: string): Promise<void>;
}

interface StepSession {
  process: ChildProcess;
  connection: ClientSideConnection;
  sessionId: string;
  outcomePromise: Promise<StepOutcome>;
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

export async function runWorkflow(opts: RunOptions): Promise<RunSummary> {
  const startTime = Date.now();
  const visited: string[] = [];
  let finishMessage = "";
  let failure: { failedStep: string; reason: string } | undefined;

  const { workflow, startStepId, cwd, mcp, ui } = opts;
  const maxIterations =
    opts.maxIterations ?? Math.max(1, workflow.steps.length * 10);

  let currentStepId = startStepId;
  let inboundMessage: string | null = null;
  const steps = new Map(workflow.steps.map((s) => [s.id, s]));

  let stepIndex = 1;
  const totalSteps = workflow.steps.length;
  let iterationCount = 0;

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
    const step = steps.get(currentStepId);
    if (!step) {
      failure = {
        failedStep: currentStepId,
        reason: `Step '${currentStepId}' not found in workflow`,
      };
      break;
    }

    visited.push(step.id);
    ui.banner(step, stepIndex, totalSteps);
    stepIndex++;

    let session: StepSession | null = null;

    try {
      const sessionFactory = opts._testSessionFactory || setupStepSession;
      session = await sessionFactory(
        step,
        cwd,
        mcp,
        ui,
        inboundMessage,
        opts.currentInputHandler,
      );

      // Wait for the step outcome with subprocess exit as a race condition
      const stepOutcome = await Promise.race([
        session.outcomePromise,
        new Promise<StepOutcome>((_, reject) => {
          session!.process.once("exit", (code) => {
            reject(
              new Error(
                `Subprocess exited with code ${code} during step '${step.id}'`,
              ),
            );
          });
        }),
      ]);

      // Cancel any in-flight turn and tear down
      try {
        await session.connection.cancel({ sessionId: session.sessionId });
      } catch {
        // Ignore cancellation errors
      }

      teardownSession(session, mcp, opts.currentInputHandler);
      session = null;

      // Handle outcome
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
        teardownSession(session, mcp, opts.currentInputHandler);
      }

      failure = {
        failedStep: step.id,
        reason: String(err),
      };
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

  return summary;
}

async function setupStepSession(
  step: Step,
  cwd: string,
  mcp: WorkflowMcpServer,
  ui: RunnerUi,
  inboundMessage: string | null,
  currentInputHandler?: { handle: (text: string) => Promise<void> },
): Promise<StepSession> {
  ui.setStatus(`Starting step ${step.id}...`);

  const agentProcess = spawn("opencode", ["acp"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...globalThis.process.env,
      OPENCODE_ENABLE_QUESTION_TOOL: "1",
    },
  });

  // Route stderr through UI to prevent TUI corruption
  if (agentProcess.stderr) {
    agentProcess.stderr.on("data", (data: Buffer) => {
      const lines = data
        .toString()
        .split("\n")
        .filter((line) => line.trim());
      for (const line of lines) {
        ui.log(`[${step.id} stderr] ${line}`, "dim");
      }
    });
  }

  // Wait for spawn or handle spawn error (e.g., opencode not found, not executable)
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
      log: (msg: string, color?: string) => ui.log(msg, color),
      requestPermission: async (
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        ui.log(`Permission requested: ${params.toolCall.title}`);
        ui.log(`  Kind: ${params.toolCall.kind}`);
        for (const loc of params.toolCall.locations ?? []) {
          ui.log(`  Path: ${loc.path}`);
        }
  
        // Find the first non-reject option (typically "allow_once" or "allow_always")
        const allowOption = params.options.find(
          (opt) => !opt.kind.startsWith("reject"),
        );
  
        if (allowOption) {
          ui.log(`Auto-approving: ${allowOption.name}`);
          return {
            outcome: { outcome: "selected", optionId: allowOption.optionId },
          };
        }
  
        // If only reject options exist, cancel
        ui.log("No non-reject option available, cancelling");
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
            ui.appendStream("message", text);
            break;
          }
          case "agent_thought_chunk":
            if (update.content.type === "text") {
              ui.appendStream("thought", update.content.text);
            }
            break;
          case "tool_call":
            ui.log(`Tool: ${update.title} (${update.status})`);
            break;
          case "tool_call_update":
            ui.log(`Tool: ${update.toolCallId}: ${update.status}`);
            break;
        }
      },
      writeTextFile: async (
        params: WriteTextFileRequest,
      ): Promise<WriteTextFileResponse> => {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(params.path, params.content, "utf-8");
        ui.log(`Wrote ${params.path}`);
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
  
    // Arm the MCP server for this step BEFORE establishing the session, so that tools/list
    // sees the correct currentStep when the MCP client initializes
    let outcomeResolve: ((outcome: StepOutcome) => void) | null = null;
    const outcomePromise = new Promise<StepOutcome>((resolve) => {
      outcomeResolve = resolve;
    });
    const stepToken = mcp.beginStep(step, outcomeResolve!);
  
    // Initialize and check for HTTP MCP capability
    const initResult = await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: true, writeTextFile: true },
      },
    });
  
    if (!(initResult as any).agentCapabilities?.mcpCapabilities?.http) {
      throw new Error(
        "Agent does not support HTTP MCP capabilities, which are required for workflow orchestration",
      );
    }
  
    // Create session with MCP server
    const sessionResult = await connection.newSession({
      cwd,
      mcpServers: [
        {
          type: "http",
          name: "workflow",
          url: mcp.url,
          headers: [
            { name: "x-workflow-step-token", value: stepToken },
          ],
        },
      ],
    });
  
    const sessionId = sessionResult.sessionId;
    ui.log(`Session created: ${sessionId}`);
  
    // Validate and set mode
    const availableModes = sessionResult.modes?.availableModes ?? [];
    const modeExists = availableModes.some((m) => m.id === step.agent);
  
    if (!modeExists) {
      throw new Error(
        `Step '${step.id}': agent '${step.agent}' is not a valid mode (available: ${availableModes.map((m) => m.id).join(", ")})`,
      );
    }
  
    await connection.setSessionMode({
      sessionId,
      modeId: step.agent,
    });
    ui.log(`Mode set: ${step.agent}`);
  
    // Set model (unstable method)
    try {
      await connection.unstable_setSessionModel({
        sessionId,
        modelId: step.model,
      });
      ui.log(`Model set: ${step.model}`);
    } catch (err) {
      throw new Error(
        `Step '${step.id}': failed to set model '${step.model}': ${err}`,
      );
    }
  
    // Set interactive/autonomous mode for UI
    ui.setInteractive(step.mode === "interactive");
  
    // Build and send kickoff prompt
    const kickoffPrompt = buildKickoffPrompt(step, inboundMessage);
    ui.log(`Kickoff: ${step.description}`);
  
    // For autonomous steps, if the kickoff prompt completes without the outcome being resolved,
    // that means the agent didn't call handoff or finish, which is a failure
    if (step.mode === "autonomous") {
      const kickoffPromise = connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: kickoffPrompt }],
      });
  
      // Race: outcome (from tool call) vs. prompt completion (no tool call = failure)
      const racePromise = Promise.race([
        outcomePromise,
        kickoffPromise.then(() => ({
          kind: "failure" as const,
          failedStep: step.id,
          reason: "Autonomous step completed without calling handoff or finish",
        })),
      ]);
  
      return {
        process: agentProcess,
        connection,
        sessionId,
        outcomePromise: racePromise as Promise<StepOutcome>,
      };
    } else {
      // Interactive mode: send kickoff and wait for tool call (happens via user input)
      const kickoffResult = await connection.prompt({
        sessionId,
        prompt: [{ type: "text", text: kickoffPrompt }],
      });
      ui.log(`[${kickoffResult.stopReason}]`);
  
      // Register this step's connection as the handler for user input
      if (currentInputHandler) {
        currentInputHandler.handle = async (text: string) => {
          try {
            const result = await connection.prompt({
              sessionId,
              prompt: [{ type: "text", text }],
            });
            ui.log(`[${result.stopReason}]`);
          } catch (err) {
            const msg = String(err);
            if (
              !msg.includes("aborted") &&
              !msg.includes("cancelled") &&
              !msg.includes("canceled")
            ) {
              ui.log(`Error: ${err}`);
            }
          }
        };
      }
  
      return {
        process: agentProcess,
        connection,
        sessionId,
        outcomePromise,
      };
    }
} catch (err) {
  agentProcess.kill();
  mcp.resetStep();
  throw err;
}
}

const modeInstructions: Record<Step["mode"], string> = {
  interactive:
    "This is an interactive step — you must ask the user to approve a handoff or finish before completing.",
  autonomous:
    "This is an autonomous step — after completing the work, **call handoff (if continuing to a next step is appropriate) or finish with a summary**. Do NOT wait for user approval — you must resolve the outcome yourself.",
};

export function buildKickoffPrompt(step: Step, inboundMessage: string | null): string {
  let prompt = `${modeInstructions[step.mode]}\n\n${step.description}`;
  if (inboundMessage) {
    prompt += `\n\nContext from previous step: ${inboundMessage}`;
  }
  return prompt;
}

function teardownSession(
  session: StepSession,
  mcp: WorkflowMcpServer,
  currentInputHandler?: { handle: (text: string) => Promise<void> },
): void {
  try {
    if (session.process) {
      session.process.kill();
    }
  } catch {
    // Process already exited
  }
  mcp.resetStep();

  if (currentInputHandler) {
    currentInputHandler.handle = async () => {};
  }
}
