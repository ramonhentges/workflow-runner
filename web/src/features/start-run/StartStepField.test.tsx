import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { StartStepField } from './StartStepField'

const workflow = {
  steps: [
    { id: 'plan' },
    { id: 'implement' },
    { id: 'review' },
  ],
}

describe('StartStepField', () => {
  test('lists Default first and workflow step ids in source order', async () => {
    const user = userEvent.setup()
    render(
      <StartStepField
        mode="catalog"
        workflow={workflow}
        value=""
        onValueChange={() => {}}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /start step/i }))
    const options = screen.getAllByRole('option').map(option => option.textContent)
    expect(options).toEqual(['Default (first step)', 'plan', 'implement', 'review'])
  })

  test('reports the exact selected catalog step id', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <StartStepField
        mode="catalog"
        workflow={workflow}
        value=""
        onValueChange={onValueChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /start step/i }))
    await user.click(screen.getByRole('option', { name: 'review' }))
    expect(onValueChange).toHaveBeenCalledWith('review')
  })

  test('maps Default selection to an omitted entry value', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <StartStepField
        mode="catalog"
        workflow={workflow}
        value="review"
        onValueChange={onValueChange}
      />,
    )

    await user.click(screen.getByRole('combobox', { name: /start step/i }))
    await user.click(screen.getByRole('option', { name: /default/i }))
    expect(onValueChange).toHaveBeenCalledWith('')
  })

  test('renders an exact-id input in manual mode', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    function Harness() {
      const [value, setValue] = useState('')
      return (
        <StartStepField
          mode="manual"
          value={value}
          onValueChange={next => {
            setValue(next)
            onValueChange(next)
          }}
        />
      )
    }
    render(<Harness />)

    const input = screen.getByRole('textbox', { name: /start step/i })
    await user.type(input, 'Review-Step')
    expect(onValueChange).toHaveBeenLastCalledWith('Review-Step')
  })

  test('shows loading state without a step selector', () => {
    render(
      <StartStepField
        mode="catalog"
        isLoading
        value=""
        onValueChange={() => {}}
      />,
    )

    expect(screen.getByText(/loading workflow steps/i)).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: /start step/i })).not.toBeInTheDocument()
  })

  test('explains that query errors fall back to the first step', () => {
    render(
      <StartStepField
        mode="catalog"
        isError
        value=""
        onValueChange={() => {}}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/start at the first step/i)
  })

  test('rejects malformed workflow data without crashing', () => {
    render(
      <StartStepField
        mode="catalog"
        workflow={{ steps: [{ name: 'missing-id' }] }}
        value=""
        onValueChange={() => {}}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent(/steps are unavailable/i)
    expect(screen.queryByRole('combobox', { name: /start step/i })).not.toBeInTheDocument()
  })
})
