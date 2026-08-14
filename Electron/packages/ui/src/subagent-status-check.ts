/** Matches Swift `SubagentWatchdog.staleThreshold`: 10 minutes of silent observation. */
export const SUBAGENT_STALE_THRESHOLD_MS = 10 * 60 * 1000

type ObservedAgent = {
  agentId: string
  state: string
  updatedAt?: number
  createdAt?: number
  startedAt?: number
}

export function lastObservedAt(agent: ObservedAgent): number | undefined {
  return agent.updatedAt ?? agent.createdAt ?? agent.startedAt
}

/**
 * Running/stalled workers whose host observation has been silent for the
 * conservative watchdog window. `now` is injectable for deterministic tests.
 */
export function staleRunningAgentIDs(
  agents: readonly ObservedAgent[],
  now: number,
  threshold = SUBAGENT_STALE_THRESHOLD_MS,
): string[] {
  return agents.flatMap(agent => {
    if (agent.state !== 'running' && agent.state !== 'stalled') return []
    const observed = lastObservedAt(agent)
    if (observed === undefined) return []
    if (now - observed < threshold) return []
    return [agent.agentId]
  })
}

/**
 * User-clicked UI fallback when the automatic status channel may be unavailable.
 * Narrowly scoped so a status check cannot be mistaken for work authority.
 * Mirrors Swift `SubagentStatusCheckPrompt.make`.
 */
export function makeSubagentStatusCheckPrompt(agentIDs: readonly string[]): string {
  const exactIDs = agentIDs.map(id => `\`${id}\``).join('、')
  return [
    `这是用户在界面主动发起的仅状态检查。请先且只针对以下确切 agentId 调用 \`subagent_status\`：${exactIDs}。`,
    '',
    '不要自动重新派发任何 subagent；不要修改文件、搜索项目，或执行其他工具/操作。若状态通道不可用或无法确认，请直接清楚报告“状态不可确认”。',
  ].join('\n')
}

export function statusChannelWarningText(staleAgentIDs: readonly string[]): string {
  const visibleIDs = staleAgentIDs.slice(0, 3).join('、')
  const suffix = staleAgentIDs.length > 3 ? ' 等' : ''
  return `${staleAgentIDs.length} 个子代理（${visibleIDs}${suffix}）超过 10 分钟未收到状态更新；自动状态通道可能不可用，暂时无法确认状态。`
}
