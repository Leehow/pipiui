import type { AgentSummary } from '@pipi/host-api'
import type { TranscriptTool } from './transcript-model'

export type LiveSubagentProjection = {
  roots: AgentSummary[]
  agents: AgentSummary[]
  visibleAgents: AgentSummary[]
  hiddenCount: number
  totalCount: number
  runningCount: number
  stalledCount: number
  completedCount: number
  failedCount: number
}

export const LIVE_SUBAGENT_ROW_LIMIT = 12

const stalled = (agent: AgentSummary) => agent.stalled === true || agent.state === 'stalled'
const running = (agent: AgentSummary) => agent.state === 'running' && !stalled(agent)
const failed = (agent: AgentSummary) => agent.state === 'failed' || agent.state === 'aborted' || agent.state === 'interrupted'
const problematic = (agent: AgentSummary) => stalled(agent) || failed(agent)

/** Pure toolCallId projection, scoped before root and descendant traversal. */
export function projectLiveSubagents(
  tool: Pick<TranscriptTool, 'id' | 'result'>,
  sessionId: string,
  inventory: readonly AgentSummary[],
  rowLimit = LIVE_SUBAGENT_ROW_LIMIT,
): LiveSubagentProjection {
  const scoped = inventory.filter(agent => agent.sessionId === sessionId)
  const roots = scoped.filter(agent => agent.toolCallId === tool.id)
  const included = new Set(roots.map(agent => agent.agentId))
  let changed = true
  while (changed) {
    changed = false
    for (const agent of scoped) {
      if (agent.parentId && included.has(agent.parentId) && !included.has(agent.agentId)) {
        included.add(agent.agentId)
        changed = true
      }
    }
  }
  const agents = scoped.filter(agent => included.has(agent.agentId))
  const limit = Math.max(0, rowLimit)
  const visibleAgents = [
    ...agents.filter(problematic).reverse(),
    ...agents.filter(running).reverse(),
    ...agents.filter(agent => !problematic(agent) && !running(agent)).reverse(),
  ].slice(0, limit)
  return {
    roots,
    agents,
    visibleAgents,
    hiddenCount: Math.max(0, agents.length - visibleAgents.length),
    totalCount: agents.length,
    runningCount: agents.filter(agent => agent.state === 'running' || stalled(agent)).length,
    stalledCount: agents.filter(stalled).length,
    completedCount: agents.filter(agent => agent.state === 'ok').length,
    failedCount: agents.filter(failed).length,
  }
}
