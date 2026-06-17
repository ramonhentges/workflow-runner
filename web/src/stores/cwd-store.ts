import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { generateId } from '@/lib/utils'

export interface Cwd {
  id: string
  label: string
  path: string
}

export interface CwdState {
  cwds: Cwd[]
  activeCwdId: string | null
  addCwd(label: string, path: string): void
  removeCwd(id: string): void
  setActive(id: string): void
  activeCwd(): Cwd | null
}

export const useCwdStore = create<CwdState>()(
  persist(
    (set, get) => ({
      cwds: [],
      activeCwdId: null,
      addCwd(label, path) {
        const id = generateId()
        set(state => ({
          cwds: [...state.cwds, { id, label, path }],
          activeCwdId: state.activeCwdId === null ? id : state.activeCwdId,
        }))
      },
      removeCwd(id) {
        set(state => {
          const cwds = state.cwds.filter(c => c.id !== id)
          let activeCwdId = state.activeCwdId
          if (activeCwdId === id) {
            activeCwdId = cwds.length > 0 ? cwds[0].id : null
          }
          return { cwds, activeCwdId }
        })
      },
      setActive(id) {
        set({ activeCwdId: id })
      },
      activeCwd() {
        const { cwds, activeCwdId } = get()
        return cwds.find(c => c.id === activeCwdId) ?? null
      },
    }),
    { name: 'wfr.cwds' },
  ),
)
