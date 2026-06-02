import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { CwdSwitcher } from './CwdSwitcher'
import { useCwdStore } from '@/stores/cwd-store'

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  localStorage.clear()
})

describe('CwdSwitcher', () => {
  test('shows empty state when no cwds are configured', () => {
    render(<CwdSwitcher />)
    expect(screen.getByTestId('cwd-empty-state')).toBeInTheDocument()
  })

  test('hides empty state when cwds exist', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    render(<CwdSwitcher />)
    expect(screen.queryByTestId('cwd-empty-state')).not.toBeInTheDocument()
  })

  test('adding a cwd via the form makes it appear and become active', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    await user.type(screen.getByLabelText('Label'), 'My Project')
    await user.type(screen.getByLabelText('Path'), '/home/user/project')
    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(screen.queryByTestId('cwd-empty-state')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My Project' })).toBeInTheDocument()

    const state = useCwdStore.getState()
    expect(state.cwds).toHaveLength(1)
    expect(state.activeCwdId).toBe(state.cwds[0].id)
  })

  test('adding a cwd clears the form fields', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    await user.type(screen.getByLabelText('Label'), 'My Project')
    await user.type(screen.getByLabelText('Path'), '/home/user/project')
    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(screen.getByLabelText('Label')).toHaveValue('')
    expect(screen.getByLabelText('Path')).toHaveValue('')
  })

  test('does not add a cwd when both form fields are empty', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(useCwdStore.getState().cwds).toHaveLength(0)
    expect(screen.getByTestId('cwd-empty-state')).toBeInTheDocument()
  })

  test('does not add a cwd when only label is provided', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    await user.type(screen.getByLabelText('Label'), 'My Project')
    await user.click(screen.getByRole('button', { name: /add/i }))

    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('switching the active cwd updates the store activeCwdId', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('Project A', '/a')
    useCwdStore.getState().addCwd('Project B', '/b')

    render(<CwdSwitcher />)

    const secondCwd = useCwdStore.getState().cwds[1]
    await user.click(screen.getByRole('button', { name: 'Project B' }))

    expect(useCwdStore.getState().activeCwdId).toBe(secondCwd.id)
  })

  test('removing a cwd removes it from the list', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('My Project', '/p')
    render(<CwdSwitcher />)

    await user.click(screen.getByRole('button', { name: 'Remove My Project' }))

    expect(screen.getByTestId('cwd-empty-state')).toBeInTheDocument()
    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('active cwd button has aria-pressed=true', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    render(<CwdSwitcher />)
    const btn = screen.getByRole('button', { name: 'proj' })
    expect(btn).toHaveAttribute('aria-pressed', 'true')
  })

  test('inactive cwd button has aria-pressed=false', () => {
    useCwdStore.getState().addCwd('Project A', '/a')
    useCwdStore.getState().addCwd('Project B', '/b')
    render(<CwdSwitcher />)
    // First is auto-activated; second is inactive
    const btnB = screen.getByRole('button', { name: 'Project B' })
    expect(btnB).toHaveAttribute('aria-pressed', 'false')
  })
})
