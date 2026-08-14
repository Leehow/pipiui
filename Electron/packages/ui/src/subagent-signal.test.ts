import { describe, expect, it } from 'vitest'
import { parseSubagentSignal } from './subagent-signal'

describe('parseSubagentSignal', () => {
  it('parses done outcome, title, verification and metadata without exposing the header as summary', () => {
    const signal = parseSubagentSignal('[subagent-done] agentId=a1 runId=r1 name=general-purpose ok=true verified=fail cost=0.1659 turns=9 resumed=true\nTitle: 修复列表\nVerify: $ npm test → exit 1 (attested)\nResult:\n完成 src/report.md')!
    expect(signal).toMatchObject({ kind: 'done', tone: 'warning', summary: '已完成 · 修复列表' })
    expect(signal.meta).toContain('验证失败')
    expect(signal.meta).toContain('cost 0.1659')
    expect(signal.meta).toContain('9 turns')
    expect(signal.detail).toContain('Verify: $ npm test')
    expect(signal.detail).toContain('Result:')
    expect(signal.summary).not.toContain('[subagent-done]')
  })

  it.each([
    ['[subagent-heartbeat] outstanding=2 vanished=0 stalled=0\n  a1 (探索) — running 2m, idle 4s, state=running', 'heartbeat', 'running'],
    ['[subagent-stalled] agentId=a1 title=探索当前实现 idle=120s last=thinking\nQuery it first', 'stalled', 'warning'],
    ['[subagent-interrupted-reminder] agentId=a1 runId=r1 state=failed title=验证 idle=300s nudge=1/2\nResolve it', 'interrupted-reminder', 'error'],
    ['[subagent-blocked] agentId=a2 title=实现 is held: dependency a1 did not succeed.', 'blocked', 'warning'],
  ] as const)('parses %s', (content, kind, tone) => {
    expect(parseSubagentSignal(content)).toMatchObject({ kind, tone })
  })

  it('keeps a spaced stalled title concise', () => {
    expect(parseSubagentSignal('[subagent-stalled] agentId=a1 title=探索当前实现 idle=120s last=thinking\nQuery it first')).toMatchObject({
      summary: '停滞 · 探索当前实现',
      meta: '空闲 120s',
    })
  })

  it('marks aborted done and recovered/re-delivery wrappers', () => {
    expect(parseSubagentSignal('[subagent-done] name=worker ok=false aborted=true verified=none\nResult:\nstopped')).toMatchObject({ tone: 'warning', summary: '已中止 · worker' })
    const retry = parseSubagentSignal('(re-delivery #2: previous done not confirmed)\n[subagent-done] name=worker ok=false verified=none\nResult:\nfailed')
    expect(retry).toMatchObject({ delivery: 'retry', kind: 'done' })
    expect(retry?.detail).toContain('(re-delivery #2: previous done not confirmed)')
    expect(parseSubagentSignal('(recovered delivery: previous done)\n[subagent-done] name=worker ok=true verified=pass\nResult:\nok')).toMatchObject({ delivery: 'recovered', kind: 'done' })
  })

  it('uses generic fallback for malformed or future subagent families and rejects ordinary text', () => {
    expect(parseSubagentSignal('[subagent-future] opaque protocol')).toMatchObject({ kind: 'unknown', tone: 'neutral', detail: '[subagent-future] opaque protocol' })
    expect(parseSubagentSignal('[subagent- malformed')).toMatchObject({ kind: 'unknown' })
    expect(parseSubagentSignal('(re-delivery #1: previous done not confirmed)')).toMatchObject({ kind: 'unknown', delivery: 'retry', summary: '子任务送达通知' })
    expect(parseSubagentSignal('ordinary user prompt')).toBeNull()
  })
})
