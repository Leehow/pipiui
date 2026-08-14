import { describe, expect, it } from 'vitest'
import {
  SUBAGENT_STALE_THRESHOLD_MS,
  makeSubagentStatusCheckPrompt,
  staleRunningAgentIDs,
  statusChannelWarningText,
} from './subagent-status-check'

const base = 1_000

function agent(id: string, state: string, lastObserved: number) {
  return { agentId: id, state, updatedAt: lastObserved, createdAt: base, startedAt: base }
}

describe('staleRunningAgentIDs', () => {
  it('only running or stalled agents become stale at ten minutes', () => {
    const exact = base + SUBAGENT_STALE_THRESHOLD_MS
    expect(staleRunningAgentIDs([
      agent('silent', 'running', base),
      agent('stalled', 'stalled', base),
      agent('active', 'running', exact),
      agent('finished', 'ok', base),
      agent('interrupted', 'interrupted', base),
    ], exact)).toEqual(['silent', 'stalled'])
  })

  it('uses >= the watchdog threshold, so 9:59 is not stale', () => {
    const agentRow = agent('boundary', 'running', base)
    expect(staleRunningAgentIDs([agentRow], base + SUBAGENT_STALE_THRESHOLD_MS - 1)).toEqual([])
    expect(staleRunningAgentIDs([agentRow], base + SUBAGENT_STALE_THRESHOLD_MS)).toEqual(['boundary'])
  })

  it('falls back from updatedAt to createdAt to startedAt', () => {
    const now = base + SUBAGENT_STALE_THRESHOLD_MS
    expect(staleRunningAgentIDs([{ agentId: 'created', state: 'running', createdAt: base }], now)).toEqual(['created'])
    expect(staleRunningAgentIDs([{ agentId: 'started', state: 'running', startedAt: base }], now)).toEqual(['started'])
    expect(staleRunningAgentIDs([{ agentId: 'fresh-created', state: 'running', createdAt: now }], now)).toEqual([])
    expect(staleRunningAgentIDs([{ agentId: 'unknown', state: 'running' }], now)).toEqual([])
  })
})

describe('makeSubagentStatusCheckPrompt', () => {
  it('names exact IDs and restricts authority to a status check', () => {
    const prompt = makeSubagentStatusCheckPrompt(['agent-a', 'agent-b'])
    expect(prompt).toContain('`agent-a`、`agent-b`')
    expect(prompt).toContain('subagent_status')
    expect(prompt).toContain('用户在界面主动发起')
    expect(prompt).toContain('不要自动重新派发')
    expect(prompt).toContain('不要修改文件、搜索项目')
    expect(prompt).toContain('状态不可确认')
  })
})

describe('statusChannelWarningText', () => {
  it('lists up to three IDs and suffixes the rest', () => {
    expect(statusChannelWarningText(['a1'])).toContain('1 个子代理（a1）')
    expect(statusChannelWarningText(['a1', 'a2', 'a3', 'a4'])).toContain('4 个子代理（a1、a2、a3 等）')
  })
})
