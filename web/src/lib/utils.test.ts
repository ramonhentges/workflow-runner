import { describe, test, expect } from 'vitest'
import { cn, generateId } from './utils'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('cn', () => {
  test('merges class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar')
  })

  test('handles conditional classes (falsy values are dropped)', () => {
    expect(cn('foo', false && 'bar', 'baz')).toBe('foo baz')
  })

  test('deduplicates conflicting Tailwind classes (last wins)', () => {
    expect(cn('p-4', 'p-2')).toBe('p-2')
  })

  test('handles empty input', () => {
    expect(cn()).toBe('')
  })
})

describe('generateId', () => {
  test('produces a valid UUID v4', () => {
    const id = generateId()
    expect(id).toMatch(UUID_RE)
  })

  test('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()))
    expect(ids.size).toBe(100)
  })

  test('falls back when crypto.randomUUID is unavailable', () => {
    const original = crypto.randomUUID
    // @ts-expect-error removing randomUUID to test fallback
    delete crypto.randomUUID
    try {
      const id = generateId()
      expect(id).toMatch(UUID_RE)
    } finally {
      crypto.randomUUID = original
    }
  })
})
