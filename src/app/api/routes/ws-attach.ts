import { upgradeWebSocket, websocket } from "hono/bun";
import type { WSContext } from "hono/ws";
import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  RunManagerError,
  type RunManager,
  type RunSubscriber,
} from "../../../infra/daemon/run-manager.js";
import { RpcErrorCode } from "../../../infra/daemon/protocol.js";
import type { EventLogEntry } from "../../../infra/daemon/event-log.js";
import {
  AttachFrameSchema,
  ClientFrameSchema,
  EventsQuerySchema,
  type AttachFrame,
} from "../schema.js";
import { isOriginAllowed } from "../security.js";

export { websocket };

export const MAX_WS_CONNECTIONS = 50;
export const IDLE_TIMEOUT_MS = 30_000;
export const MAX_OUTBOUND_FRAMES = 256;

const WS_SHUTDOWN_CLOSE_CODE = 1001; // Going Away
const WS_SHUTDOWN_CLOSE_REASON = "server shutting down";

/**
 * Registry of open WebSocket connections for graceful shutdown draining.
 * Created in runDaemon and passed through createApiApp → registerWsAttachRoute.
 */
export interface WsConnectionRegistry {
  register(ws: WSContext): void;
  unregister(ws: WSContext): void;
  /**
   * Send a close frame to every registered connection. If there are none,
   * returns 0 immediately (no grace-period wait). Otherwise waits graceMs
   * after sending close frames and returns the number of connections drained.
   */
  drain(graceMs?: number): Promise<number>;
}

export function createWsConnectionRegistry(): WsConnectionRegistry {
  const connections = new Set<WSContext>();
  return {
    register(ws) {
      connections.add(ws);
    },
    unregister(ws) {
      connections.delete(ws);
    },
    async drain(graceMs = 200) {
      const count = connections.size;
      if (count === 0) return 0;
      for (const ws of connections) {
        try {
          ws.close(WS_SHUTDOWN_CLOSE_CODE, WS_SHUTDOWN_CLOSE_REASON);
        } catch {}
      }
      await new Promise<void>((resolve) => setTimeout(resolve, graceMs));
      return count;
    },
  };
}

export interface PerConnectionOpts {
  idleTimeoutMs?: number;
  maxOutboundFrames?: number;
  /** If set, onOpen immediately sends an error frame with this message and closes the connection. */
  fromSeqError?: string;
}

/**
 * Registers the WS /runs/:id/attach route on the provided Hono app.
 *
 * Pre-upgrade middleware handles Origin allowlist, max-connections cap, and
 * run resolution — all returning HTTP responses. The WS upgrade and all
 * per-connection lifecycle is handled by createPerConnectionState.
 *
 * When `port` is undefined (test mode without a port) Origin check is skipped,
 * matching the pattern used by hostAllowlistMiddleware in app.ts.
 *
 * When `registry` is provided, open connections are tracked so they can be
 * drained (close frame sent) during graceful shutdown (Task 14).
 */
