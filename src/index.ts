#!/usr/bin/env node

import { exit } from "node:process";

import { loadWorkflow, WorkflowConfigError } from "./workflow.js";
import { createWorkflowMcpServer } from "./mcp.js";
import { runWorkflow, formatRunSummary } from "./runner.js";
import type { Step, Workflow } from "./workflow.js";
import type { RunnerUi, RunSummary } from "./runner.js";

import {
  createCliRenderer,
  TextRenderable,
  BoxRenderable,
  ScrollBoxRenderable,
  InputRenderable,
  InputRenderableEvents,
} from "@opentui/core";
import type { KeyEvent } from "@opentui/core";

const C = {
  bg: "#1a1b26",
  bg2: "#24283b",
  blue: "#7AA2F7",
  green: "#9ECE6A",
  red: "#F7768E",
  yellow: "#E0AF68",
  purple: "#BB9AF7",
  cyan: "#7DCFFF",
  text: "#A9B1D6",
  dim: "#565F89",
  orange: "#FF9E64",
} as const;

type Renderer = Awaited<ReturnType<typeof createCliRenderer>>;

let inPrompt = false;

let renderer: Renderer | null = null;
let statusText: TextRenderable | null = null;
let logScroll: ScrollBoxRenderable | null = null;
let inputField: InputRenderable | null = null;
let inputBar: BoxRenderable | null = null;
let msgCounter = 0;

let streamedEl: { el: TextRenderable; type: string; text: string } | null =
  null;

let currentInputHandler: { handle: (text: string) => Promise<void> } = {
  handle: async () => {},
};

let exitCode = 0;

function flushStream() {
  streamedEl = null;
}

function log(content: string, color?: string) {
  if (!logScroll || !renderer) return;
  flushStream();
  const text = new TextRenderable(renderer, {
    id: `msg-${++msgCounter}`,
    content,
    fg: color ?? C.text,
    selectable: true,
  });
  logScroll.add(text);
}

function appendStream(type: string, chunk: string, color?: string) {
  if (!renderer || !logScroll) return;
  if (streamedEl && streamedEl.type === type) {
    streamedEl.text += chunk;
    streamedEl.el.content = streamedEl.text;
  } else {
    flushStream();
    const text = new TextRenderable(renderer, {
      id: `msg-${++msgCounter}`,
      content: chunk,
      fg: color ?? C.text,
      selectable: true,
    });
    logScroll.add(text);
    streamedEl = { el: text, type, text: chunk };
  }
}

async function handleInput(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return;

  log(`> ${trimmed}`, C.blue);

  if (trimmed === "/quit" || trimmed === "/exit") {
    shutdown();
    return;
  }

  if (inPrompt || !inputField) return;

  flushStream();
  inPrompt = true;
  inputField.value = "";
  try {
    await currentInputHandler.handle(trimmed);
  } catch (err) {
    const msg = String(err);
    if (
      !msg.includes("aborted") &&
      !msg.includes("cancelled") &&
      !msg.includes("canceled")
    ) {
      log(`Error: ${err}`, C.red);
    }
  } finally {
    inPrompt = false;
    inputField?.focus();
  }
}

function cleanup() {
  if (renderer) renderer.destroy();
}

function shutdown() {
  cleanup();
  exit(exitCode);
}

function setStatus(text: string, color?: string) {
  if (statusText) {
    statusText.content = `● ${text}`;
    statusText.fg = color ?? C.text;
  }
}

function setInteractive(enabled: boolean) {
  if (inputBar) {
    inputBar.height = enabled ? 1 : 0;
  }
}

const createRunnerUi = (): RunnerUi => ({
  banner: (step: Step, index: number) => {
    log("", C.dim);
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
    log(
      `Step ${index}: ${step.id} [${step.agent} / ${step.model}]`,
      C.cyan,
    );
    log(`Mode: ${step.mode}`, C.dim);
    log(`Description: ${step.description}`, C.dim);
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
    setStatus(`Running step ${step.id}...`, C.yellow);
  },

  log: (message: string, color?: string) => {
    log(message, color);
  },

  appendStream: (type: string, chunk: string, color?: string) => {
    appendStream(type, chunk, color);
  },

  setInteractive: (enabled: boolean) => {
    setInteractive(enabled);
  },

  setStatus: (text: string, color?: string) => {
    setStatus(text, color);
  },

  summary: (summary: RunSummary) => {
    log("", C.dim);
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
    const formatted = formatRunSummary(summary);
    for (const line of formatted.split("\n")) {
      log(line, summary.failure ? C.red : C.green);
    }
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
    log("", C.dim);
    if (summary.failure) {
      setStatus("Workflow failed", C.red);
    } else {
      setStatus("Workflow completed", C.green);
    }
    setInteractive(true);
    inputField?.focus();
  },
});

