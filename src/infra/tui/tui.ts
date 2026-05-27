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
} from "../../domain/runner.js";
import { formatRunSummary } from "../../domain/runner.js";
import type { TuiEventSource } from "./event-source.js";
import { C } from "./theme.js";

type Renderer = CliRenderer;

const DETACH_BANNER = "run still alive — `attach` to return";

export interface TuiHooks {
  exit?: (code: number) => void;
  writeBanner?: (message: string) => void;
}

export class Tui {
  #renderer: Renderer;
  #statusText: TextRenderable;
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

  private constructor(init: {
    renderer: Renderer;
    statusText: TextRenderable;
    logScroll: ScrollBoxRenderable;
    inputField: InputRenderable;
    inputBar: BoxRenderable;
    hooks: TuiHooks;
  }) {
    this.#renderer = init.renderer;
    this.#statusText = init.statusText;
    this.#logScroll = init.logScroll;
    this.#inputField = init.inputField;
    this.#inputBar = init.inputBar;
    this.#hooks = init.hooks;
  }

  static async create(
    opts: { hooks?: TuiHooks; renderer?: Renderer } = {},
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
      logScroll,
      inputField,
      inputBar,
      hooks: opts.hooks ?? {},
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
        this.renderBanner(event.step.id, event.index, event.step);
        break;
      case "log":
        this.appendLog(event.message, event.color);
        break;
      case "stream":
        this.appendStream(event.kind, event.chunk, event.color);
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
