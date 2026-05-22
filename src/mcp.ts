import * as http from "node:http";
import { randomUUID } from "node:crypto";
import type { Step, Edge } from "./workflow.js";

export type StepOutcome =
  | { kind: "handoff"; nextStep: string; message: string }
  | { kind: "finish"; message: string }
  | { kind: "failure"; failedStep: string; reason: string };

export interface WorkflowMcpServer {
  readonly url: string;
  beginStep(step: Step, resolve: (outcome: StepOutcome) => void): string;
  resetStep(): void;
  close(): Promise<void>;
}

export function resolveHandoffTarget(
  nextStep: string,
  edges: Edge[],
  currentStepId: string,
): { valid: true } | { valid: false; reason: string } {
  if (edges.length === 0) {
    return {
      valid: false,
      reason: `Step '${currentStepId}' has no edges; handoff is not available`,
    };
  }

  const validTargets = edges.map((e) => e.next_step);
  if (!validTargets.includes(nextStep)) {
    return {
      valid: false,
      reason: `'${nextStep}' is not a valid target from step '${currentStepId}'; valid targets: ${validTargets.join(", ")}`,
    };
  }

  return { valid: true };
}

export async function createWorkflowMcpServer(): Promise<WorkflowMcpServer> {
  let server: http.Server | null = null;
  let resolvedUrl = "";
  let currentStep: Step | null = null;
  let currentResolve: ((outcome: StepOutcome) => void) | null = null;
  let currentStepToken: string | null = null;

  const startServer = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      server = http.createServer((req, res) => {
        if (req.method === "OPTIONS") {
          res.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          });
          res.end();
          return;
        }

        if (req.method !== "POST") {
          res.writeHead(404);
          res.end();
          return;
        }

        const MAX_BODY_SIZE = 1024 * 1024; // 1MB
        const chunks: Buffer[] = [];
        let totalSize = 0;
        let sizeExceeded = false;

        req.on("data", (chunk: Buffer) => {
          if (sizeExceeded) return;
          totalSize += chunk.length;
          if (totalSize > MAX_BODY_SIZE) {
            sizeExceeded = true;
            res.writeHead(413, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Request body too large" }));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });

         req.on("end", () => {
           if (sizeExceeded) return;
           try {
             const body = Buffer.concat(chunks).toString("utf-8");
             const data = JSON.parse(body);
             handleMcpRequest(data, res, req.headers);
           } catch (err) {
             if (!res.headersSent) {
               res.writeHead(400);
             }
             res.end(JSON.stringify({ error: "Invalid JSON" }));
           }
         });
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server!.address();
        if (addr && typeof addr !== "string") {
          const port = addr.port;
          resolvedUrl = `http://127.0.0.1:${port}/mcp`;
          resolve(resolvedUrl);
        } else {
          reject(new Error("Failed to get server address"));
        }
      });

      server.on("error", reject);
    });
  };

  const handleMcpRequest = (data: unknown, res: http.ServerResponse, headers: http.IncomingHttpHeaders) => {
    const req = data as Record<string, unknown>;
    const method = req.jsonrpc === "2.0" ? req.method : "unknown";
    const requestStepToken = headers["x-workflow-step-token"];

    if (method === "notifications/initialized") {
      res.writeHead(202);
      res.end();
      return;
    }

    if (!res.headersSent) {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
    }

    if (method === "initialize") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: {
              tools: {},
            },
            serverInfo: {
              name: "workflow-runner",
              version: "1.0.0",
            },
          },
        }),
      );
      return;
    }

    if (method === "tools/list") {
      const tools = [];

      if (currentStep && currentStep.edges.length > 0) {
        const handoffEnum = currentStep.edges.map((e) => e.next_step);
        const edgeDescriptions = currentStep.edges
          .map((e) => `- ${e.next_step}: ${e.intent}`)
          .join("\n");

        tools.push({
          name: "handoff",
          description: `Route to the next step. Available targets:\n${edgeDescriptions}`,
          inputSchema: {
            type: "object",
            properties: {
              next_step: {
                type: "string",
                enum: handoffEnum,
                description: "The target step to route to",
              },
              message: {
                type: "string",
                description: "Message to pass to the next step",
              },
            },
            required: ["next_step", "message"],
          },
        });
      }

      tools.push({
        name: "finish",
        description: "End the workflow",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Final message",
            },
          },
          required: ["message"],
        },
      });

      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          result: { tools },
        }),
      );
      return;
    }

    if (method === "tools/call") {
      if (!currentStepToken) {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32001, message: "No step currently armed" },
          }),
        );
        return;
      }

      if (!requestStepToken) {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32001, message: "Missing step token" },
          }),
        );
        return;
      }

      if (requestStepToken !== currentStepToken) {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32001, message: "Step token mismatch" },
          }),
        );
        return;
      }

      const params = req.params as Record<string, unknown>;
      if (
        !params ||
        typeof params !== "object" ||
        typeof params.name !== "string" ||
        typeof params.arguments !== "object" ||
        !params.arguments
      ) {
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            error: { code: -32602, message: "Invalid params" },
          }),
        );
        return;
      }

      const toolName = params.name;
      const toolInput = params.arguments as Record<string, unknown>;

      if (toolName === "handoff" && currentStep && currentResolve) {
        if (typeof toolInput.next_step !== "string" || typeof toolInput.message !== "string") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32602, message: "Invalid params: handoff requires next_step and message strings" },
            }),
          );
          return;
        }

        const nextStep = toolInput.next_step;
        const message = toolInput.message;

        const validation = resolveHandoffTarget(
          nextStep,
          currentStep.edges,
          currentStep.id,
        );

        if (!validation.valid) {
          if (currentResolve) {
            currentResolve({
              kind: "failure",
              failedStep: currentStep.id,
              reason: validation.reason,
            });
            currentResolve = null;
          }
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32603, message: validation.reason },
            }),
          );
        } else {
          if (currentResolve) {
            currentResolve({
              kind: "handoff",
              nextStep,
              message,
            });
            currentResolve = null;
          }
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              result: { content: [{ type: "text", text: "Handoff accepted" }] },
            }),
          );
        }
        return;
      }

      if (toolName === "finish" && currentResolve) {
        if (typeof toolInput.message !== "string") {
          res.end(
            JSON.stringify({
              jsonrpc: "2.0",
              id: req.id,
              error: { code: -32602, message: "Invalid params: finish requires message string" },
            }),
          );
          return;
        }

        const message = toolInput.message;
        if (currentResolve) {
          currentResolve({
            kind: "finish",
            message,
          });
          currentResolve = null;
        }
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id,
            result: { content: [{ type: "text", text: "Workflow finished" }] },
          }),
        );
        return;
      }

      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: "Method not found" },
        }),
      );
      return;
    }

    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32601,
          message: "Method not found",
        },
      }),
    );
  };

  await startServer();

  return {
    get url() {
      return resolvedUrl;
    },
    beginStep(step: Step, resolve: (outcome: StepOutcome) => void): string {
      currentStep = step;
      currentResolve = resolve;
      currentStepToken = randomUUID();
      return currentStepToken;
    },
    resetStep() {
      currentStep = null;
      currentResolve = null;
      currentStepToken = null;
    },
    async close() {
      return new Promise<void>((resolve, reject) => {
        if (server) {
          server.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });
    },
  };
}
