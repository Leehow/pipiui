import { describe, expect, it } from 'vitest'
import { diagnoseAgentProgress } from './agent-stall-diagnostics'

describe('diagnoseAgentProgress', () => {
  it('does not treat a silent long tool with CPU progress as a real stall', () => {
    const view = diagnoseAgentProgress({
      now: 200_000,
      state: 'running',
      updatedAt: 10_000,
      diagnostics: {
        eventSeq: 8,
        processGeneration: '10:1',
        hostGeneration: '10:1',
        generationMatch: true,
        toolWaitName: 'bash',
        cpuVerdict: 'working',
        lastCpuDeltaMs: 1500,
        watchdogDecision: 'cpu-progress',
        hostReceivedAt: 190_000,
      },
    })
    expect(view.kind).toBe('cpu-progress')
    expect(view.conclusion).toContain('CPU')
    expect(view.conclusion).toContain('尚未构成真实卡死')
    expect(view.conclusion).not.toContain('真实卡死证据')
  })

  it('maps process generation mismatch to leftover and stale host receive to seq-stale', () => {
    const generation = diagnoseAgentProgress({
      now: 50_000,
      state: 'interrupted',
      updatedAt: 1_000,
      diagnostics: {
        eventSeq: 3,
        processGeneration: '1:100',
        hostGeneration: '9:900',
        generationMatch: false,
        persistedRunning: true,
        reconciliation: 'interrupted',
      },
    })
    expect(generation.kind).toBe('generation-mismatch')
    expect(generation.conclusion).toContain('遗留运行态')

    const seq = diagnoseAgentProgress({
      now: 90_000,
      state: 'running',
      updatedAt: 1_000,
      diagnostics: {
        eventSeq: 4,
        seqGap: 6,
        hostReceivedAt: 2_000,
        processGeneration: '1:100',
        generationMatch: true,
      },
    })
    expect(seq.kind).toBe('seq-stale')
    expect(seq.conclusion).toContain('宿主接收')
  })

  it('does not treat seqGap as link silence while the host is still receiving', () => {
    const view = diagnoseAgentProgress({
      now: 90_000,
      state: 'running',
      updatedAt: 80_000,
      diagnostics: {
        eventSeq: 12,
        seqGap: 6,
        hostReceivedAt: 88_000,
        processGeneration: '1:100',
        generationMatch: true,
        cpuVerdict: 'working',
        watchdogDecision: 'cpu-progress',
      },
    })
    expect(view.kind).toBe('cpu-progress')
    expect(view.conclusion).not.toContain('链路可能中断')
  })

  it('treats a stale working snapshot as seq-stale instead of still advancing', () => {
    const view = diagnoseAgentProgress({
      now: 200_000,
      state: 'running',
      updatedAt: 10_000,
      diagnostics: {
        eventSeq: 8,
        cpuVerdict: 'working',
        watchdogDecision: 'cpu-progress',
        hostReceivedAt: 100_000,
        generationMatch: true,
      },
    })
    expect(view.kind).toBe('seq-stale')
    expect(view.conclusion).not.toContain('仍有推进')
  })

  it('separates output-recent, cpu-progress, and tool-quiet-alive conclusions', () => {
    const output = diagnoseAgentProgress({
      now: 20_000,
      state: 'running',
      diagnostics: { watchdogDecision: 'output-recent', hostReceivedAt: 19_000 },
    })
    expect(output.kind).toBe('output-recent')
    expect(output.conclusion).toContain('输出')
    expect(output.conclusion).not.toContain('CPU')

    const cpu = diagnoseAgentProgress({
      now: 20_000,
      state: 'running',
      diagnostics: { watchdogDecision: 'cpu-progress', hostReceivedAt: 19_000 },
    })
    expect(cpu.kind).toBe('cpu-progress')
    expect(cpu.conclusion).toContain('CPU')
    expect(cpu.conclusion).not.toContain('输出')

    const quiet = diagnoseAgentProgress({
      now: 20_000,
      state: 'running',
      diagnostics: { watchdogDecision: 'tool-quiet-alive', hostReceivedAt: 19_000 },
    })
    expect(quiet.kind).toBe('tool-quiet-alive')
    expect(quiet.conclusion).toContain('尚未越过卡住门槛')
    expect(quiet.conclusion).not.toContain('仍有推进')
  })

  it('treats child exit as gone even when the last cpu snapshot said working', () => {
    const view = diagnoseAgentProgress({
      now: 20_000,
      state: 'running',
      diagnostics: {
        cpuVerdict: 'working',
        watchdogDecision: 'cpu-progress',
        exitReason: 'child-close:0',
        hostReceivedAt: 19_000,
      },
    })
    expect(view.kind).toBe('child-gone')
  })

  it('keeps updatedAt-only silence as a UI warning without stall evidence', () => {
    const view = diagnoseAgentProgress({
      now: 81_000,
      state: 'running',
      updatedAt: 0,
    })
    expect(view.kind).toBe('ui-quiet-only')
    expect(view.conclusion).toContain('尚无真实卡死证据')
  })
})
