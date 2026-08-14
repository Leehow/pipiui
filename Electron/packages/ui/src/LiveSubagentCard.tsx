import { memo } from 'react'
import type { AgentSummary } from '@pipi/host-api'
import type { LiveSubagentProjection } from './live-subagent-projection'
import './live-subagent-card.css'

function rowLine(agent: AgentSummary): string {
  if (agent.state === 'running' || agent.state === 'stalled') return agent.listSubtitle?.trim() || '思考中…'
  if (agent.state === 'ok') return `完成${agent.turns ? ` · ${agent.turns} turns` : ''}`
  if (agent.state === 'failed') return '失败'
  if (agent.state === 'aborted') return '已中止'
  return '已中断'
}

export const LiveSubagentCard = memo(function LiveSubagentCard({ projection, onOpenSubagents }: { projection: LiveSubagentProjection; onOpenSubagents?: (agentId?: string) => void }) {
  const running = projection.runningCount > 0
  const failed = projection.failedCount > 0
  const activate = (agentId?: string) => (event: React.MouseEvent | React.KeyboardEvent) => {
    event.stopPropagation()
    onOpenSubagents?.(agentId)
  }
  return <section className="activity-card activity-card-tool subagent-tool-card" data-activity-card="tool" data-testid="subagent-tool-card">
    <button className="subagent-tool-head" onClick={activate(projection.visibleAgents[0]?.agentId)} title="打开 Subagents 面板">
      <span className="activity-status" aria-hidden="true">{running ? <span className="agent-spinner" aria-label="运行中" /> : failed ? '×' : '✓'}</span>
      <b>subagent</b>
      <small className="activity-meta">共 {projection.totalCount} · 运行 {projection.runningCount} · 完成 {projection.completedCount} · 失败 {projection.failedCount}</small>
      <span className="subagent-tool-open" aria-hidden="true">›</span>
    </button>
    {projection.visibleAgents.map(agent => <button key={agent.agentId} className={`subagent-tool-row${agent.parentId ? ' child' : ''}`} onClick={activate(agent.agentId)}>
      <span className="agent-indent" style={{ width: Math.max(0, (agent.depth ?? 1) - 1) * 10 }} />
      {agent.parentId && <span className="agent-parent" aria-label="Leader 的子 agent">└</span>}
      <span className={`agent-state ${agent.state}`} title={agent.state}>
        {agent.state === 'running' ? <span className="agent-spinner" aria-label="运行中" /> : agent.state === 'ok' ? '✓' : agent.state === 'failed' ? '×' : agent.state === 'stalled' ? '!' : agent.state === 'aborted' ? '■' : '⚡'}
      </span>
      <span className="agent-copy"><strong>{agent.title?.trim() || agent.task?.trim() || agent.name}</strong><small>{rowLine(agent)}</small></span>
    </button>)}
    {projection.hiddenCount > 0 && <button className="subagent-tool-more" onClick={activate(projection.visibleAgents[0]?.agentId)}>另有 {projection.hiddenCount} 个子代理，点击查看全部</button>}
  </section>
})