export function registerWsAttachRoute(
  app: OpenAPIHono,
  rm: RunManager,
  port?: number,
  registry?: WsConnectionRegistry,
): void {
  let activeConnections = 0;

  app.get(
    "/runs/:id/attach",
    // Pre-upgrade middleware: HTTP-level rejections before the upgrade occurs.
    async (c, next) => {
      // Origin allowlist — only enforced when a port is configured (production).
      if (port !== undefined) {
        const origin = c.req.header("Origin");
        if (!isOriginAllowed(origin, port)) {
          return c.text("Forbidden", 403);
        }
      }

      // Max-connections cap.
      if (activeConnections >= MAX_WS_CONNECTIONS) {
        return c.text("Too Many Connections", 503);
      }

      // Run resolution — exact id or unambiguous slug-prefix.
      const id = c.req.param("id");
      let active;
      try {
        active = rm.get(id);
      } catch (err) {
        if (
          err instanceof RunManagerError &&
          err.code === RpcErrorCode.AMBIGUOUS_PREFIX
        ) {
          const data = err.data as { candidates: string[] } | undefined;
          return c.json(
            {
              code: "AMBIGUOUS_PREFIX",
              message: err.message,
              candidates: data?.candidates ?? [],
            },
            409,
          );
        }
        throw err;
      }

      if (!active) {
        return c.json(
          { code: "UNKNOWN_RUN", message: `Unknown run: ${id}` },
          404,
        );
      }

      return next();
    },

    // WebSocket upgrade — factory is called synchronously during upgrade request.
    upgradeWebSocket((c) => {
      const id = c.req.param("id") ?? "";
      const fromSeqStr = c.req.query("fromSeq");
      let fromSeq: number | undefined;
      let fromSeqError: string | undefined;
      if (fromSeqStr !== undefined && fromSeqStr !== "") {
        const result = EventsQuerySchema.shape.fromSeq.safeParse(fromSeqStr);
        if (result.success) {
          fromSeq = result.data;
        } else {
          fromSeqError = "Invalid fromSeq: must be a non-negative integer";
        }
      }

      // Use a container so the WSContext can be shared between onOpen (where it
      // first becomes available) and the cleanup callback (where it must be
      // removed from the registry). A plain `let` would be narrowed to null by
      // TypeScript's CFA; an object container avoids that pitfall.
      const wsRef: { current: WSContext | null } = { current: null };

      const state = createPerConnectionState(rm, id, fromSeq, () => {
        activeConnections = Math.max(0, activeConnections - 1);
        if (wsRef.current !== null) {
          registry?.unregister(wsRef.current);
          wsRef.current = null;
        }
      }, { fromSeqError });

      return {
        onOpen: (_, ws) => {
          // Increment here rather than in the factory so that an upgrade that
          // aborts before onOpen fires (neither onOpen nor onClose will run)
          // never consumes a slot. Bun guarantees onClose fires iff onOpen
          // fired, so every increment here has a guaranteed matching decrement
          // in onCleanedUp.
          activeConnections++;
          wsRef.current = ws;
          registry?.register(ws);
          void state.onOpen(ws);
        },
        onMessage: async (evt, ws) => {
          let data: string | null = null;
          if (typeof evt.data === "string") {
            data = evt.data;
          } else if (evt.data instanceof Blob) {
            data = await evt.data.text();
          } else if (evt.data instanceof ArrayBuffer) {
            data = new TextDecoder().decode(evt.data);
          }
          if (data !== null) {
            await state.onMessage(ws, data);
          }
        },
        onClose: () => {
          state.onClose();
        },
      };
    }),
  );
}

/**
 * Creates per-connection state for a WS attach session.
 * Exported to allow direct unit testing of onOpen/onMessage/onClose without
 * requiring a real Bun.serve server.
 *
 * Ports the race-fixed backlog → subscribe → flush → gap-read ordering from
 * src/infra/daemon/handlers/run-attach.ts, replacing ctx.notify with lean
 * AttachFrame sends.
 */
