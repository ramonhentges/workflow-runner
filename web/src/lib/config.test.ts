import { describe, test, expect, afterEach } from 'vitest'
import { getApiBaseUrl } from './config'

const env = import.meta.env as Record<string, unknown>

describe('getApiBaseUrl', () => {
  const savedValue = env.VITE_API_BASE_URL

  afterEach(() => {
    if (savedValue === undefined) {
      delete env.VITE_API_BASE_URL
    } else {
      env.VITE_API_BASE_URL = savedValue
    }
  })

  test('falls back to the page origin (same-origin) when VITE_API_BASE_URL is not set', () => {
    delete env.VITE_API_BASE_URL
    // jsdom origin is pinned to http://127.0.0.1:4517 in vite.config.ts.
    expect(getApiBaseUrl()).toBe(window.location.origin)
    expect(getApiBaseUrl()).toBe('http://127.0.0.1:4517')
  })

  test('returns override URL when VITE_API_BASE_URL is set', () => {
    env.VITE_API_BASE_URL = 'http://localhost:8080'
    expect(getApiBaseUrl()).toBe('http://localhost:8080')
  })
})
