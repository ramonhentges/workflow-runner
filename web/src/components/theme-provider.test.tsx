import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider, useTheme } from './theme-provider'

// ─── Controllable matchMedia mock ──────────────────────────────────────────────

function mockMatchMedia(initialMatches: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>()
  const mql = {
    matches: initialMatches,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.add(cb),
    removeEventListener: (_type: string, cb: (e: MediaQueryListEvent) => void) =>
      listeners.delete(cb),
    addListener: (cb: (e: MediaQueryListEvent) => void) => listeners.add(cb),
    removeListener: (cb: (e: MediaQueryListEvent) => void) => listeners.delete(cb),
    dispatchEvent: () => false,
  }
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia
  return {
    listenerCount: () => listeners.size,
    setMatches(next: boolean) {
      mql.matches = next
      act(() => {
        listeners.forEach(cb => cb({ matches: next } as MediaQueryListEvent))
      })
    },
  }
}

// A tiny consumer that surfaces the theme and lets us drive setTheme.
function Harness() {
  const { theme, setTheme } = useTheme()
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('dark')}>dark</button>
      <button onClick={() => setTheme('system')}>system</button>
    </div>
  )
}

const isDark = () => document.documentElement.classList.contains('dark')

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.remove('dark')
})

afterEach(() => {
  document.documentElement.classList.remove('dark')
})

describe('ThemeProvider system resolution', () => {
  test('applies .dark when system prefers dark', () => {
    mockMatchMedia(true)
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('system')
    expect(isDark()).toBe(true)
  })

  test('removes .dark when system prefers light', () => {
    mockMatchMedia(false)
    document.documentElement.classList.add('dark') // ensure toggle actually clears it
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(isDark()).toBe(false)
  })
})

describe('ThemeProvider explicit selection + persistence', () => {
  test('selecting dark applies .dark and persists theme=dark', async () => {
    mockMatchMedia(false)
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'dark' }))
    expect(isDark()).toBe(true)
    expect(localStorage.getItem('theme')).toBe('dark')
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
  })

  test('selecting light removes .dark and persists theme=light', async () => {
    mockMatchMedia(true) // system would be dark; explicit light must win
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(isDark()).toBe(true) // starts on system=dark
    await user.click(screen.getByRole('button', { name: 'light' }))
    expect(isDark()).toBe(false)
    expect(localStorage.getItem('theme')).toBe('light')
  })
})

describe('ThemeProvider rehydration', () => {
  test('rehydrates a persisted theme from localStorage on mount', () => {
    localStorage.setItem('theme', 'dark')
    mockMatchMedia(false) // system is light; persisted dark must win
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('theme')).toHaveTextContent('dark')
    expect(isDark()).toBe(true)
  })
})

describe('ThemeProvider system-change listener', () => {
  test('reacts to a system preference change while in system mode', () => {
    const media = mockMatchMedia(false)
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    expect(isDark()).toBe(false)
    media.setMatches(true)
    expect(isDark()).toBe(true)
  })

  test('ignores system changes after an explicit choice is made', async () => {
    const media = mockMatchMedia(false)
    const user = userEvent.setup()
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'light' }))
    expect(media.listenerCount()).toBe(0) // listener detached when not in system mode
    media.setMatches(true)
    expect(isDark()).toBe(false)
  })
})

describe('useTheme guard', () => {
  test('throws when used outside a ThemeProvider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Harness />)).toThrow(/ThemeProvider/)
    spy.mockRestore()
  })

  test('does not crash when matchMedia is absent', () => {
    const original = window.matchMedia
    // @ts-expect-error simulate an environment without matchMedia
    delete window.matchMedia
    expect(() =>
      render(
        <ThemeProvider>
          <Harness />
        </ThemeProvider>,
      ),
    ).not.toThrow()
    expect(isDark()).toBe(false)
    window.matchMedia = original
  })
})
