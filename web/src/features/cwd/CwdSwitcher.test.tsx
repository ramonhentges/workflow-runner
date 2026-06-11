import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from 'vitest'
import { CwdSwitcher } from './CwdSwitcher'
import { useCwdStore } from '@/stores/cwd-store'

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  localStorage.clear()
})

async function openManageDialog(user: ReturnType<typeof userEvent.setup>) {
  // Two manage buttons exist (expanded + collapsed rail); either opens the dialog.
  const [trigger] = screen.getAllByRole('button', { name: 'Manage working directories' })
  await user.click(trigger)
  return screen.getByRole('dialog')
}

describe('CwdSwitcher', () => {
  test('shows empty state when no cwds are configured', () => {
    render(<CwdSwitcher />)
    expect(screen.getByTestId('cwd-empty-state')).toBeInTheDocument()
  })

  test('hides empty state and shows the directory selector when cwds exist', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    render(<CwdSwitcher />)
    expect(screen.queryByTestId('cwd-empty-state')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Active working directory' })).toBeInTheDocument()
  })

  test('adding a cwd via the dialog form makes it active and clears the fields', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.type(within(dialog).getByLabelText('Label'), 'My Project')
    await user.type(within(dialog).getByLabelText('Path'), '/home/user/project')
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    const state = useCwdStore.getState()
    expect(state.cwds).toHaveLength(1)
    expect(state.activeCwdId).toBe(state.cwds[0].id)
    expect(within(dialog).getByLabelText('Label')).toHaveValue('')
    expect(within(dialog).getByLabelText('Path')).toHaveValue('')
  })

  test('does not add a cwd when both form fields are empty', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('does not add a cwd when only the label is provided', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.type(within(dialog).getByLabelText('Label'), 'My Project')
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('selecting a directory from the dropdown updates the active cwd', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('Project A', '/a')
    useCwdStore.getState().addCwd('Project B', '/b')
    render(<CwdSwitcher />)

    const secondCwd = useCwdStore.getState().cwds[1]
    await user.click(screen.getByRole('combobox', { name: 'Active working directory' }))
    await user.click(screen.getByRole('option', { name: /Project B/ }))

    expect(useCwdStore.getState().activeCwdId).toBe(secondCwd.id)
  })

  test('removing a cwd from the dialog removes it from the store', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('My Project', '/p')
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Remove My Project' }))

    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('orders directories alphabetically by label in the dropdown and dialog list', async () => {
    const user = userEvent.setup()
    // Add out of alphabetical order; insertion order would be Zeta, alpha, Mango.
    useCwdStore.getState().addCwd('Zeta', '/z')
    useCwdStore.getState().addCwd('alpha', '/a')
    useCwdStore.getState().addCwd('Mango', '/m')
    render(<CwdSwitcher />)

    await user.click(screen.getByRole('combobox', { name: 'Active working directory' }))
    const optionLabels = screen
      .getAllByRole('option')
      .map(option => option.textContent?.replace(/\/[a-z]$/, '').trim())
    expect(optionLabels).toEqual(['alpha', 'Mango', 'Zeta'])
    // Close the dropdown so the rest of the page is no longer aria-hidden.
    await user.keyboard('{Escape}')

    const dialog = await openManageDialog(user)
    const removeLabels = within(dialog)
      .getAllByRole('button', { name: /^Remove / })
      .map(button => button.getAttribute('aria-label')?.replace('Remove ', ''))
    expect(removeLabels).toEqual(['alpha', 'Mango', 'Zeta'])
  })
})

describe('CwdSwitcher form validation', () => {
  test('shows required-field errors on empty submit', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(await within(dialog).findByTestId('cwd-label-error')).toHaveTextContent(
      'Label is required',
    )
    expect(within(dialog).getByTestId('cwd-path-error')).toHaveTextContent('Path is required')
    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('rejects whitespace-only fields (trim)', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.type(within(dialog).getByLabelText('Label'), '   ')
    await user.type(within(dialog).getByLabelText('Path'), '   ')
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(await within(dialog).findByTestId('cwd-label-error')).toBeInTheDocument()
    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('trims surrounding whitespace before storing', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.type(within(dialog).getByLabelText('Label'), '  My Project  ')
    await user.type(within(dialog).getByLabelText('Path'), '  /home/user/project  ')
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(useCwdStore.getState().cwds).toEqual([
      expect.objectContaining({ label: 'My Project', path: '/home/user/project' }),
    ])
  })

  test('requires an absolute path', async () => {
    const user = userEvent.setup()
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.type(within(dialog).getByLabelText('Label'), 'My Project')
    await user.type(within(dialog).getByLabelText('Path'), 'relative/path')
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(await within(dialog).findByTestId('cwd-path-error')).toHaveTextContent(
      /absolute path/i,
    )
    expect(useCwdStore.getState().cwds).toHaveLength(0)
  })

  test('rejects a duplicate label (case-insensitive)', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('My Project', '/a')
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.type(within(dialog).getByLabelText('Label'), 'my project')
    await user.type(within(dialog).getByLabelText('Path'), '/b')
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(await within(dialog).findByTestId('cwd-label-error')).toHaveTextContent(
      /already exists/i,
    )
    expect(useCwdStore.getState().cwds).toHaveLength(1)
  })

  test('rejects a duplicate path', async () => {
    const user = userEvent.setup()
    useCwdStore.getState().addCwd('Project A', '/shared')
    render(<CwdSwitcher />)

    const dialog = await openManageDialog(user)
    await user.type(within(dialog).getByLabelText('Label'), 'Project B')
    await user.type(within(dialog).getByLabelText('Path'), '/shared')
    await user.click(within(dialog).getByRole('button', { name: /add/i }))

    expect(await within(dialog).findByTestId('cwd-path-error')).toHaveTextContent(
      /already registered/i,
    )
    expect(useCwdStore.getState().cwds).toHaveLength(1)
  })
})
