import { beforeEach, describe, expect, test } from 'vitest'
import { useCwdStore } from './cwd-store'

beforeEach(() => {
  useCwdStore.setState({ cwds: [], activeCwdId: null })
  localStorage.clear()
})

describe('cwdStore — addCwd', () => {
  test('appends a cwd with a generated id', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const { cwds } = useCwdStore.getState()
    expect(cwds).toHaveLength(1)
    expect(cwds[0].label).toBe('proj')
    expect(cwds[0].path).toBe('/p')
    expect(cwds[0].id).toBeTruthy()
  })

  test('a second add yields a distinct id', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    useCwdStore.getState().addCwd('proj2', '/p2')
    const { cwds } = useCwdStore.getState()
    expect(cwds).toHaveLength(2)
    expect(cwds[0].id).not.toBe(cwds[1].id)
  })

  test('auto-activates the first cwd when none is active', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const { activeCwdId, cwds } = useCwdStore.getState()
    expect(activeCwdId).toBe(cwds[0].id)
  })

  test('does not change activeCwdId when an active already exists', () => {
    useCwdStore.getState().addCwd('first', '/first')
    const firstId = useCwdStore.getState().cwds[0].id
    useCwdStore.getState().addCwd('second', '/second')
    expect(useCwdStore.getState().activeCwdId).toBe(firstId)
  })
})

describe('cwdStore — setActive + activeCwd', () => {
  test('setActive then activeCwd returns the matching cwd', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const id = useCwdStore.getState().cwds[0].id
    useCwdStore.getState().setActive(id)
    const active = useCwdStore.getState().activeCwd()
    expect(active).not.toBeNull()
    expect(active!.id).toBe(id)
    expect(active!.label).toBe('proj')
  })

  test('activeCwd returns null when activeCwdId is null', () => {
    expect(useCwdStore.getState().activeCwd()).toBeNull()
  })

  test('activeCwd returns null when activeCwdId points to a removed cwd', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const id = useCwdStore.getState().cwds[0].id
    useCwdStore.setState({ cwds: [], activeCwdId: id })
    expect(useCwdStore.getState().activeCwd()).toBeNull()
  })
})

describe('cwdStore — removeCwd', () => {
  test('removeCwd(activeId) clears activeCwdId when no cwds remain', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const id = useCwdStore.getState().cwds[0].id
    useCwdStore.getState().removeCwd(id)
    const { cwds, activeCwdId } = useCwdStore.getState()
    expect(cwds).toHaveLength(0)
    expect(activeCwdId).toBeNull()
  })

  test('removeCwd(activeId) reassigns to the first remaining cwd', () => {
    useCwdStore.getState().addCwd('first', '/first')
    useCwdStore.getState().addCwd('second', '/second')
    const firstId = useCwdStore.getState().cwds[0].id
    const secondId = useCwdStore.getState().cwds[1].id
    useCwdStore.getState().setActive(firstId)
    useCwdStore.getState().removeCwd(firstId)
    expect(useCwdStore.getState().activeCwdId).toBe(secondId)
  })

  test('removeCwd(non-active) keeps activeCwdId unchanged', () => {
    useCwdStore.getState().addCwd('first', '/first')
    useCwdStore.getState().addCwd('second', '/second')
    const firstId = useCwdStore.getState().cwds[0].id
    const secondId = useCwdStore.getState().cwds[1].id
    useCwdStore.getState().setActive(firstId)
    useCwdStore.getState().removeCwd(secondId)
    expect(useCwdStore.getState().activeCwdId).toBe(firstId)
  })

  test('removeCwd with unknown id leaves state unchanged', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const beforeCwds = useCwdStore.getState().cwds
    useCwdStore.getState().removeCwd('nonexistent-id')
    expect(useCwdStore.getState().cwds).toHaveLength(beforeCwds.length)
  })
})

describe('cwdStore — persistence', () => {
  test('state is written under localStorage key wfr.cwds after adding a cwd', () => {
    useCwdStore.getState().addCwd('proj', '/p')
    const raw = localStorage.getItem('wfr.cwds')
    expect(raw).not.toBeNull()
    const stored = JSON.parse(raw!)
    expect(stored.state.cwds).toHaveLength(1)
    expect(stored.state.cwds[0].label).toBe('proj')
    expect(stored.state.cwds[0].path).toBe('/p')
  })

  test('state rehydrates from localStorage key wfr.cwds on reload', async () => {
    const testId = 'rehydrate-test-id'
    // Reset in-memory state (this also writes empty state to localStorage via persist)
    useCwdStore.setState({ cwds: [], activeCwdId: null })
    // Overwrite localStorage with test data after the empty-state write
    localStorage.setItem(
      'wfr.cwds',
      JSON.stringify({
        state: { cwds: [{ id: testId, label: 'proj', path: '/p' }], activeCwdId: testId },
        version: 0,
      }),
    )
    // Trigger rehydration from the new localStorage contents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (useCwdStore as any).persist.rehydrate()

    const { cwds, activeCwdId } = useCwdStore.getState()
    expect(cwds).toHaveLength(1)
    expect(cwds[0].id).toBe(testId)
    expect(cwds[0].label).toBe('proj')
    expect(activeCwdId).toBe(testId)
  })
})
