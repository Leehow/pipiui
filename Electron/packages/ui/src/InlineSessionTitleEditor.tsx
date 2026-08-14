import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

export function InlineSessionTitleEditor({ value, ariaLabel, className, onCommit, onCancel }: {
  value: string
  ariaLabel: string
  className: string
  onCommit: (value: string) => Promise<void> | void
  onCancel: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const committingRef = useRef(false)
  const [draft, setDraft] = useState(value)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = async () => {
    if (committingRef.current) return
    const title = draft.trim()
    if (!title || title === value) {
      onCancel()
      return
    }
    committingRef.current = true
    setPending(true)
    setError(null)
    try {
      await onCommit(title)
    } catch (reason) {
      committingRef.current = false
      setPending(false)
      setError(reason instanceof Error ? reason.message : String(reason))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }

  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') {
      event.preventDefault()
      void commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      className={className}
      aria-label={ariaLabel}
      aria-invalid={error ? 'true' : undefined}
      title={error ?? undefined}
      value={draft}
      maxLength={120}
      disabled={pending}
      onChange={event => setDraft(event.target.value)}
      onClick={event => event.stopPropagation()}
      onDoubleClick={event => event.stopPropagation()}
      onKeyDown={keyDown}
      onBlur={() => void commit()}
    />
  )
}
