import { describe, test, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from './setup'

describe('MSW server', () => {
  test('intercepts a mocked GET request and the response resolves correctly', async () => {
    server.use(
      http.get('http://127.0.0.1:4517/health', () => {
        return HttpResponse.json({ status: 'ok' })
      }),
    )

    const response = await fetch('http://127.0.0.1:4517/health')
    const data = await response.json() as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(data).toEqual({ status: 'ok' })
  })

  test('intercepts a POST request with a custom status code', async () => {
    server.use(
      http.post('http://127.0.0.1:4517/runs', () => {
        return HttpResponse.json({ id: 'run-123' }, { status: 201 })
      }),
    )

    const response = await fetch('http://127.0.0.1:4517/runs', { method: 'POST' })
    const data = await response.json() as Record<string, unknown>

    expect(response.status).toBe(201)
    expect(data).toEqual({ id: 'run-123' })
  })
})
