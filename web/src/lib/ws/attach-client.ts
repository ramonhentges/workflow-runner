import { AttachFrameSchema } from '../api/client'
import type { AttachFrame, RunStatus } from '../api/types'
import { reduceFrame, initialViewModel } from './reducer'
import type { RunViewModel } from './reducer'

export type { RunViewModel, TranscriptItem } from './reducer'

export interface AttachClient {
  subscribe(onModel: (vm: RunViewModel) => void): () => void
  sendInput(message: string): void
  close(): void
}

// Heartbeat keeps the server's idle timer (IDLE_TIMEOUT_MS = 30s) from reaping a
// quiet-but-live interactive connection. 15s leaves a comfortable margin.
const HEARTBEAT_MS = 15_000

// Reconnect backoff: a dropped socket on a still-running run is retried with
// growing delays, then gives up (closed=true) after the last entry is reached.
const RECONNECT_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000]

// Only `running` is non-terminal; the others mean the run is over and the server
// closed the socket normally, so there is nothing to resume.
function isTerminal(status: RunStatus | null): boolean {
  return status !== null && status !== 'running'
}

export function openAttach(runId: string, baseWsUrl: string): AttachClient {
  let model = initialViewModel
  const subscribers = new Set<(vm: RunViewModel) => void>()
  let done = false

  // Highest event seq applied so far; sent as ?fromSeq= on reconnect so the
  // server replays only the gap. The reducer dedups by seq, so overlap is safe.
  let lastSeq = 0

  let ws: WebSocket | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempt = 0

  function notify() {
    for (const sub of subscribers) {
      sub(model)
    }
  }

  function setModel(next: RunViewModel) {
    model = next
    notify()
  }

  function stopHeartbeat() {
    if (heartbeat !== null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  function startHeartbeat() {
    stopHeartbeat()
    heartbeat = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }))
      }
    }, HEARTBEAT_MS)
  }

  function trackSeq(frame: AttachFrame) {
    if (frame.type === 'event') {
      lastSeq = Math.max(lastSeq, frame.entry.seq)
    } else if (frame.type === 'backlog') {
      for (const entry of frame.entries) {
        lastSeq = Math.max(lastSeq, entry.seq)
      }
    }
  }

  function connect() {
    const url = lastSeq > 0
      ? `${baseWsUrl}/runs/${encodeURIComponent(runId)}/attach?fromSeq=${lastSeq}`
      : `${baseWsUrl}/runs/${encodeURIComponent(runId)}/attach`
    const socket = new WebSocket(url)
    ws = socket

    socket.addEventListener('open', () => {
      if (done) return
      startHeartbeat()
    })

    socket.addEventListener('message', (event: MessageEvent) => {
      if (done) return
      let raw: unknown
      try {
        raw = JSON.parse(event.data as string)
      } catch {
        return
      }
      const result = AttachFrameSchema.safeParse(raw)
      if (!result.success) return
      // A frame proves the connection is healthy — clear the backoff so the next
      // drop starts its retry sequence fresh.
      reconnectAttempt = 0
      const frame = result.data as unknown as AttachFrame
      trackSeq(frame)
      // Zod schema uses z.unknown() for RunEvent.event; reducer validates it via RunnerEventSchema.
      setModel(reduceFrame(model, frame))
    })

    socket.addEventListener('close', () => {
      if (done) return
      stopHeartbeat()
      // The run ended (server closed normally) — nothing to resume.
      if (isTerminal(model.status)) {
        done = true
        setModel({ ...model, closed: true })
        return
      }
      // Gave up after the backoff schedule was exhausted.
      if (reconnectAttempt >= RECONNECT_DELAYS_MS.length) {
        done = true
        setModel({ ...model, closed: true })
        return
      }
      const delay = RECONNECT_DELAYS_MS[reconnectAttempt]
      reconnectAttempt++
      reconnectTimer = setTimeout(() => {
        if (done) return
        connect()
      }, delay)
    })

    socket.addEventListener('error', () => {
      // error is always followed by close; the close handler drives reconnect.
    })
  }

  connect()

  return {
    subscribe(onModel) {
      subscribers.add(onModel)
      onModel(model)
      return () => {
        subscribers.delete(onModel)
      }
    },

    sendInput(message) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', message }))
      }
    },

    close() {
      done = true
      stopHeartbeat()
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      setModel({ ...model, closed: true })
      ws?.close()
    },
  }
}
