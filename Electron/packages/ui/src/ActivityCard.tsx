import { useState, type ReactNode } from 'react'

export type ActivityCardKind = 'default' | 'thinking' | 'tool' | 'result' | 'diff' | 'final'

/** Shared compact disclosure card for main-transcript and subagent execution steps. */
export function ActivityCard({
  summary,
  running = false,
  error = false,
  warning = false,
  kind = 'default',
  label,
  meta,
  defaultExpanded = false,
  children
}: {
  summary: string
  running?: boolean
  error?: boolean
  warning?: boolean
  kind?: ActivityCardKind
  label?: string
  meta?: ReactNode
  defaultExpanded?: boolean
  children: ReactNode
}) {
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null)
  const open = userExpanded ?? (defaultExpanded || (running && kind === 'thinking'))
  const failed = error && !running
  const caution = warning && !running && !failed
  const indicator = running ? '◌' : failed ? '×' : caution ? '!' : kind === 'thinking' ? '◌' : '✓'
  const defaultMeta = running ? '运行中' : failed ? '失败' : caution ? '注意' : '已完成'

  return <section className={`activity-card activity-card-${kind}${failed ? ' activity-card-error' : caution ? ' activity-card-warning' : ''}`} data-activity-card={kind} data-activity-status={running ? 'running' : failed ? 'error' : caution ? 'warning' : 'ok'}>
    <button className="activity-summary" aria-expanded={open} onClick={() => setUserExpanded(!open)}>
      <span className="activity-status" aria-hidden="true">{indicator}</span>
      {label && <span className="activity-kind">{label}</span>}
      <b>{summary}</b>
      <small className="activity-meta">{meta ?? defaultMeta}</small>
      <span className="activity-chevron" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
    </button>
    {open && <div className="activity-details">{children}</div>}
  </section>
}
