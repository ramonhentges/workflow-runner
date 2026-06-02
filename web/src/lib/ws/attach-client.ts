import { AttachFrameSchema } from '../api/client'
import type { AttachFrame } from '../api/types'
import { reduceFrame, initialViewModel } from './reducer'
import type { RunViewModel } from './reducer'

export type { RunViewModel, TranscriptItem } from './reducer'

export interface AttachClient {
  subscribe(onModel: (vm: RunViewModel) => void): () => void
  sendInput(message: string): void
  close(): void
}

export function openAttach(runId: string, baseWsUrl: string): AttachClient {
  const url = `${baseWsUrl}/runs/${encodeURIComponent(runId)}/attach`
  const ws = new WebSocket(url)

  let model = initialViewModel
  const subscribers = new Set<(vm: RunViewModel) => void>()
  let done = false

  function notify() {
    for (const sub of subscribers) {
      sub(model)
    }
  }

  ws.addEventListener('message', (event: MessageEvent) => {
    if (done) return
    let raw: unknown
    try {
      raw = JSON.parse(event.data as string)
    } catch {
      return
    }
    const result = AttachFrameSchema.safeParse(raw)
    if (!result.success) return
    // Zod schema uses z.unknown() for RunEvent.event; reducer validates it via RunnerEventSchema.
    model = reduceFrame(model, result.data as unknown as AttachFrame)
    notify()
  })

  ws.addEventListener('close', () => {
    if (done) return
    done = true
    model = { ...model, closed: true }
    notify()
  })

  ws.addEventListener('error', () => {
    // error is always followed by close; close handler surfaces the state change
  })

  return {
    subscribe(onModel) {
      subscribers.add(onModel)
      onModel(model)
      return () => {
        subscribers.delete(onModel)
      }
    },

    sendInput(message) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', message }))
      }
    },

    close() {
      done = true
      model = { ...model, closed: true }
      ws.close()
      notify()
    },
  }
}
