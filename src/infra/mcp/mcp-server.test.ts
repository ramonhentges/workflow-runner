import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { McpServer } from "./mcp-server.js";
import type { Step, Edge } from "../../domain/workflow.js";
import { asStepId } from "../../domain/ids.js";
import type { StepOutcome } from "../../domain/outcome.js";

const sid = asStepId;

describe("McpServer.resolveHandoffTarget", () => {
  it("accepts a declared edge target", () => {
    const edges: Edge[] = [
      { next_step: sid("step-2"), intent: "go to 2" },
      { next_step: sid("step-3"), intent: "go to 3" },
    ];
    const result = McpServer.resolveHandoffTarget("step-2", edges, "step-1");
    expect(result.valid).toBe(true);
  });

  it("rejects an undeclared target", () => {
    const edges: Edge[] = [
      { next_step: sid("step-2"), intent: "go to 2" },
      { next_step: sid("step-3"), intent: "go to 3" },
    ];
    const result = McpServer.resolveHandoffTarget("step-4", edges, "step-1");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("step-4");
      expect(result.reason).toContain("not a valid target");
    }
  });

  it("rejects any target when step has no edges", () => {
    const result = McpServer.resolveHandoffTarget("step-2", [], "step-1");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("no edges");
    }
  });

  it("includes all valid targets in error message", () => {
    const edges: Edge[] = [
      { next_step: sid("step-2"), intent: "go to 2" },
      { next_step: sid("step-3"), intent: "go to 3" },
    ];
    const result = McpServer.resolveHandoffTarget("step-99", edges, "step-1");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toContain("step-2");
      expect(result.reason).toContain("step-3");
    }
  });
});

