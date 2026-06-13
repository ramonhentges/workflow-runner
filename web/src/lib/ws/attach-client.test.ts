import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { openAttach } from './attach-client'
import type { RunViewModel } from './reducer'
import { initialViewModel } from './reducer'

// Fake WebSocket for testing
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = FakeWebSocket.OPEN
  url: string
  sentMessages: string[] = []

  private listeners: Record<string, ((event: unknown) => void)[]> = {}

  // Tracks all instances created during a test
  static instances: FakeWebSocket[] = []

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, cb: (event: unknown) => void) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(cb)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this._emit('close', {})
  }

  // Test helper — simulate a message arriving from the server
  receive(data: unknown) {
    this._emit('message', { data: JSON.stringify(data) })
  }

  // Test helper — simulate the socket transitioning to OPEN (drives heartbeat).
  triggerOpen() {
    this.readyState = FakeWebSocket.OPEN
    this._emit('open', {})
  }

  // Test helper — simulate socket close without calling client.close()
  serverClose() {
    this.readyState = FakeWebSocket.CLOSED
    this._emit('close', {})
  }

  private _emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) {
      cb(event)
    }
  }
}

function latestWs(): FakeWebSocket {
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!ws) throw new Error('No FakeWebSocket instance created')
  return ws
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const BASE_URL = 'ws://localhost:4517'
const RUN_ID = 'run-abc'

function makeRunDetail() {
  return {
    id: RUN_ID,
    slug: 'abc',
    workflowPath: '/tmp/wf.json',
    status: 'running' as const,
    currentStepId: null,
    visitedStepIds: [],
    startedAt: 1000,
    endedAt: null,
    attachedCount: 1,
  }
}

describe('openAttach', () => {
  test('opens WebSocket at the correct URL', () => {
    openAttach(RUN_ID, BASE_URL)
    expect(latestWs().url).toBe(`${BASE_URL}/api/runs/${RUN_ID}/attach`)
  })

  test('subscribe immediately emits the current (initial) model', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    let received: RunViewModel | null = null
    client.subscribe(vm => { received = vm })
    expect(received).toEqual(initialViewModel)
    client.close()
  })

  test('unsubscribe stops further callbacks', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const calls: RunViewModel[] = []
    const unsubscribe = client.subscribe(vm => calls.push(vm))

    unsubscribe()
    latestWs().receive({ type: 'status', status: 'completed' })

    // Only the initial emit happened before unsubscribe
    expect(calls).toHaveLength(1)
    client.close()
  })
})

describe('full frame sequence integration', () => {
  test('snapshot → backlog → event(stream) → status yields expected RunViewModel', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    const models: RunViewModel[] = []
    client.subscribe(vm => models.push({ ...vm }))

    const snapshot = makeRunDetail()

    ws.receive({ type: 'snapshot', snapshot })
    ws.receive({
      type: 'backlog',
      entries: [
        { seq: 1, ts: 1000, stepId: 'step-1', event: { type: 'banner', step: { id: 'step-1' }, index: 0 } },
        { seq: 2, ts: 2000, stepId: 'step-1', event: { type: 'stream', kind: 'output', chunk: 'hello ' } },
      ],
      truncated: false,
    })
    ws.receive({
      type: 'event',
      entry: { seq: 3, ts: 3000, stepId: 'step-1', event: { type: 'stream', kind: 'output', chunk: 'world' } },
    })
    ws.receive({ type: 'status', status: 'completed' })

    const final = models[models.length - 1]

    expect(final.snapshot).toEqual(snapshot)
    expect(final.status).toBe('completed')
    expect(final.steps).toHaveLength(1)
    expect(final.steps[0]).toEqual({ id: 'step-1', index: 0, active: true })

    // banner creates a step transcript item, then stream items coalesce
    const streamItem = final.transcript.find(t => t.kind === 'message')
    expect(streamItem).toBeDefined()
    expect(streamItem!.text).toBe('hello world')
    expect(streamItem!.seqStart).toBe(2)
    expect(streamItem!.seqEnd).toBe(3)

    client.close()
  })

  test('error frame populates error without clearing transcript', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    let latest: RunViewModel = initialViewModel
    client.subscribe(vm => { latest = vm })

    ws.receive({
      type: 'event',
      entry: { seq: 1, ts: 1000, stepId: null, event: { type: 'log', message: 'before error' } },
    })
    ws.receive({ type: 'error', code: 'OVERFLOW', message: 'too many events' })

    expect(latest.error).toEqual({ code: 'OVERFLOW', message: 'too many events' })
    expect(latest.transcript).toHaveLength(1)
    expect(latest.transcript[0].text).toBe('before error')

    client.close()
  })

  test('interactive event toggles interactiveEnabled', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    let latest: RunViewModel = initialViewModel
    client.subscribe(vm => { latest = vm })

    ws.receive({
      type: 'event',
      entry: { seq: 1, ts: 1000, stepId: null, event: { type: 'interactive', enabled: true } },
    })
    expect(latest.interactiveEnabled).toBe(true)

    ws.receive({
      type: 'event',
      entry: { seq: 2, ts: 2000, stepId: null, event: { type: 'interactive', enabled: false } },
    })
    expect(latest.interactiveEnabled).toBe(false)

    client.close()
  })
})

