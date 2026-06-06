import { useId } from 'react'
import { Input } from '@/components/ui/input'
import type { IdeCatalogEntry } from '@/lib/api/types'

export interface AgentModelPickerProps {
  id?: string
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  entries: IdeCatalogEntry[]
  isFetching: boolean
  isReachable: boolean | undefined
  'data-testid'?: string
}

export function AgentModelPicker({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  entries,
  isFetching,
  isReachable,
  'data-testid': testId,
}: AgentModelPickerProps) {
  const listId = useId()

  return (
    <div>
      <Input
        id={id}
        list={listId}
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        data-testid={testId}
        autoComplete="off"
      />
      <datalist id={listId}>
        {entries.map(entry => (
          <option
            key={entry.id}
            value={entry.id}
            label={entry.name !== entry.id ? entry.name : undefined}
          />
        ))}
      </datalist>
      {isFetching && (
        <p
          className="text-xs text-muted-foreground mt-1"
          data-testid={testId ? `${testId}-status` : undefined}
        >
          Loading suggestions…
        </p>
      )}
      {!isFetching && isReachable === true && entries.length > 0 && (
        <p
          className="text-xs text-muted-foreground mt-1"
          data-testid={testId ? `${testId}-status` : undefined}
        >
          Suggestions from IDE
        </p>
      )}
      {!isFetching && isReachable === false && (
        <p
          className="text-xs text-muted-foreground mt-1"
          data-testid={testId ? `${testId}-status` : undefined}
        >
          IDE unreachable — enter manually
        </p>
      )}
    </div>
  )
}
