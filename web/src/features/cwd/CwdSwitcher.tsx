import { FormEvent, useState } from 'react'
import { useCwdStore } from '@/stores/cwd-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export function CwdSwitcher() {
  const cwds = useCwdStore(state => state.cwds)
  const activeCwdId = useCwdStore(state => state.activeCwdId)
  const addCwd = useCwdStore(state => state.addCwd)
  const removeCwd = useCwdStore(state => state.removeCwd)
  const setActive = useCwdStore(state => state.setActive)

  const [label, setLabel] = useState('')
  const [path, setPath] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const trimmedLabel = label.trim()
    const trimmedPath = path.trim()
    if (!trimmedLabel || !trimmedPath) return
    addCwd(trimmedLabel, trimmedPath)
    setLabel('')
    setPath('')
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      {cwds.length === 0 ? (
        <p data-testid="cwd-empty-state" className="text-sm text-muted-foreground py-2">
          No working directories configured.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {cwds.map(cwd => (
            <li key={cwd.id} className="flex items-center gap-1">
              <button
                onClick={() => setActive(cwd.id)}
                aria-pressed={activeCwdId === cwd.id}
                className={cn(
                  'flex-1 text-left rounded px-2 py-1 text-sm transition-colors',
                  'hover:bg-accent hover:text-accent-foreground',
                  activeCwdId === cwd.id && 'bg-accent font-medium',
                )}
              >
                {cwd.label}
              </button>
              <span className="text-xs text-muted-foreground truncate max-w-32">{cwd.path}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => removeCwd(cwd.id)}
                aria-label={`Remove ${cwd.label}`}
                className="h-7 w-7 shrink-0"
              >
                ×
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-2 border-t pt-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cwd-label-input">Label</Label>
          <Input
            id="cwd-label-input"
            value={label}
            onChange={e => setLabel(e.target.value)}
            placeholder="e.g. My Project"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cwd-path-input">Path</Label>
          <Input
            id="cwd-path-input"
            value={path}
            onChange={e => setPath(e.target.value)}
            placeholder="/home/user/project"
          />
        </div>
        <Button type="submit" size="sm">
          Add
        </Button>
      </form>
    </div>
  )
}
