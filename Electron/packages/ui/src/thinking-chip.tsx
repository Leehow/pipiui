import { useEffect, useState } from 'react'
import type { ThinkingLevel } from '@pipi/host-api'

/**
 * Line-art brain glyph replicating the Swift InputBar thinking icon
 * (`Image(systemName: "brain")`) as a local inline SVG: single gray stroke,
 * no fill, rounded outline. No emoji, no network resources.
 */
export function BrainIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      className="thinking-brain"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-testid="thinking-brain-icon"
    >
      {/* central longitudinal fissure */}
      <path d="M12 4.6v14.8" />
      {/* left hemisphere outline with rounded lobes */}
      <path d="M12 4.6c-1.4-1.4-3.5-1.5-4.9-.2C5.4 5.8 4.7 7.6 5.2 9.3c-1.4.7-2.3 2.3-1.8 3.9.4 1.2 1.4 2.1 2.6 2.3.5 1.3 1.7 2.3 3.1 2.4.1 1.4.8 2.7 2 3.4.6.4 1.5.5 2.2.2" />
      {/* right hemisphere outline */}
      <path d="M12 4.6c1.4-1.4 3.5-1.5 4.9-.2 1.7 1.4 2.4 3.2 1.9 4.9 1.4.7 2.3 2.3 1.8 3.9-.4 1.2-1.4 2.1-2.6 2.3-.5 1.3-1.7 2.3-3.1 2.4-.1 1.4-.8 2.7-2 3.4-.6.4-1.5.5-2.2.2" />
    </svg>
  )
}

/**
 * Compact thinking selector matching Swift InputBar `thinkingMenu`: one
 * inline-flex button holding the brain icon + current level + chevron; opens a
 * keyboard/ARIA-friendly menu of available thinking levels.
 */
export function ThinkingChip({ level, levels, onChange }: {
  level: ThinkingLevel
  levels: ThinkingLevel[]
  onChange: (level: ThinkingLevel) => void
}) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  const modelDecides = levels.length === 0
  const noChoice = levels.length <= 1
  const displayLevel = modelDecides ? 'auto' : level
  return (
    <div className="quick-menu-anchor thinking-chip-anchor" data-testid="thinking-chip-anchor">
      <button
        type="button"
        className="thinking-chip"
        aria-label={modelDecides ? '思考强度由模型决定' : `思考级别（当前：${level}）`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={noChoice}
        title={modelDecides ? '思考强度由模型决定' : undefined}
        data-testid="thinking-chip"
        onClick={() => setOpen(value => !value)}
      >
        <BrainIcon size={13} />
        <span className="thinking-chip-level">{displayLevel}</span>
      </button>
      {open && (
        <>
          <div className="quick-menu-backdrop" data-testid="thinking-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="quick-menu thinking-menu" role="menu" aria-label="Thinking 级别" data-testid="thinking-menu">
            {levels.map(item => {
              const current = item === level
              return (
                <button
                  key={item}
                  type="button"
                  role="menuitemradio"
                  aria-checked={current}
                  className={`quick-menu-row ${current ? 'current' : ''}`}
                  data-testid={`thinking-row-${item}`}
                  onClick={() => { onChange(item); setOpen(false) }}
                >
                  <span className="quick-menu-name">{item}</span>
                  {current && <span className="quick-menu-check">✓</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
