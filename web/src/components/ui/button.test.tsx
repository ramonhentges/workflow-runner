import { describe, test, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button, buttonVariants } from './button'

describe('buttonVariants', () => {
  test('exposes the shared button class list as a single source of truth', () => {
    const outlineSm = buttonVariants({ variant: 'outline', size: 'sm' })
    // The outline + sm tokens links previously hand-copied now come from here.
    expect(outlineSm).toContain('border')
    expect(outlineSm).toContain('border-input')
    expect(outlineSm).toContain('bg-background')
    expect(outlineSm).toContain('h-8')
    expect(outlineSm).toContain('px-3')
    expect(outlineSm).toContain('text-xs')
    expect(outlineSm).toContain('hover:bg-accent')
  })

  test('defaults to the default variant and size', () => {
    const base = buttonVariants()
    expect(base).toContain('bg-primary')
    expect(base).toContain('h-9')
  })
})

describe('Button', () => {
  test('renders a native button by default', () => {
    render(<Button>Press</Button>)
    const button = screen.getByRole('button', { name: 'Press' })
    expect(button.tagName).toBe('BUTTON')
    expect(button).toHaveAttribute('data-slot', 'button')
  })

  test('asChild renders the child element styled as a button (link-as-button)', () => {
    render(
      <Button asChild variant="outline" size="sm">
        <a href="/somewhere">Go</a>
      </Button>,
    )
    const link = screen.getByRole('link', { name: 'Go' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('data-slot', 'button')
    expect(link).toHaveAttribute('href', '/somewhere')
    expect(link.className).toContain('border-input')
    expect(link.className).toContain('h-8')
  })

  test('merges a caller className on top of the variant classes', () => {
    render(<Button className="custom-token">X</Button>)
    expect(screen.getByRole('button', { name: 'X' }).className).toContain('custom-token')
  })
})
