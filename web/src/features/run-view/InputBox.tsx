import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface InputBoxProps {
  enabled: boolean
  onSend: (message: string) => void
}

export function InputBox({ enabled, onSend }: InputBoxProps) {
  const [value, setValue] = useState('')

  function submit() {
    const text = value.trim()
    if (!text || !enabled) return
    onSend(text)
    setValue('')
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    submit()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-t bg-background p-4" data-testid="input-box">
      <Textarea
        data-testid="chat-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!enabled}
        placeholder={enabled ? 'Send a message…' : 'Waiting for interactive mode…'}
        rows={2}
        className="min-h-0 flex-1 resize-none"
        aria-label="Message"
      />
      <Button type="submit" disabled={!enabled || !value.trim()} className="self-end">
        Send
      </Button>
    </form>
  )
}
