import type { RpcNotification } from "../../protocol.js";
import type { RpcContext } from "../server.js";

export interface RecordedNotification {
  method: RpcNotification["method"];
  params: unknown;
}

export interface MockRpcContext extends RpcContext {
  /** Notifications captured in the order their `notify()` call was made. */
  readonly notifications: RecordedNotification[];
  /** Resolves when at least `count` notifications have been recorded. */
  waitForNotifications(count: number, timeoutMs?: number): Promise<void>;
  /** Filter helper for the most common assertion. */
  notificationsByMethod(method: RpcNotification["method"]): RecordedNotification[];
  /** Number of onClose callbacks currently registered. */
  readonly closeCallbackCount: number;
  /** Invoke every registered onClose callback exactly once. */
  triggerClose(): void;
}

export function createMockRpcContext(): MockRpcContext {
  const notifications: RecordedNotification[] = [];
  const closeCallbacks: Array<() => void> = [];
  let closed = false;

  const waitForNotifications = async (
    count: number,
    timeoutMs = 1000,
  ): Promise<void> => {
    const start = Date.now();
    while (notifications.length < count) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `Timed out waiting for ${count} notifications (got ${notifications.length})`,
        );
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  const ctx: MockRpcContext = {
    notifications,
    notify: async (method, params) => {
      notifications.push({ method, params });
    },
    onClose: (cb) => {
      closeCallbacks.push(cb);
    },
    waitForNotifications,
    notificationsByMethod: (method) =>
      notifications.filter((n) => n.method === method),
    get closeCallbackCount() {
      return closeCallbacks.length;
    },
    triggerClose: () => {
      if (closed) return;
      closed = true;
      for (const cb of closeCallbacks) {
        try {
          cb();
        } catch {}
      }
    },
  };

  return ctx;
}
