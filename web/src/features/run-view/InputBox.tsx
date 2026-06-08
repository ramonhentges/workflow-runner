import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface InputBoxProps {
  enabled: boolean
  onSend: (message: string) => void
}

export function InputBox({ enabled, onSend }: InputBoxProps) {
  const [value, setValue] = useState('')

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const text = value.trim()
    if (!text || !enabled) return
    onSend(text)
    setValue('')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 border-t bg-background p-4" data-testid="input-box">
      <Input
        data-testid="chat-input"
        value={value}
        onChange={e => setValue(e.target.value)}
        disabled={!enabled}
        placeholder={enabled ? 'Send a message…' : 'Waiting for interactive mode…'}
        className="flex-1"
        aria-label="Message"
      />
      <Button type="submit" disabled={!enabled || !value.trim()}>
        Send
      </Button>
    </form>
  )
}