export function createPerConnectionState(
  rm: RunManager,
  id: string,
  fromSeq: number | undefined,
  onCleanedUp: () => void,
  opts: PerConnectionOpts = {},
): {
  onOpen(ws: WSContext): Promise<void>;
  onMessage(ws: WSContext, data: string): Promise<void>;
  onClose(): void;
} {
  const idleTimeoutMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
  const maxOutboundFrames = opts.maxOutboundFrames ?? MAX_OUTBOUND_FRAMES;

  let capturedWs: WSContext | null = null;
  let detach: (() => void) | null = null;
  let ownedEventLog: { close(): Promise<void> } | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let cleanedUp = false;
  let backpressureCount = 0;

  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    onCleanedUp();
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
    if (detach !== null) {
      try {
        detach();
      } catch {}
      detach = null;
    }
    if (ownedEventLog !== null) {
      ownedEventLog.close().catch(() => {});
      ownedEventLog = null;
    }
  };

  /**
   * Sends a lean AttachFrame as a JSON text frame.
   *
   * Uses ws.raw.send() when available (Bun's native ServerWebSocket.send
   * returns a status code) so backpressure can be detected and the connection
   * closed on overflow. Falls back to ws.send() for test mocks without raw.
   *
   * Bun's send returns: >0 = sent, 0 = backpressured, <0 = closed.
   */
  const sendFrame = (frame: AttachFrame): boolean => {
    if (cleanedUp) return false;
    const ws = capturedWs;
    if (!ws || ws.readyState !== 1) return false;

    const json = JSON.stringify(frame);

    // Access Bun's native send for backpressure feedback when available.
    const raw = ws.raw as { send?: (d: string) => unknown } | undefined;
    if (raw?.send) {
      const status = raw.send(json);
      if (typeof status === "number") {
        if (status < 0) {
          // Connection closed from the Bun side.
          return false;
        }
        if (status === 0) {
          // Backpressured: buffer is growing.
          backpressureCount++;
          if (backpressureCount >= maxOutboundFrames) {
            ws.close(1008, "outbound buffer overflow");
            cleanup();
            return false;
          }
        } else {
          // Successfully sent: buffer is draining.
          backpressureCount = Math.max(0, backpressureCount - 1);
        }
      }
      // Sent (numeric success or non-numeric status from test mock).
      resetIdleTimer();
      return true;
    }

    // Fallback: Hono's ws.send() (no status feedback).
    ws.send(json);
    resetIdleTimer();
    return true;
  };

  const resetIdleTimer = (): void => {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      const ws = capturedWs;
      if (ws && ws.readyState === 1) {
        ws.close(1001, "idle timeout");
      }
    }, idleTimeoutMs);
  };

  return {
    async onOpen(ws: WSContext): Promise<void> {
      if (cleanedUp) return;
      capturedWs = ws;
      resetIdleTimer();

      if (opts.fromSeqError !== undefined) {
        sendFrame({ type: "error", code: "INVALID_QUERY", message: opts.fromSeqError });
        ws.close(1008, "invalid query parameter");
        cleanup();
        return;
      }

      // Resolve run — may have ended since the pre-upgrade check.
      let active;
      try {
        active = rm.get(id);
      } catch (err) {
        if (err instanceof RunManagerError) {
          sendFrame({
            type: "error",
            code: "AMBIGUOUS_PREFIX",
            message: err.message,
          });
        }
        ws.close(1008, "run resolution failed");
        cleanup();
        return;
      }

      if (!active) {
        sendFrame({
          type: "error",
          code: "UNKNOWN_RUN",
          message: `Unknown run: ${id}`,
        });
        ws.close(1008, "run not found");
        cleanup();
        return;
      }

      const snapshot = active.run.snapshot();
      const runId = snapshot.id;
      const currentStepId = snapshot.currentStepId;

      // Mirror run-attach.ts: terminal runs have active.eventLog === null.
      // Open a dedicated owned handle only for terminal runs; running runs
      // share the runner's live handle (do not close it on disconnect).
      const localOwnedLog = !active.eventLog
        ? await rm.openEventLog(runId).catch(() => null)
        : null;
      if (localOwnedLog) {
        ownedEventLog = localOwnedLog;
      }
      const eventLog = active.eventLog ?? localOwnedLog;

      // Collect historical backlog BEFORE registering the subscriber (mirrors
      // run-attach.ts ordering to avoid losing events during the async gap).
      const backlog: EventLogEntry[] = [];
      let maxBacklogSeq = fromSeq ?? 0;
      let backlogTruncated = false;

      if (fromSeq !== undefined) {
        // Resume: client provides its last-seen seq; return all events since.
        if (eventLog) {
          const { entries: events, truncated } = await eventLog
            .readEventsSince(fromSeq)
            .catch(() => ({
              entries: [] as EventLogEntry[],
              truncated: false,
            }));
          backlog.push(...events);
          if (events.length > 0) {
            maxBacklogSeq = events[events.length - 1]!.seq;
          }
          backlogTruncated = truncated;
        }
      } else {
        // Initial attach: return full-run backlog so prior steps are visible.
        if (eventLog) {
          const { entries: events, truncated } = await eventLog
            .readEventsSince(0)
            .catch(() => ({ entries: [] as EventLogEntry[], truncated: false }));
          backlog.push(...events);
          if (events.length > 0) {
            maxBacklogSeq = events[events.length - 1]!.seq;
          }
          backlogTruncated = truncated;
        }
      }

      if (cleanedUp) return;

      // Register subscriber for live events.
      const subscriber: RunSubscriber = {
        onEvent: (entry) => {
          sendFrame({ type: "event", entry });
        },
        onStatusChanged: (status) => {
          sendFrame({ type: "status", status });
        },
      };

      try {
        detach = rm.attachSubscriber(runId, subscriber);
      } catch (err) {
        const msg = err instanceof RunManagerError ? err.message : String(err);
        sendFrame({ type: "error", code: "ATTACH_FAILED", message: msg });
        ws.close(1008, "attach failed");
        cleanup();
        return;
      }

      // Close the race window: flush + gap-read catches events appended
      // between the backlog read and subscriber registration (mirrors
      // run-attach.ts exactly).
      const haveAnchor = fromSeq !== undefined || backlog.length > 0;
      if (haveAnchor && eventLog) {
        await eventLog.flush().catch(() => {});
        const { entries: gapEvents } = await eventLog
          .readEventsSince(maxBacklogSeq)
          .catch(() => ({ entries: [] as EventLogEntry[], truncated: false }));
        const seen = new Set(backlog.map((e) => e.seq));
        for (const entry of gapEvents) {
          if (!seen.has(entry.seq)) {
            backlog.push(entry);
            seen.add(entry.seq);
          }
        }
      }

      if (cleanedUp) return;

      // Send snapshot frame first, then backlog.
      sendFrame({
        type: "snapshot",
        snapshot: {
          id: snapshot.id,
          slug: snapshot.slug,
          workflowPath: snapshot.workflowPath,
          cwd: snapshot.cwd,
          status: snapshot.status,
          currentStepId: snapshot.currentStepId,
          visitedStepIds: snapshot.visitedStepIds,
          startedAt: snapshot.startedAt,
          endedAt: snapshot.endedAt,
          attachedCount: active.subscribers.size,
        },
      });

      sendFrame({
        type: "backlog",
        entries: backlog,
        truncated: backlogTruncated,
      });
    },

    async onMessage(ws: WSContext, data: string): Promise<void> {
      if (cleanedUp) return;
      if (!capturedWs) capturedWs = ws;
      resetIdleTimer();

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        sendFrame({
          type: "error",
          code: "INVALID_FRAME",
          message: "Invalid JSON",
        });
        return;
      }

      const result = ClientFrameSchema.safeParse(parsed);
      if (!result.success) {
        sendFrame({
          type: "error",
          code: "INVALID_FRAME",
          message: "Expected {type:'input',message:string(min 1)} or {type:'ping'}",
        });
        return;
      }

      // Heartbeat: resetIdleTimer() already ran above, so the only job here is to
      // keep the connection alive without doing any run work or echoing a frame.
      if (result.data.type === "ping") {
        return;
      }

      const { message } = result.data;

      // Resolve the run again — it may have ended since onOpen.
      let active;
      try {
        active = rm.get(id);
      } catch {
        sendFrame({
          type: "error",
          code: "UNKNOWN_RUN",
          message: "Run not found",
        });
        return;
      }

      if (!active) {
        sendFrame({
          type: "error",
          code: "UNKNOWN_RUN",
          message: "Run not found",
        });
        return;
      }

      const runId = active.run.snapshot().id;

      try {
        await rm.sendInput(runId, message);
      } catch (err) {
        if (err instanceof RunManagerError) {
          // Non-fatal: surface as an error frame without closing the connection.
          const code =
            Object.entries(RpcErrorCode).find(([, v]) => v === err.code)?.[0] ??
            "RUN_ERROR";
          sendFrame({ type: "error", code, message: err.message });
        } else {
          sendFrame({
            type: "error",
            code: "INTERNAL_ERROR",
            message: String(err),
          });
        }
      }
    },

    onClose(): void {
      cleanup();
    },
  };
}

// Re-export AttachFrameSchema for consumers that want to parse incoming frames.
export { AttachFrameSchema };
