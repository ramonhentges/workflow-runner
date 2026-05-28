import type { DaemonClient } from "../client.js";
import type { RpcMethods, RpcNotification } from "../../daemon/protocol.js";

export type CallRecord = {
  [M in keyof RpcMethods]: { method: M; params: RpcMethods[M]["params"] };
}[keyof RpcMethods];

type CallResponder = (params: unknown) => unknown | Promise<unknown>;

export interface MockClientOptions {
  /**
   * Per-method responder. Returning a thrown DaemonRpcError simulates a
   * server-side error reply; any other value is delivered as the call's
   * resolved result.
   */
  responders?: Partial<{ [M in keyof RpcMethods]: CallResponder }>;
}

/**
 * In-memory test double for `DaemonClient`. Records every `call` and
 * `subscribe` invocation; exposes hooks for tests to drive responses and
 * synthesize server notifications.
 *
 * The `DaemonClient` interface from `client.ts` uses private (`#`) fields, so
 * this is structurally compatible only through the `as unknown as DaemonClient`
 * cast at the consumer boundary.
 */
export class MockDaemonClient {
  readonly calls: CallRecord[] = [];
  readonly subscriptions: Array<{
    predicate: (n: RpcNotification) => boolean;
    handler: (n: RpcNotification) => void;
    active: boolean;
  }> = [];
  closed = false;
  closeCount = 0;

  #responders: Partial<{ [M in keyof RpcMethods]: CallResponder }>;

  constructor(opts: MockClientOptions = {}) {
    this.#responders = { ...(opts.responders ?? {}) };
  }

  setResponder<M extends keyof RpcMethods>(method: M, fn: CallResponder): void {
    this.#responders[method] = fn;
  }

  async call<M extends keyof RpcMethods>(
    method: M,
    params: RpcMethods[M]["params"],
  ): Promise<RpcMethods[M]["result"]> {
    this.calls.push({ method, params } as CallRecord);
    const responder = this.#responders[method];
    if (!responder) {
      throw new Error(`MockDaemonClient: no responder for ${String(method)}`);
    }
    const result = await responder(params);
    if (result instanceof Error) throw result;
    return result as RpcMethods[M]["result"];
  }

  subscribe(
    predicate: (n: RpcNotification) => boolean,
    handler: (n: RpcNotification) => void,
  ): () => void {
    const entry = { predicate, handler, active: true };
    this.subscriptions.push(entry);
    return () => {
      entry.active = false;
    };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.closeCount += 1;
  }

  /** Drive a fake notification through every still-active subscription. */
  emit(notification: RpcNotification): void {
    for (const sub of this.subscriptions) {
      if (!sub.active) continue;
      let matched = false;
      try {
        matched = sub.predicate(notification);
      } catch {
        matched = false;
      }
      if (matched) sub.handler(notification);
    }
  }

  asClient(): DaemonClient {
    return this as unknown as DaemonClient;
  }
}

export function createMockClient(opts: MockClientOptions = {}): MockDaemonClient {
  return new MockDaemonClient(opts);
}
