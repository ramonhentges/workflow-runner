import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckIcon, FolderPlus, X } from 'lucide-react'
import { Select as SelectPrimitive } from 'radix-ui'
import { useCwdStore } from '@/stores/cwd-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { cwdFormSchema, type CwdFormValues } from './CwdFormSchema'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

// Local select item: only the label lives inside ItemText (so the trigger's
// SelectValue mirrors just the name), while the path renders alongside it —
// visible only when the dropdown is open. Styling mirrors the shadcn SelectItem.
function CwdSelectItem({ id, label, path }: { id: string; label: string; path: string }) {
  return (
    <SelectPrimitive.Item
      value={id}
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      )}
    >
      <span className="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <span className="flex min-w-0 flex-col">
        <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
        <span className="truncate text-xs text-muted-foreground">{path}</span>
      </span>
    </SelectPrimitive.Item>
  )
}

export function CwdSwitcher() {
  const cwds = useCwdStore(state => state.cwds)
  const activeCwdId = useCwdStore(state => state.activeCwdId)
  const addCwd = useCwdStore(state => state.addCwd)
  const removeCwd = useCwdStore(state => state.removeCwd)
  const setActive = useCwdStore(state => state.setActive)

  const [manageOpen, setManageOpen] = useState(false)

  // Present both the combo box and the manage list alphabetically by label.
  // Spread first: Array.sort mutates in place and the store array is shared.
  const sortedCwds = useMemo(
    () =>
      [...cwds].sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
      ),
    [cwds],
  )

  const schema = useMemo(() => cwdFormSchema(cwds), [cwds])
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CwdFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { label: '', path: '' },
  })

  function onSubmit(values: CwdFormValues) {
    // Values are already trimmed by the schema.
    addCwd(values.label, values.path)
    reset({ label: '', path: '' })
  }

  const hasCwds = cwds.length > 0

  return (
    <div className="p-2">
      {/* Expanded: dropdown to select active cwd, register button stacked below. */}
      <div className="flex flex-col gap-2 group-data-[collapsible=icon]:hidden">
        {hasCwds ? (
          <Select value={activeCwdId ?? undefined} onValueChange={setActive}>
            <SelectTrigger
              size="sm"
              className="w-full"
              aria-label="Active working directory"
            >
              {/* Trigger mirrors the label only; options below show label + path. */}
              <SelectValue placeholder="Select directory" />
            </SelectTrigger>
            {/* popper (not item-aligned): the trigger sits at the bottom of the
                viewport, so the list must flip above it instead of overlaying. */}
            <SelectContent position="popper" side="top">
              {sortedCwds.map(cwd => (
                <CwdSelectItem key={cwd.id} id={cwd.id} label={cwd.label} path={cwd.path} />
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span data-testid="cwd-empty-state" className="text-sm text-muted-foreground">
            No working directories
          </span>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start"
          aria-label="Manage working directories"
          onClick={() => setManageOpen(true)}
        >
          <FolderPlus className="size-4" />
          Manage directories
        </Button>
      </div>

      {/* Collapsed icon rail: single icon button opening the same dialog. */}
      <div className="hidden justify-center group-data-[collapsible=icon]:flex">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Manage working directories"
          onClick={() => setManageOpen(true)}
        >
          <FolderPlus className="size-4" />
        </Button>
      </div>

      <Dialog
        open={manageOpen}
        onOpenChange={open => {
          setManageOpen(open)
          if (!open) reset({ label: '', path: '' })
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Working directories</DialogTitle>
            <DialogDescription>
              Register a working directory or remove existing ones.
            </DialogDescription>
          </DialogHeader>

          {hasCwds ? (
            <ul className="flex flex-col gap-1">
              {sortedCwds.map(cwd => (
                <li key={cwd.id} className="flex items-center gap-2 rounded px-2 py-1">
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{cwd.label}</span>
                    <span className="truncate text-xs text-muted-foreground">{cwd.path}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeCwd(cwd.id)}
                    aria-label={`Remove ${cwd.label}`}
                    className="h-7 w-7 shrink-0"
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No working directories configured.</p>
          )}

          <form
            onSubmit={handleSubmit(onSubmit)}
            className="flex flex-col gap-2 border-t pt-4"
            noValidate
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="cwd-label-input">Label</Label>
              <Input
                id="cwd-label-input"
                placeholder="e.g. My Project"
                aria-invalid={errors.label ? true : undefined}
                {...register('label')}
              />
              {errors.label && (
                <p className="text-xs text-destructive" data-testid="cwd-label-error">
                  {errors.label.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="cwd-path-input">Path</Label>
              <Input
                id="cwd-path-input"
                placeholder="/home/user/project"
                aria-invalid={errors.path ? true : undefined}
                {...register('path')}
              />
              {errors.path && (
                <p className="text-xs text-destructive" data-testid="cwd-path-error">
                  {errors.path.message}
                </p>
              )}
            </div>
            <Button type="submit" size="sm" className="self-end">
              Add
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
