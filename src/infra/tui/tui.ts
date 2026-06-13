import {
  createCliRenderer,
  TextRenderable,
  BoxRenderable,
  ScrollBoxRenderable,
  InputRenderable,
  InputRenderableEvents,
} from "@opentui/core";
import type { CliRenderer, KeyEvent } from "@opentui/core";

import type {
  RunnerEvent,
  RunSummary,
  StreamKind,
  ToolCallView,
} from "../../domain/runner.js";
import { formatRunSummary } from "../../domain/runner.js";
import type { TuiEventSource } from "./event-source.js";
import { C } from "./theme.js";
import {
  SPINNER_FRAMES,
  formatToolCallContent,
  toolCallColor,
} from "./tool-call-format.js";

type Renderer = CliRenderer;

const DETACH_BANNER = "run still alive — `attach` to return";

// Spinner cadence: a frame advances every ~100ms, but the animation only
// starts after a ~200ms appearance delay so fast calls settle straight to ✓/✗
// without ever flashing a braille frame.
const SPINNER_FRAME_MS = 100;
const SPINNER_DELAY_MS = 200;

/** Opaque timer handle; matches whatever the platform timers return. */
export type TimerHandle = ReturnType<typeof setInterval>;

/**
 * Minimal timer surface used by the tool-call spinner. Injectable via
 * `Tui.create` so tests can drive the appearance delay and frame interval with
 * a fake clock instead of real time.
 */
export interface TuiClock {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

const realClock: TuiClock = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
};

interface ToolCallEntry {
  el: TextRenderable;
  view: ToolCallView;
}

export interface TuiHooks {
  exit?: (code: number) => void;
  writeBanner?: (message: string) => void;
}

export class Tui {
  #renderer: Renderer;
  #statusText: TextRenderable;
  #isolationText: TextRenderable;
  #logScroll: ScrollBoxRenderable;
  #inputField: InputRenderable;
  #inputBar: BoxRenderable;

  #msgCounter = 0;
  #streamedEl: { el: TextRenderable; kind: StreamKind; text: string } | null = null;
  #inPrompt = false;
  #attachedSource: TuiEventSource | null = null;
  #detachListeners: Array<() => void> = [];
  #hooks: TuiHooks;
  #shutdownInProgress = false;
  #rendererDestroyed = false;

  // Fold-by-id tool-call lifecycle: one self-updating renderable per call.
  #toolCalls = new Map<string, ToolCallEntry>();
  #clock: TuiClock;
  #spinnerFrame = 0;
  #spinnerInterval: TimerHandle | null = null;
  #spinnerDelay: TimerHandle | null = null;

  private constructor(init: {
    renderer: Renderer;
    statusText: TextRenderable;
    isolationText: TextRenderable;
    logScroll: ScrollBoxRenderable;
    inputField: InputRenderable;
    inputBar: BoxRenderable;
    hooks: TuiHooks;
    clock: TuiClock;
  }) {
    this.#renderer = init.renderer;
    this.#statusText = init.statusText;
    this.#isolationText = init.isolationText;
    this.#logScroll = init.logScroll;
    this.#inputField = init.inputField;
    this.#inputBar = init.inputBar;
    this.#hooks = init.hooks;
    this.#clock = init.clock;
  }