describe('sendInput', () => {
  test('emits {type:"input",message} JSON frame when socket is OPEN', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    client.sendInput('hi')

    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0])).toEqual({ type: 'input', message: 'hi' })

    client.close()
  })

  test('does not send when socket is CLOSED', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    ws.readyState = FakeWebSocket.CLOSED
    client.sendInput('hi')

    expect(ws.sentMessages).toHaveLength(0)
    client.close()
  })
})

describe('close', () => {
  test('close() sets closed=true and notifies subscribers', () => {
    const client = openAttach(RUN_ID, BASE_URL)

    let latest: RunViewModel = initialViewModel
    client.subscribe(vm => { latest = vm })

    client.close()

    expect(latest.closed).toBe(true)
  })

  test('close() stops further dispatch from incoming messages', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    const updates: RunViewModel[] = []
    client.subscribe(vm => updates.push({ ...vm }))

    client.close()
    const countAfterClose = updates.length

    ws.receive({ type: 'status', status: 'completed' })

    expect(updates.length).toBe(countAfterClose)
  })

  test('server-side close on a terminal run surfaces closed=true', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    let latest: RunViewModel = initialViewModel
    client.subscribe(vm => { latest = vm })

    // Run reached a terminal status before the socket closed.
    ws.receive({ type: 'status', status: 'completed' })
    ws.serverClose()

    expect(latest.closed).toBe(true)
    // No reconnection attempt for a finished run.
    expect(FakeWebSocket.instances).toHaveLength(1)
  })
})

describe('heartbeat', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('sends a ping frame every 15s while the socket is OPEN', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()
    ws.triggerOpen()

    vi.advanceTimersByTime(15_000)
    expect(ws.sentMessages.map(m => JSON.parse(m))).toContainEqual({ type: 'ping' })

    ws.sentMessages.length = 0
    vi.advanceTimersByTime(15_000)
    expect(ws.sentMessages.map(m => JSON.parse(m))).toContainEqual({ type: 'ping' })

    client.close()
  })

  test('stops pinging after the client is closed', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()
    ws.triggerOpen()

    client.close()
    ws.sentMessages.length = 0
    vi.advanceTimersByTime(60_000)

    expect(ws.sentMessages).toHaveLength(0)
  })
})

describe('auto-reconnect', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('reconnects with ?fromSeq after an unexpected close on a running run', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    let latest: RunViewModel = initialViewModel
    client.subscribe(vm => { latest = vm })

    // Run is running and we have applied up to seq 5.
    ws.receive({ type: 'snapshot', snapshot: makeRunDetail() })
    ws.receive({
      type: 'event',
      entry: { seq: 5, ts: 5000, stepId: 'step-1', event: { type: 'log', message: 'hi' } },
    })

    ws.serverClose()

    // Still considered open (reconnecting), not closed.
    expect(latest.closed).toBe(false)

    // Backoff elapses → a new socket opens, resuming from the last seq.
    vi.advanceTimersByTime(250)
    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(latestWs().url).toBe(`${BASE_URL}/api/runs/${RUN_ID}/attach?fromSeq=5`)

    // The resumed socket keeps feeding the same model.
    latestWs().receive({
      type: 'event',
      entry: { seq: 6, ts: 6000, stepId: 'step-1', event: { type: 'log', message: 'again' } },
    })
    expect(latest.transcript.some(t => t.text === 'again')).toBe(true)

    client.close()
  })

  test('gives up and sets closed=true after exhausting retries', () => {
    const client = openAttach(RUN_ID, BASE_URL)

    let latest: RunViewModel = initialViewModel
    client.subscribe(vm => { latest = vm })

    latestWs().receive({ type: 'snapshot', snapshot: makeRunDetail() })

    // Five backoff steps (250, 500, 1000, 2000, 5000), each followed by a close.
    const delays = [250, 500, 1000, 2000, 5000]
    for (const delay of delays) {
      latestWs().serverClose()
      expect(latest.closed).toBe(false)
      vi.advanceTimersByTime(delay)
    }

    // The sixth close has no remaining budget → give up.
    latestWs().serverClose()
    expect(latest.closed).toBe(true)
  })
})

describe('malformed frames', () => {
  test('invalid JSON is silently ignored', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    let callCount = 0
    client.subscribe(() => callCount++)

    const initialCount = callCount
    // Simulate raw message event with invalid JSON
    const listeners = (ws as unknown as { listeners: Record<string, ((e: unknown) => void)[]> }).listeners
    for (const cb of listeners['message'] ?? []) {
      cb({ data: 'not json {{' })
    }

    expect(callCount).toBe(initialCount) // no additional notify
    client.close()
  })

  test('frame with unknown type is silently ignored', () => {
    const client = openAttach(RUN_ID, BASE_URL)
    const ws = latestWs()

    let latest: RunViewModel = initialViewModel
    client.subscribe(vm => { latest = vm })

    const beforeStatus = latest.status
    ws.receive({ type: 'unknown_future_type', data: 42 })

    expect(latest.status).toBe(beforeStatus)
    client.close()
  })
})