export function parseCliArgs(argv: string[]): {
  workflowPath: string;
  startStepId: string | null;
  error?: string;
} {
  if (argv.length < 3) {
    return {
      workflowPath: "",
      startStepId: null,
      error: "Usage: workflow-runner <workflow.json> [--start <step-id>]",
    };
  }

  const workflowPath = argv[2];
  let startStepId: string | null = null;

  if (argv.length >= 5 && argv[3] === "--start") {
    startStepId = argv[4];
  }

  return { workflowPath, startStepId };
}

export function resolveEntryStep(
  workflow: Workflow,
  startStepId: string | null,
): { stepId: string; error?: string } {
  if (!startStepId) {
    if (workflow.steps.length === 0) {
      return { stepId: "", error: "Workflow has no steps" };
    }
    return { stepId: workflow.steps[0].id };
  }

  const step = workflow.steps.find((s) => s.id === startStepId);
  if (!step) {
    return {
      stepId: "",
      error: `Step '${startStepId}' not found in workflow`,
    };
  }

  return { stepId: step.id };
}

async function main() {
  const cliArgs = parseCliArgs(process.argv);
  if (cliArgs.error) {
    console.error(`Error: ${cliArgs.error}`);
    exit(1);
  }

  let workflow: Workflow;
  try {
    workflow = await loadWorkflow(cliArgs.workflowPath);
  } catch (err) {
    if (err instanceof WorkflowConfigError) {
      console.error(`Config error: ${err.message}`);
    } else {
      console.error(`Failed to load workflow: ${err}`);
    }
    exit(1);
  }

  const entryStep = resolveEntryStep(workflow, cliArgs.startStepId);
  if (entryStep.error) {
    console.error(`Error: ${entryStep.error}`);
    exit(1);
  }

  renderer = await createCliRenderer({
    exitOnCtrlC: false,
    clearOnShutdown: true,
  });

  statusText = new TextRenderable(renderer, {
    id: "status",
    content: "● Initializing...",
    fg: C.orange,
  });

  logScroll = new ScrollBoxRenderable(renderer, {
    id: "log-scroll",
    width: "100%",
    stickyScroll: true,
    stickyStart: "bottom",
    viewportCulling: true,
  });

  inputField = new InputRenderable(renderer, {
    id: "main-input",
    width: "100%",
    placeholder: "Type a message... (Ctrl+C to cancel input)",
    backgroundColor: C.bg,
    focusedBackgroundColor: C.bg2,
    textColor: C.text,
    cursorColor: C.blue,
  });

  const header = new BoxRenderable(renderer, {
    id: "header",
    width: "100%",
    height: 1,
    backgroundColor: C.bg,
    flexDirection: "row",
    paddingLeft: 1,
    paddingRight: 1,
  });
  header.add(statusText);

  const logWrapper = new BoxRenderable(renderer, {
    id: "log-wrapper",
    width: "100%",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
  });
  logWrapper.add(logScroll);

  inputBar = new BoxRenderable(renderer, {
    id: "input-bar",
    width: "100%",
    height: 1,
    backgroundColor: C.bg,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 1,
    paddingRight: 1,
  });
  inputBar.add(inputField);

  const mainLayout = new BoxRenderable(renderer, {
    id: "main-layout",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    backgroundColor: C.bg,
  });
  mainLayout.add(header);
  mainLayout.add(logWrapper);
  mainLayout.add(inputBar);

  renderer.root.add(mainLayout);

  renderer.keyInput.on("keypress", (key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      shutdown();
    }
  });

  inputField.on(InputRenderableEvents.ENTER, (value: string) => {
    handleInput(value);
  });

  inputField.focus();

  let mcp = null;

  try {
    mcp = await createWorkflowMcpServer();

    const runnerUi = createRunnerUi();

    const summary = await runWorkflow({
      workflow,
      startStepId: entryStep.stepId,
      cwd: process.cwd(),
      mcp,
      ui: runnerUi,
      currentInputHandler,
    });

    runnerUi.summary(summary);

    if (summary.failure) {
      exitCode = 1;
    } else {
      exitCode = 0;
    }
  } catch (err) {
    log(``, C.dim);
    log(`Fatal error: ${err}`, C.red);
    setStatus("Failed", C.red);
    exitCode = 1;
  } finally {
    if (mcp) {
      await mcp.close().catch(() => {});
    }
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(`Fatal: ${err}`);
    cleanup();
    exit(1);
  });
}
