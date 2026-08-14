import { memo } from 'react'
import { ActivityCard } from './ActivityCard'
import { DocumentReferenceCards } from './DocumentReferenceCards'
import { parseSubagentSignal } from './subagent-signal'
import './subagent-signal-card.css'

export const SubagentSignalCard = memo(function SubagentSignalCard({ content, documentBasePath, onOpenDocument }: { content: string; documentBasePath?: string; onOpenDocument?: (path: string) => void }) {
  const signal = parseSubagentSignal(content)
  if (!signal) return null
  return <div className={`subagent-signal-card subagent-signal-${signal.tone}`} data-testid="subagent-signal-card" data-signal-kind={signal.kind}>
    <ActivityCard kind={signal.tone === 'success' ? 'result' : 'default'} label={signal.label} summary={signal.summary} meta={signal.meta || undefined} running={signal.tone === 'running'} error={signal.tone === 'error'} defaultExpanded={false}>
      <pre className="subagent-signal-detail">{signal.detail}</pre>
      <DocumentReferenceCards content={signal.detail} basePath={documentBasePath} onOpenDocument={onOpenDocument} />
    </ActivityCard>
  </div>
})
