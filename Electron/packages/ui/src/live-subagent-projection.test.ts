import { describe, expect, it } from 'vitest'
import type { AgentSummary } from '@pipi/host-api'
import { projectLiveSubagents } from './live-subagent-projection'

const agent = (agentId: string, sessionId: string, state: AgentSummary['state'], extra: Partial<AgentSummary> = {}): AgentSummary => ({ agentId, runId: `${agentId}-run`, name: agentId, task: agentId, sessionId, state, ...extra })
const tool = { id: 'call-1', result: 'Started background agent(s) (1).\n- agentId=root' }

describe('live subagent projection', () => {
  it('binds root and descendants by toolCallId only inside the selected session', () => {
    const projection = projectLiveSubagents(tool, 'A', [
      agent('root', 'A', 'running', { toolCallId: 'call-1' }),
      agent('child', 'A', 'stalled', { parentId: 'root', depth: 2 }),
      agent('other-tool', 'A', 'running', { toolCallId: 'call-9' }),
      agent('root', 'B', 'failed', { toolCallId: 'call-1' }),
    ])
    expect(projection.agents.map(item => item.agentId)).toEqual(['root', 'child'])
    expect(projection).toMatchObject({ runningCount: 2, stalledCount: 1, completedCount: 0, failedCount: 0 })
  })

  it('counts terminal transitions and bounds mounted rows', () => {
    const inventory = [agent('root', 'A', 'ok', { toolCallId: 'call-1' }), ...Array.from({ length: 19 }, (_, index) => agent(`child-${index}`, 'A', index === 18 ? 'failed' : 'ok', { parentId: 'root' }))]
    const projection = projectLiveSubagents(tool, 'A', inventory)
    expect(projection).toMatchObject({ totalCount: 20, completedCount: 19, failedCount: 1, hiddenCount: 8 })
    expect(projection.visibleAgents).toHaveLength(12)
    expect(projection.visibleAgents[0].agentId).toBe('child-18')
  })

  it('does not bind an unrelated tool call in the same session', () => {
    const projection = projectLiveSubagents({ id: 'call-2' }, 'A', [
      agent('root', 'A', 'running', { toolCallId: 'call-1' }),
      agent('child', 'A', 'running', { parentId: 'root' }),
    ])
    expect(projection).toMatchObject({ totalCount: 0, runningCount: 0, failedCount: 0 })
  })

  it('does not let a reusable agentId in an old result override the current toolCallId', () => {
    const current = agent('stable-worker', 'A', 'running', { toolCallId: 'call-new' })
    const old = projectLiveSubagents({ id: 'call-old', result: 'Started background agent(s) (1).\n- agentId=stable-worker' }, 'A', [current])
    const next = projectLiveSubagents({ id: 'call-new' }, 'A', [current])

    expect(old).toMatchObject({ totalCount: 0, runningCount: 0 })
    expect(next.agents.map(item => item.agentId)).toEqual(['stable-worker'])
  })
})
