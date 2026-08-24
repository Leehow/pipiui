// @vitest-environment jsdom
import { createElement } from 'react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { AgentDiagnostics, AgentSummary } from '@pipi/host-api'
import { formatFinalizationLine, isTerminalFinalizingPhase, liveRunningProgressLine } from './agent-finalization'
import { diagnoseAgentProgress } from './agent-stall-diagnostics'
import { LiveSubagentCard } from './LiveSubagentCard'

describe('finalization progress copy', () => {
  const now = 50_000

  it('treats runtime closeout probes as terminal finalizing', () => {
    expect(isTerminalFinalizingPhase('queue-wait')).toBe(true)
    expect(isTerminalFinalizingPhase('on-merged')).toBe(true)
    expect(isTerminalFinalizingPhase('generating')).toBe(false)
    expect(isTerminalFinalizingPhase('tool-active')).toBe(false)
    expect(isTerminalFinalizingPhase('not-a-phase')).toBe(false)
    expect(isTerminalFinalizingPhase(undefined)).toBe(false)
  })

  it.each([
    ['queue-wait', '收尾中：排队等待 · 5s'],
    ['on-merged', '收尾中：合并后处理 · 5s'],
  ] as const)('renders runtime probe %s as closeout', (phase, expected) => {
    const diagnostics = { finalizationPhase: phase, phaseSince: now - 5_000 } as unknown as AgentDiagnostics
    expect(formatFinalizationLine(diagnostics, now)).toBe(expected)
    expect(liveRunningProgressLine({ state: 'running', diagnostics, now })).toBe(expected)
  })

  it.each([
    ['final-received', '收尾中：总结已完成 · 5s'],
    ['verifying', '收尾中：验证 · 5s'],
    ['reconciling', '收尾中：对账 · 5s'],
    ['merging', '收尾中：合并 · 5s'],
    ['post-verify', '收尾中：合并后验证 · 5s'],
    ['cleaning', '收尾中：清理 · 5s'],
    ['done-await-host', '收尾中：等待状态同步 · 5s'],
  ] as const)('renders %s without old quiet copy', (phase, expected) => {
    const diagnostics = { finalizationPhase: phase, phaseSince: now - 5_000, toolWaitName: 'bash', watchdogDecision: 'tool-quiet-alive' as const }
    expect(formatFinalizationLine(diagnostics, now)).toBe(expected)
    const line = liveRunningProgressLine({
      state: 'running',
      diagnostics,
      activityActive: true,
      listSubtitle: 'bash git diff HEAD -- a.ts',
      now,
    })
    expect(line).toBe(expected)
    expect(line).not.toContain('思考中')
    expect(line).not.toContain('无新进展')
    expect(line).not.toContain('git diff')
    expect(line).not.toMatch(/\b\d{2,}\b/)
  })

  it('stalled plus closeout still shows the real phase, not ordinary stall copy', () => {
    const diagnostics = { finalizationPhase: 'post-verify' as const, phaseSince: now - 5_000 }
    expect(liveRunningProgressLine({ state: 'stalled', diagnostics, now })).toBe('收尾中：合并后验证 · 5s')
    expect(liveRunningProgressLine({
      state: 'stalled',
      diagnostics,
      activityActive: true,
      listSubtitle: 'bash git diff HEAD -- a.ts',
      now,
    })).toBe('收尾中：合并后验证 · 5s')
    expect(liveRunningProgressLine({
      state: 'ok',
      diagnostics,
      now,
    })).toBeUndefined()
    expect(liveRunningProgressLine({
      state: 'aborted',
      diagnostics,
      now,
    })).toBeUndefined()
    expect(liveRunningProgressLine({
      state: 'interrupted',
      diagnostics,
      now,
    })).toBeUndefined()
  })

  it('cleaning then post-verify keeps the later UI line', () => {
    const afterCleaning = formatFinalizationLine({ finalizationPhase: 'cleaning', phaseSince: now - 4_000 }, now)
    const afterPostVerify = formatFinalizationLine({ finalizationPhase: 'post-verify', phaseSince: now - 1_000 }, now)
    expect(afterCleaning).toBe('收尾中：清理 · 4s')
    expect(afterPostVerify).toBe('收尾中：合并后验证 · 1s')
  })

  it('legacy missing phase does not invent a closeout line', () => {
    expect(formatFinalizationLine({}, now)).toBeUndefined()
    expect(formatFinalizationLine(undefined, now)).toBeUndefined()
    expect(liveRunningProgressLine({ state: 'running', now })).toBeUndefined()
  })

  it('terminal states stop showing closeout', () => {
    expect(liveRunningProgressLine({
      state: 'ok',
      diagnostics: { finalizationPhase: 'done-await-host', phaseSince: now - 1_000 },
      now,
    })).toBeUndefined()
    expect(liveRunningProgressLine({
      state: 'aborted',
      diagnostics: { finalizationPhase: 'verifying', phaseSince: now - 1_000 },
      now,
    })).toBeUndefined()
    expect(liveRunningProgressLine({
      state: 'interrupted',
      diagnostics: { finalizationPhase: 'reconciling', phaseSince: now - 1_000 },
      now,
    })).toBeUndefined()
  })

  it('process-missing persisted running is reconciliation, not thinking', () => {
    const line = liveRunningProgressLine({
      state: 'running',
      diagnostics: { persistedRunning: true, reconciliation: 'interrupted', generationMatch: false },
      activityActive: true,
      listSubtitle: 'bash git diff',
      now,
    })
    expect(line).toBe('进程已中断，正在对账')
    expect(line).not.toContain('思考中')
  })

  it('diagnose treats finalizing as not tool-quiet or cpu-progress', () => {
    const view = diagnoseAgentProgress({
      now,
      state: 'running',
      updatedAt: 1_000,
      diagnostics: {
        finalizationPhase: 'verifying',
        phaseSince: now - 8_000,
        watchdogDecision: 'cpu-progress',
        cpuVerdict: 'working',
        hostReceivedAt: now - 1_000,
      },
    })
    expect(view.kind).toBe('finalizing')
    expect(view.conclusion).toContain('收尾中：验证')
    expect(view.conclusion).not.toContain('尚未构成真实卡死')
    expect(view.fields.some(field => field.label === '子进程 PID')).toBe(false)
  })

  it('keeps the live card in sync with the list closeout line', () => {
    const now = Date.now()
    const agent = {
      agentId: 'a1', runId: 'r1', name: 'general-purpose', task: 'pack', state: 'running' as const,
      listSubtitle: 'bash git diff HEAD -- a.ts', activityActive: true,
      diagnostics: { finalizationPhase: 'cleaning' as const, phaseSince: now - 3_000 },
    } satisfies AgentSummary
    render(createElement(LiveSubagentCard, {
      projection: {
        roots: [agent], agents: [agent], visibleAgents: [agent], hiddenCount: 0,
        totalCount: 1, runningCount: 1, stalledCount: 0, completedCount: 0, failedCount: 0,
      },
    }))
    expect(screen.getByTestId('subagent-tool-card').textContent).toContain('收尾中：清理 · 3s')
    expect(screen.getByTestId('subagent-tool-card').textContent).not.toContain('思考中')
    expect(screen.getByTestId('subagent-tool-card').textContent).not.toContain('git diff')
  })
})
