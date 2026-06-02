import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAttach } from './use-attach'

// Minimal FakeWebSocket for hook tests
class FakeWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = FakeWebSocket.OPEN
  url: string
  sentMessages: string[] = []

  static instances: FakeWebSocket[] = []

  private listeners: Record<string, ((event: unknown) => void)[]> = {}

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

  receive(data: unknown) {
    this._emit('message', { data: JSON.stringify(data) })
  }

  private _emit(type: string, event: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(event)
  }
}

function latestWs(): FakeWebSocket {
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  if (!ws) throw new Error('no FakeWebSocket')
  return ws
}

beforeEach(() => {
  FakeWebSocket.instances = []
  vi.stubGlobal('WebSocket', FakeWebSocket)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useAttach', () => {
  test('returns initial view model on mount', () => {
    const { result, unmount } = renderHook(() => useAttach('run-1'))
    expect(result.current.vm.snapshot).toBeNull()
    expect(result.current.vm.status).toBeNull()
    expect(result.current.vm.transcript).toHaveLength(0)
    unmount()
  })

  test('opens WebSocket for the given runId', () => {
    const { unmount } = renderHook(() => useAttach('run-42'))
    expect(latestWs().url).toContain('/runs/run-42/attach')
    unmount()
  })

  test('updates vm when frames arrive', async () => {
    const { result, unmount } = renderHook(() => useAttach('run-1'))

    act(() => {
      latestWs().receive({ type: 'status', status: 'completed' })
    })

    expect(result.current.vm.status).toBe('completed')
    unmount()
  })

  test('sendInput sends a JSON input frame', () => {
    const { result, unmount } = renderHook(() => useAttach('run-1'))
    const ws = latestWs()

    act(() => {
      result.current.sendInput('hello')
    })

    expect(ws.sentMessages).toHaveLength(1)
    expect(JSON.parse(ws.sentMessages[0])).toEqual({ type: 'input', message: 'hello' })
    unmount()
  })

  test('closes the socket on unmount', () => {
    const { unmount } = renderHook(() => useAttach('run-1'))
    const ws = latestWs()

    unmount()

    expect(ws.readyState).toBe(FakeWebSocket.CLOSED)
  })

  test('reconnects when runId changes', () => {
    const { rerender, unmount } = renderHook(({ id }: { id: string }) => useAttach(id), {
      initialProps: { id: 'run-1' },
    })

    expect(FakeWebSocket.instances).toHaveLength(1)

    rerender({ id: 'run-2' })

    expect(FakeWebSocket.instances).toHaveLength(2)
    expect(latestWs().url).toContain('/runs/run-2/attach')

    unmount()
  })
})
