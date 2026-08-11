import { useState, type ReactNode } from 'react'

export type ActivityCardKind = 'default' | 'thinking' | 'tool' | 'result' | 'diff' | 'final'

/** Shared compact disclosure card for main-transcript and subagent execution steps. */
export function ActivityCard({
  summary,
  running = false,
  error = false,
  kind = 'default',
  label,
  meta,
  defaultExpanded = false,
  children
}: {
  summary: string
  running?: boolean
  error?: boolean
  kind?: ActivityCardKind
  label?: string
  meta?: string
  defaultExpanded?: boolean
  children: ReactNode
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const indicator = running ? '◌' : error ? '×' : kind === 'thinking' ? '◌' : '✓'

  return <section className={`activity-card activity-card-${kind}${error ? ' activity-card-error' : ''}`} data-activity-card={kind}>
    <button className="activity-summary" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      <span className="activity-status" aria-hidden="true">{indicator}</span>
      {label && <span className="activity-kind">{label}</span>}
      <b>{summary}</b>
      <small className="activity-meta">{meta ?? (running ? '运行中' : '已完成')}</small>
      <span className="activity-chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
    </button>
    {expanded && <div className="activity-details">{children}</div>}
  </section>
}