  static async create(
    opts: { hooks?: TuiHooks; renderer?: Renderer; clock?: TuiClock } = {},
  ): Promise<Tui> {
    const renderer =
      opts.renderer ??
      (await createCliRenderer({
        exitOnCtrlC: false,
        clearOnShutdown: true,
      }));

    const statusText = new TextRenderable(renderer, {
      id: "status",
      content: "● Initializing...",
      fg: C.orange,
    });

    // Isolation segment (ADR-004): branch/worktree of an isolated run, shown
    // beside the status in the header. Empty until `setIsolation` populates it,
    // so non-isolated runs render an unchanged single-status header.
    const isolationText = new TextRenderable(renderer, {
      id: "isolation",
      content: "",
      fg: C.dim,
    });

    const logScroll = new ScrollBoxRenderable(renderer, {
      id: "log-scroll",
      width: "100%",
      stickyScroll: true,
      stickyStart: "bottom",
      viewportCulling: true,
    });

    const inputField = new InputRenderable(renderer, {
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
    header.add(isolationText);

    const logWrapper = new BoxRenderable(renderer, {
      id: "log-wrapper",
      width: "100%",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
    });
    logWrapper.add(logScroll);

    const inputBar = new BoxRenderable(renderer, {
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
    inputField.focus();

    return new Tui({
      renderer,
      statusText,
      isolationText,
      logScroll,
      inputField,
      inputBar,
      hooks: opts.hooks ?? {},
      clock: opts.clock ?? realClock,
    });
  }

  attachSource(source: TuiEventSource): () => void {
    if (this.#attachedSource) {
      throw new Error("Tui is already attached to a source");
    }
    this.#attachedSource = source;

    const unsubscribe = source.subscribe((event) => this.onEvent(event));

    const enterHandler = (value: string) => {
      void this.submitInput(value);
    };
    this.#inputField.on(InputRenderableEvents.ENTER, enterHandler);

    const keyHandler = (key: KeyEvent) => {
      if (key.ctrl && key.name === "c") {
        // Ctrl-C kills the TUI only; the run continues without an explicit
        // detach RPC (the daemon will clean up the subscription when the
        // socket closes).
        void this.shutdownWithBanner({ callDetach: false });
      }
    };
    this.#renderer.keyInput.on("keypress", keyHandler);

    this.#detachListeners.push(
      unsubscribe,
      () => this.#inputField.off(InputRenderableEvents.ENTER, enterHandler),
      () => this.#renderer.keyInput.off("keypress", keyHandler),
    );

    return () => this.detach();
  }

  detach(): void {
    this.stopSpinner();
    this.#toolCalls.clear();
    for (const fn of this.#detachListeners) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    this.#detachListeners = [];
    this.#attachedSource = null;
  }

  shutdown(): void {
    this.detach();
    if (!this.#rendererDestroyed) {
      this.#rendererDestroyed = true;
      this.#renderer.destroy();
    }
  }

  onEvent(event: RunnerEvent): void {
    switch (event.type) {
      case "banner":
        // New step: drop the previous step's tool-call entries (their lines
        // stay in the scroll history) and stop any spinner that was running.
        this.clearToolCalls();
        this.renderBanner(event.step.id, event.index, event.step);
        break;
      case "log":
        this.appendLog(event.message, event.color);
        break;
      case "stream":
        this.appendStream(event.kind, event.chunk, event.color);
        break;
      case "tool_call":
        this.renderToolCall(event.call);
        break;
      case "interactive":
        this.setInteractive(event.enabled);
        break;
      case "status":
        this.setStatus(event.text, event.color);
        break;
      case "summary":
        this.renderSummary(event.summary);
        break;
    }
  }

  async submitInput(text: string): Promise<void> {
    const source = this.#attachedSource;
    if (!source) return;

    const trimmed = text.trim();
    if (!trimmed) return;

    if (trimmed === "/detach") {
      this.appendLog(`> ${trimmed}`, C.blue);
      await this.shutdownWithBanner({ callDetach: true });
      return;
    }

    if (trimmed === "/quit" || trimmed === "/exit") {
      this.appendLog(`> ${trimmed}`, C.blue);
      await this.shutdownWithBanner({ callDetach: false });
      return;
    }

    this.appendLog(`> ${trimmed}`, C.blue);

    if (this.#inPrompt) return;

    this.flushStream();
    this.#inPrompt = true;
    this.#inputField.value = "";
    try {
      await source.sendInput(trimmed);
    } catch (err) {
      const msg = String(err);
      if (
        !msg.includes("aborted") &&
        !msg.includes("cancelled") &&
        !msg.includes("canceled")
      ) {
        this.appendLog(`Error: ${err}`, C.red);
      }
    } finally {
      this.#inPrompt = false;
      this.#inputField.focus();
    }
  }

  private async shutdownWithBanner(opts: {
    callDetach: boolean;
  }): Promise<void> {
    if (this.#shutdownInProgress) return;
    this.#shutdownInProgress = true;

    const source = this.#attachedSource;
    if (opts.callDetach && source) {
      try {
        await source.detach();
      } catch {
        // Best-effort: the user asked to detach; if the RPC fails we still
        // tear down the TUI so they regain their terminal.
      }
    }

    this.shutdown();

    const writeBanner =
      this.#hooks.writeBanner ??
      ((message: string) => {
        process.stderr.write(`${message}\n`);
      });
    writeBanner(DETACH_BANNER);

    const exit = this.#hooks.exit ?? ((code: number) => process.exit(code));
    exit(0);
  }

  private flushStream(): void {
    this.#streamedEl = null;
  }

  private appendLog(content: string, color?: string): void {
    this.flushStream();
    const text = new TextRenderable(this.#renderer, {
      id: `msg-${++this.#msgCounter}`,
      content,
      fg: color ?? C.text,
      selectable: true,
    });
    this.#logScroll.add(text);
  }

  private appendStream(kind: StreamKind, chunk: string, color?: string): void {
    if (this.#streamedEl && this.#streamedEl.kind === kind) {
      this.#streamedEl.text += chunk;
      this.#streamedEl.el.content = this.#streamedEl.text;
    } else {
      this.flushStream();
      const text = new TextRenderable(this.#renderer, {
        id: `msg-${++this.#msgCounter}`,
        content: chunk,
        fg: color ?? C.text,
        selectable: true,
      });
      this.#logScroll.add(text);
      this.#streamedEl = { el: text, kind, text: chunk };
    }
  }

  private renderToolCall(view: ToolCallView): void {
    const existing = this.#toolCalls.get(view.toolCallId);
    // Only borrow a live spinner frame while the shared interval is actually
    // running; otherwise the line shows the static affordance and a fast call
    // settles straight to ✓/✗ without flashing a frame.
    const frame =
      this.#spinnerInterval !== null && view.status === "in_progress"
        ? SPINNER_FRAMES[this.#spinnerFrame]
        : undefined;
    const content = formatToolCallContent(view, frame);
    const color = toolCallColor(view.status);

    if (existing) {
      existing.view = view;
      existing.el.content = content;
      existing.el.fg = color;
    } else {
      this.flushStream();
      const el = new TextRenderable(this.#renderer, {
        id: `msg-${++this.#msgCounter}`,
        content,
        fg: color,
        selectable: true,
      });
      this.#logScroll.add(el);
      this.#toolCalls.set(view.toolCallId, { el, view });
    }

    if (view.status === "in_progress") this.ensureSpinner();
  }

  private ensureSpinner(): void {
    if (this.#spinnerInterval !== null || this.#spinnerDelay !== null) return;
    this.#spinnerDelay = this.#clock.setTimeout(() => {
      this.#spinnerDelay = null;
      this.startSpinnerInterval();
    }, SPINNER_DELAY_MS);
  }

  private startSpinnerInterval(): void {
    if (this.#spinnerInterval !== null) return;
    if (!this.hasInProgress()) return;
    this.#spinnerInterval = this.#clock.setInterval(() => {
      this.advanceSpinner();
    }, SPINNER_FRAME_MS);
  }

  private advanceSpinner(): void {
    if (!this.hasInProgress()) {
      this.stopSpinnerInterval();
      return;
    }
    this.#spinnerFrame = (this.#spinnerFrame + 1) % SPINNER_FRAMES.length;
    const frame = SPINNER_FRAMES[this.#spinnerFrame];
    for (const entry of this.#toolCalls.values()) {
      if (entry.view.status === "in_progress") {
        entry.el.content = formatToolCallContent(entry.view, frame);
      }
    }
  }

  private hasInProgress(): boolean {
    for (const entry of this.#toolCalls.values()) {
      if (entry.view.status === "in_progress") return true;
    }
    return false;
  }

  private clearToolCalls(): void {
    this.stopSpinner();
    this.#toolCalls.clear();
  }

  private stopSpinner(): void {
    if (this.#spinnerDelay !== null) {
      this.#clock.clearTimeout(this.#spinnerDelay);
      this.#spinnerDelay = null;
    }
    this.stopSpinnerInterval();
  }

  private stopSpinnerInterval(): void {
    if (this.#spinnerInterval !== null) {
      this.#clock.clearInterval(this.#spinnerInterval);
      this.#spinnerInterval = null;
    }
  }

  /**
   * Surface an isolated run's branch/worktree in the header (ADR-004). Mirrors
   * the `ps` continuation line (`formatIsolationLine`) for cross-CLI
   * consistency. When neither field is present (a non-isolated run) the segment
   * is cleared, leaving the header visually unchanged.
   */
  setIsolation(info: { branch?: string; worktreePath?: string }): void {
    const parts: string[] = [];
    if (info.branch) parts.push(`branch ${info.branch}`);
    if (info.worktreePath) parts.push(`worktree ${info.worktreePath}`);
    this.#isolationText.content =
      parts.length > 0 ? `  ↳ ${parts.join("  ")}` : "";
  }

  /**
   * Show the prompt a run was started with as the opening transcript entry
   * (ADR-003), reading like the user's first message — the same `> {text}`
   * form `submitInput` uses for typed input. Called once from the attach loop
   * alongside `setIsolation`. A no-op when the run had no initial prompt, so the
   * transcript is visually unchanged from today.
   */
  showInitialPrompt(prompt?: string): void {
    if (!prompt) return;
    this.appendLog(`> ${prompt}`, C.blue);
  }

  private setStatus(text: string, color?: string): void {
    this.#statusText.content = `● ${text}`;
    this.#statusText.fg = color ?? C.text;
  }

  private setInteractive(enabled: boolean): void {
    this.#inputBar.height = enabled ? 1 : 0;
  }

  private renderBanner(
    stepId: string,
    index: number,
    step: { agent: string; model: string; mode: string; description: string },
  ): void {
    this.appendLog("", C.dim);
    this.appendLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
    this.appendLog(
      `Step ${index}: ${stepId} [${step.agent} / ${step.model}]`,
      C.cyan,
    );
    this.appendLog(`Mode: ${step.mode}`, C.dim);
    this.appendLog(`Description: ${step.description}`, C.dim);
    this.appendLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
  }

  private renderSummary(summary: RunSummary): void {
    this.appendLog("", C.dim);
    this.appendLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
    const formatted = formatRunSummary(summary);
    for (const line of formatted.split("\n")) {
      this.appendLog(line, summary.failure ? C.red : C.green);
    }
    this.appendLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, C.dim);
    this.appendLog("", C.dim);
    if (summary.failure) {
      this.setStatus("Workflow failed", C.red);
    } else {
      this.setStatus("Workflow completed", C.green);
    }
    this.setInteractive(true);
    this.#inputField.focus();
  }
}
