import { Workflow, WorkflowConfigError } from "../domain/workflow.js";
import { Runner } from "../domain/runner.js";
import { McpServer } from "../infra/mcp/mcp-server.js";
import { AcpAgentSessionFactory } from "../infra/acp/agent-session.js";
import { Tui } from "../infra/tui/tui.js";
import { parseCliArgs, resolveEntryStep } from "./cli.js";

export async function main(argv: string[]): Promise<number> {
  const cliArgs = parseCliArgs(argv);
  if (cliArgs.error) {
    console.error(`Error: ${cliArgs.error}`);
    return 1;
  }

  let workflow: Workflow;
  try {
    workflow = await Workflow.load(cliArgs.workflowPath);
  } catch (err) {
    if (err instanceof WorkflowConfigError) {
      console.error(`Config error: ${err.message}`);
    } else {
      console.error(`Failed to load workflow: ${err}`);
    }
    return 1;
  }

  const entry = resolveEntryStep(workflow, cliArgs.startStepId);
  if (entry.error) {
    console.error(`Error: ${entry.error}`);
    return 1;
  }

  let exitCode = 0;
  let tui: Tui | null = null;
  let mcp: McpServer | null = null;

  let resolveQuit!: () => void;
  const quitPromise = new Promise<void>((resolve) => {
    resolveQuit = resolve;
  });

  try {
    mcp = await McpServer.start();
    const sessionFactory = new AcpAgentSessionFactory();
    const runner = new Runner(workflow, sessionFactory, mcp, {
      cwd: process.cwd(),
    });

    tui = await Tui.create({
      onQuit: () => {
        tui?.shutdown();
        resolveQuit();
      },
    });
    tui.attach(runner);

    const summary = await runner.run(entry.stepId);
    exitCode = summary.failure ? 1 : 0;
  } catch (err) {
    if (tui) {
      tui.onEvent({ type: "log", message: "" });
      tui.onEvent({ type: "log", message: `Fatal error: ${err}` });
      tui.onEvent({ type: "status", text: "Failed" });
    } else {
      console.error(`Fatal: ${err}`);
      resolveQuit();
    }
    exitCode = 1;
  }

  // Keep the TUI alive so the user can read the summary, then wait for an
  // explicit quit (Ctrl+C or /quit) before tearing down. Returning early
  // without destroying the renderer leaves the terminal in raw/alt-screen mode.
  if (tui) {
    await quitPromise;
  }

  if (mcp) {
    // The dying agent subprocess may briefly hold its keep-alive HTTP
    // connection open. Don't let that block app shutdown.
    await Promise.race([
      mcp.close().catch(() => {}),
      new Promise<void>((resolve) => setTimeout(resolve, 500)),
    ]);
  }

  return exitCode;
}
