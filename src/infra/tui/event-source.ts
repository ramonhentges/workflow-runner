import type { RunnerEvent } from "../../domain/runner.js";

export interface TuiEventSource {
  subscribe(observer: (event: RunnerEvent) => void): () => void;
  sendInput(text: string): Promise<void>;
  detach(): Promise<void>;
}
