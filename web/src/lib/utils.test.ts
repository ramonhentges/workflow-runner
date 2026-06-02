import { describe, test, expect } from 'vitest'
import { cn } from './utils'

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