describe("McpServer", () => {
  let server: McpServer;

  beforeEach(async () => {
    server = await McpServer.start();
  });

  afterEach(async () => {
    await server.close();
  });

  it("returns a URL matching the expected format", () => {
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });

  it("can be created and closed without errors", async () => {
    const s = await McpServer.start();
    await s.close();
    expect(s).toBeDefined();
  });

  it("lists tools for a step with edges", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [
        { next_step: sid("step-2"), intent: "go to 2" },
        { next_step: sid("step-3"), intent: "go to 3" },
      ],
    };

    server.beginStep(step, (_outcome: StepOutcome) => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const result = data.result as Record<string, unknown>;
    const tools = result.tools as unknown[];

    expect(tools.length).toBe(2);
    const handoffTool = tools.find(
      (t: unknown) => (t as Record<string, unknown>).name === "handoff",
    ) as Record<string, unknown> | undefined;
    const finishTool = tools.find(
      (t: unknown) => (t as Record<string, unknown>).name === "finish",
    ) as Record<string, unknown> | undefined;

    expect(handoffTool).toBeDefined();
    expect(finishTool).toBeDefined();

    if (handoffTool) {
      const schema = handoffTool.inputSchema as Record<string, unknown>;
      const properties = schema.properties as Record<string, unknown>;
      const nextStepProp = properties.next_step as Record<string, unknown>;
      expect((nextStepProp.enum as string[]).includes("step-2")).toBe(true);
      expect((nextStepProp.enum as string[]).includes("step-3")).toBe(true);
    }
  });

  it("lists only finish tool for a step without edges", async () => {
    const step: Step = {
      id: sid("step-2"),
      agent: "devils-advocate",
      description: "test",
      mode: "autonomous",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    };

    server.beginStep(step, (_outcome: StepOutcome) => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const result = data.result as Record<string, unknown>;
    const tools = result.tools as unknown[];

    expect(tools.length).toBe(1);
    const finishTool = tools.find(
      (t: unknown) => (t as Record<string, unknown>).name === "finish",
    );
    expect(finishTool).toBeDefined();
  });

  it("resolves handoff with valid target and matching step token", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [
        { next_step: sid("step-2"), intent: "go to 2" },
        { next_step: sid("step-3"), intent: "go to 3" },
      ],
    };

    let resolvedOutcome: unknown = null;
    const stepToken = server.beginStep(step, (outcome: StepOutcome) => {
      resolvedOutcome = outcome;
    });

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": stepToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "handoff",
          arguments: { next_step: "step-2", message: "going to step 2" },
        },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    expect(data.result).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(resolvedOutcome).toEqual({
      kind: "handoff",
      nextStep: sid("step-2"),
      message: "going to step 2",
    });
  });

  it("rejects tools/call without step token when step is armed", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [{ next_step: sid("step-2"), intent: "go to 2" }],
    };

    let resolvedOutcome: unknown = null;
    server.beginStep(step, (outcome: StepOutcome) => {
      resolvedOutcome = outcome;
    });

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "handoff",
          arguments: { next_step: "step-2", message: "going to step 2" },
        },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32001);
    expect(error.message).toContain("Missing step token");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolvedOutcome).toBeNull();
  });

  it("rejects tools/call with mismatched step token", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [{ next_step: sid("step-2"), intent: "go to 2" }],
    };

    let resolvedOutcome: unknown = null;
    server.beginStep(step, (outcome: StepOutcome) => {
      resolvedOutcome = outcome;
    });

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": "wrong-token-123",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "handoff",
          arguments: { next_step: "step-2", message: "going to step 2" },
        },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32001);
    expect(error.message).toContain("Step token mismatch");

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(resolvedOutcome).toBeNull();
  });

  it("rejects tools/call when no step is armed", async () => {
    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": "some-token",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "finish", arguments: { message: "done" } },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32001);
    expect(error.message).toContain("No step currently armed");
  });

  it("tools/list works without step token", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [{ next_step: sid("step-2"), intent: "go to 2" }],
    };

    server.beginStep(step, () => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    expect(data.result).toBeDefined();
  });

  it("resolves failure with invalid handoff target", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [
        { next_step: sid("step-2"), intent: "go to 2" },
        { next_step: sid("step-3"), intent: "go to 3" },
      ],
    };

    let resolvedOutcome: unknown = null;
    const stepToken = server.beginStep(step, (outcome: StepOutcome) => {
      resolvedOutcome = outcome;
    });

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": stepToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "handoff",
          arguments: { next_step: "step-99", message: "going to step 99" },
        },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    expect(data.error).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 10));

    const outcome = resolvedOutcome as Record<string, unknown>;
    expect(outcome.kind).toBe("failure");
    expect(outcome.failedStep).toBe("step-1");
  });

  it("resolves finish with matching step token", async () => {
    const step: Step = {
      id: sid("step-2"),
      agent: "devils-advocate",
      description: "test",
      mode: "autonomous",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    };

    let resolvedOutcome: unknown = null;
    const stepToken = server.beginStep(step, (outcome: StepOutcome) => {
      resolvedOutcome = outcome;
    });

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": stepToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "finish", arguments: { message: "all done" } },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    expect(data.result).toBeDefined();

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(resolvedOutcome).toEqual({ kind: "finish", message: "all done" });
  });

  it("handles CORS preflight requests", async () => {
    const response = await fetch(`${server.url}`, { method: "OPTIONS" });
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("returns -32602 error for tools/call with missing params (when token is valid)", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [{ next_step: sid("step-2"), intent: "go to 2" }],
    };

    const stepToken = server.beginStep(step, () => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": stepToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("Invalid params");
  });

  it("returns -32602 error for tools/call with missing arguments (when token is valid)", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [{ next_step: sid("step-2"), intent: "go to 2" }],
    };

    const stepToken = server.beginStep(step, () => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": stepToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "handoff" },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32602);
  });

  it("returns -32602 error for finish without message (when token is valid)", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    };

    const stepToken = server.beginStep(step, () => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": stepToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "finish", arguments: {} },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("message");
  });

  it("returns -32602 error for handoff without required fields (when token is valid)", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [{ next_step: sid("step-2"), intent: "go to 2" }],
    };

    const stepToken = server.beginStep(step, () => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-workflow-step-token": stepToken,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "handoff", arguments: { next_step: "step-2" } },
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32602);
    expect(error.message).toContain("handoff");
  });

  it("returns -32601 error for unknown method", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    };

    server.beginStep(step, () => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "unknown/method",
      }),
    });

    const data = (await response.json()) as Record<string, unknown>;
    const error = data.error as Record<string, unknown>;
    expect(error).toBeDefined();
    expect(error.code).toBe(-32601);
  });

  it("handles oversized request body without crashing", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    };

    server.beginStep(step, () => {});

    const largePayload = "x".repeat(2 * 1024 * 1024);

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: largePayload,
    });

    expect(response.status).toBe(413);
    const data = (await response.json()) as Record<string, unknown>;
    expect(data.error).toContain("too large");
  });

  it("does not crash on malformed JSON in request body", async () => {
    const step: Step = {
      id: sid("step-1"),
      agent: "architect",
      description: "test",
      mode: "interactive",
      ide: "opencode",
      model: "big-pickle",
      edges: [],
    };

    server.beginStep(step, () => {});

    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json }",
    });

    expect(response.status).toBe(400);
    const data = (await response.json()) as Record<string, unknown>;
    expect(data.error).toContain("Invalid JSON");
  });

  it("responds to notifications/initialized with 202 Accepted and empty body", async () => {
    const response = await fetch(`${server.url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    });

    expect(response.status).toBe(202);
    const text = await response.text();
    expect(text).toBe("");
  });
});
