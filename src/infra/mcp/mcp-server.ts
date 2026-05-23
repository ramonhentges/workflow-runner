import * as http from "node:http";
import { randomUUID } from "node:crypto";
import type { Step, Edge } from "../../domain/workflow.js";
import type { StepOutcome } from "../../domain/outcome.js";
import { asStepId, asStepToken, type StepToken } from "../../domain/ids.js";

export class McpServer {
  #server: http.Server;
  #url: string;
  #currentStep: Step | null = null;
  #currentResolve: ((outcome: StepOutcome) => void) | null = null;
  #currentStepToken: StepToken | null = null;

  private constructor() {
    this.#server = http.createServer((req, res) => this.handleRequest(req, res));
    this.#url = "";
  }

  static async start(): Promise<McpServer> {
    const mcp = new McpServer();
    await new Promise<void>((resolve, reject) => {
      mcp.#server.once("error", reject);
      mcp.#server.listen(0, "127.0.0.1", () => {
        const addr = mcp.#server.address();
        if (addr && typeof addr !== "string") {
          mcp.#url = `http://127.0.0.1:${addr.port}/mcp`;
          resolve();
        } else {
          reject(new Error("Failed to get server address"));
        }
      });
    });
    return mcp;
  }

  get url(): string {
    return this.#url;
  }

  beginStep(step: Step, resolve: (outcome: StepOutcome) => void): StepToken {
    this.#currentStep = step;
    this.#currentResolve = resolve;
    this.#currentStepToken = asStepToken(randomUUID());
    return this.#currentStepToken;
  }

  resetStep(): void {
    this.#currentStep = null;
    this.#currentResolve = null;
    this.#currentStepToken = null;
  }

  async close(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.#server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  static resolveHandoffTarget(
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
    if (!validTargets.includes(asStepId(nextStep))) {
      return {
        valid: false,
        reason: `'${nextStep}' is not a valid target from step '${currentStepId}'; valid targets: ${validTargets.join(", ")}`,
      };
    }

    return { valid: true };
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
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
        this.dispatch(data, res, req.headers);
      } catch {
        if (!res.headersSent) {
          res.writeHead(400);
        }
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  }

  private dispatch(
    data: unknown,
    res: http.ServerResponse,
    headers: http.IncomingHttpHeaders,
  ): void {
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
            capabilities: { tools: {} },
            serverInfo: { name: "workflow-runner", version: "1.0.0" },
          },
        }),
      );
      return;
    }

    if (method === "tools/list") {
      this.handleToolsList(req, res);
      return;
    }

    if (method === "tools/call") {
      this.handleToolsCall(req, res, requestStepToken);
      return;
    }

    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: "Method not found" },
      }),
    );
  }

  private handleToolsList(
    req: Record<string, unknown>,
    res: http.ServerResponse,
  ): void {
    const tools: unknown[] = [];

    if (this.#currentStep && this.#currentStep.edges.length > 0) {
      const handoffEnum = this.#currentStep.edges.map((e) => e.next_step);
      const edgeDescriptions = this.#currentStep.edges
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
          message: { type: "string", description: "Final message" },
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
  }

  private handleToolsCall(
    req: Record<string, unknown>,
    res: http.ServerResponse,
    requestStepToken: string | string[] | undefined,
  ): void {
    if (!this.#currentStepToken) {
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

    if (requestStepToken !== this.#currentStepToken) {
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

    if (toolName === "handoff" && this.#currentStep && this.#currentResolve) {
      this.handleHandoff(req, res, toolInput);
      return;
    }

    if (toolName === "finish" && this.#currentResolve) {
      this.handleFinish(req, res, toolInput);
      return;
    }

    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32601, message: "Method not found" },
      }),
    );
  }

  private handleHandoff(
    req: Record<string, unknown>,
    res: http.ServerResponse,
    toolInput: Record<string, unknown>,
  ): void {
    if (
      typeof toolInput.next_step !== "string" ||
      typeof toolInput.message !== "string"
    ) {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: -32602,
            message:
              "Invalid params: handoff requires next_step and message strings",
          },
        }),
      );
      return;
    }

    const nextStep = toolInput.next_step;
    const message = toolInput.message;
    const step = this.#currentStep!;
    const resolve = this.#currentResolve!;

    const validation = McpServer.resolveHandoffTarget(
      nextStep,
      step.edges,
      step.id,
    );

    if (!validation.valid) {
      resolve({
        kind: "failure",
        failedStep: step.id,
        reason: validation.reason,
      });
      this.#currentResolve = null;
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32603, message: validation.reason },
        }),
      );
      return;
    }

    resolve({
      kind: "handoff",
      nextStep: asStepId(nextStep),
      message,
    });
    this.#currentResolve = null;
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: { content: [{ type: "text", text: "Handoff accepted" }] },
      }),
    );
  }

  private handleFinish(
    req: Record<string, unknown>,
    res: http.ServerResponse,
    toolInput: Record<string, unknown>,
  ): void {
    if (typeof toolInput.message !== "string") {
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: -32602,
            message: "Invalid params: finish requires message string",
          },
        }),
      );
      return;
    }

    const resolve = this.#currentResolve!;
    resolve({ kind: "finish", message: toolInput.message });
    this.#currentResolve = null;
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        result: { content: [{ type: "text", text: "Workflow finished" }] },
      }),
    );
  }
}
