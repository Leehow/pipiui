// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSummary, PipiHostAPI } from '@pipi/host-api'
import { SubagentPanel } from './SubagentPanel'

afterEach(() => {
  cleanup()
  localStorage.removeItem('pipiui:subagent-list-ratio')
})

function hostHarness() {
  let agents: ((event: AgentEvent) => void) | undefined
  const logs = new Map<string, (event: Extract<AgentEvent, { type: 'agent_log' }>) => void>()
  const abortAgent = vi.fn(async () => undefined)
  const resolveAgent = vi.fn(async () => undefined)
  const mergeWorktree = vi.fn(async agentId => ({ agentId, lifecycle: 'merged' as const, merge: 'merged' as const, discard: 'unavailable' as const }))
  const discardWorktree = vi.fn(async agentId => ({ agentId, lifecycle: 'discarded' as const, merge: 'unavailable' as const, discard: 'discarded' as const }))
  const host = {
    protocolVersion: 2,
    listAgents: async () => [],
    subscribeAgents: (listener: (event: AgentEvent) => void) => { agents = listener; return () => undefined },
    subscribeAgentLog: (id: string, listener: (event: Extract<AgentEvent, { type: 'agent_log' }>) => void) => { logs.set(id, listener); return () => logs.delete(id) },
    abortAgent,
    resolveAgent,
    mergeWorktree,
    discardWorktree
  } as unknown as PipiHostAPI
  return {
    host,
    abortAgent,
    resolveAgent,
    mergeWorktree,
    discardWorktree,
    emitAgent: (event: AgentEvent) => agents?.(event),
    emitLog: (id: string, event: Extract<AgentEvent, { type: 'agent_log' }>) => logs.get(id)?.(event)
  }
}

describe('SubagentPanel', () => {
  it('links a selected agent to details, renders duration/cost, and marks a failed agent handled', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'runner', runId: 'r-runner', name: 'runner', task: 'keep working', state: 'running', createdAt: 1 },
      { agentId: 'failed', runId: 'r-failed', name: 'failed', title: 'Failed detail', listSubtitle: 'failed row subtitle', task: 'inspect this failure', state: 'failed', createdAt: 0, endedAt: 61_000, cost: 1, costUnit: 'CNY', exchangeRate: 7.2, finalResult: 'failed-only result' }
    ]
    render(<SubagentPanel host={harness.host} />)

    const failedRow = await screen.findByTestId('agent-row-failed')
    const runnerRow = screen.getByTestId('agent-row-runner')
    await waitFor(() => expect(runnerRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(failedRow.querySelector('.agent-select')!)
    await waitFor(() => expect(failedRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))
    expect(document.querySelector('.detail-agent-title b')?.textContent).toBe('Failed detail')
    expect(screen.getByText('inspect this failure')).toBeTruthy()
    expect(screen.getByRole('button', { name: /failed-only result/ })).toBeTruthy()
    expect(screen.getByText('¥7.20 CNY')).toBeTruthy()
    expect(screen.getByText(/\$1\.00 USD/)).toBeTruthy()
    expect(screen.getAllByText(/61s/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('中止 runner')).toBeTruthy()
    expect(screen.queryByLabelText('中止 failed')).toBeNull()

    const resolve = screen.getByLabelText('标记 failed 已处理')
    fireEvent.mouseEnter(failedRow)
    resolve.focus()
    expect(document.activeElement).toBe(resolve)
    fireEvent.click(resolve)
    await waitFor(() => expect(harness.resolveAgent).toHaveBeenCalledWith('failed'))
    await waitFor(() => expect(screen.getByText('1 已处理')).toBeTruthy())
    expect(screen.queryByLabelText('标记 failed 已处理')).toBeNull()
  })

  it('shows the actionable empty state after an empty snapshot', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)

    expect(await screen.findByText('还没有 subagent')).toBeTruthy()
    expect(screen.getByText('0 个')).toBeTruthy()
    expect(screen.queryByTestId('agent-row-any')).toBeNull()
  })

  it('renders lifecycle counts and routes abort to the host', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running', cost: .2 } })
    harness.emitAgent({ type: 'agent', agent: { agentId: 'bad', runId: 'r2', name: 'review', task: 'verify', state: 'failed', cost: .1 } })
    await screen.findByText('2 个')
    expect(screen.getByText('1 运行中')).toBeTruthy()
    expect(screen.getByText('1 失败')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('中止 explore'))
    await waitFor(() => expect(harness.abortAgent).toHaveBeenCalledWith('run'))
  })

  it('renders AgentRow model, worktree, stalled, and currency metadata', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'live', runId: 'r-live', name: 'secretary', task: '收尾任务', state: 'running', stalled: true, stalledIdleSec: 42,
        provider: 'anthropic', model: 'anthropic/claude-sonnet-4', cost: .05, costUnit: 'CNY', exchangeRate: 7.2
      }
    })
    harness.emitAgent({ type: 'worktree', status: { agentId: 'live', lifecycle: 'active', merge: 'unavailable', discard: 'unavailable' } })
    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'done', runId: 'r-done', name: 'reviewer', task: '审核变更', state: 'failed', createdAt: 1, endedAt: 61_000,
        provider: 'openai', model: 'openai/gpt-5', cost: .5, costUnit: 'CNY', exchangeRate: 7.2
      }
    })
    harness.emitAgent({ type: 'worktree', status: { agentId: 'done', lifecycle: 'merged', merge: 'merged', discard: 'unavailable' } })

    await screen.findByText('secretary')
    expect(screen.getByText('anthropic')).toBeTruthy()
    expect(screen.getByText('claude-sonnet-4')).toBeTruthy()
    expect(screen.getByText('收尾')).toBeTruthy()
    expect(screen.getByText('卡住 42s')).toBeTruthy()
    expect(screen.getByText('wt')).toBeTruthy()
    expect(screen.getByText('已合并')).toBeTruthy()
    expect(screen.getByText('¥3.60 CNY')).toBeTruthy()
    expect(screen.getByText(/\$0\.55 USD/)).toBeTruthy()
    expect(screen.getByText(/×7\.20/)).toBeTruthy()
  })

  it('loads the snapshot tree and routes review worktree actions', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'root', runId: 'r1', name: 'builder', role: 'general-purpose', title: 'Build UI', task: 'build', state: 'ok', depth: 1, createdAt: 1 },
      { agentId: 'child', runId: 'r2', parentId: 'root', name: 'review', task: 'review', state: 'ok', depth: 2, createdAt: 2 }
    ]
    render(<SubagentPanel host={harness.host} retainedWorktreeDispositionAvailable />)
    await screen.findByText('Build UI')
	expect(screen.getByText('主管 · 1 个子 agent')).toBeTruthy()
	expect(screen.getByTestId('agent-row-child').classList.contains('agent-child')).toBe(true)
	expect(screen.getByLabelText('Leader 的子 agent')).toBeTruthy()
    harness.emitAgent({ type: 'worktree', status: { agentId: 'root', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })
    fireEvent.click(screen.getByText('Build UI'))
    await screen.findByText('合并到主分支')
    fireEvent.click(screen.getByText('合并到主分支'))
    await waitFor(() => expect(harness.mergeWorktree).toHaveBeenCalledWith('root'))
  })

  it('hides manual retained-worktree disposition when the host capability is false', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'root', runId: 'r1', name: 'builder', task: 'build', state: 'failed', createdAt: 1 }
    ]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByText('builder')
    harness.emitAgent({ type: 'worktree', status: { agentId: 'root', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })
    expect(screen.queryByText('合并到主分支')).toBeNull()
    expect(screen.queryByText('丢弃 worktree')).toBeNull()
  })

  it('renders thinking, tools, results, diffs, and final output through shared collapsed cards', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    const hiddenThought = `思考摘要 ${'x'.repeat(80)} EXPANDED_THINKING_BODY`
    harness.emitAgent({
      type: 'agent',
      agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running', finalResult: '最终输出内容' }
    })
    await screen.findByText('explore')
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: hiddenThought })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'edit', text: '{"path":"Electron/packages/ui/src/SubagentPanel.tsx"}' })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'toolResult', text: 'diff --git a/demo.ts b/demo.ts\n--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new' })

    const thinking = await screen.findByRole('button', { name: /Thinking/ })
    expect(thinking.closest('[data-activity-card="thinking"]')).toBeTruthy()
    expect(screen.queryByText(/EXPANDED_THINKING_BODY/)).toBeNull()
    fireEvent.click(thinking)
    await screen.findByText(/EXPANDED_THINKING_BODY/)
    expect(document.querySelector('[data-activity-card="tool"]')).toBeTruthy()
    expect(document.querySelector('[data-activity-card="diff"]')).toBeTruthy()
    expect(document.querySelector('[data-activity-card="final"]')).toBeTruthy()
  })

  it('upserts streamed log_delta snapshots into one row per contentIndex', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByText('explore')

    // Three cumulative snapshots of the same contentIndex must collapse into one row.
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '{"step":', contentIndex: 0 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '{"step": 1', contentIndex: 0 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '{"step": 1}', contentIndex: 0 })
    const rows = await screen.findAllByText('{"step": 1}')
    expect(rows).toHaveLength(1)
    expect(screen.queryByText('{"step":')).toBeNull()
    expect(screen.queryByText('{"step": 1')).toBeNull()

    // A different contentIndex opens a second row.
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'plan', contentIndex: 1 })
    await screen.findByText('plan')
    expect(screen.getByText('{"step": 1}')).toBeTruthy()

    // No contentIndex (legacy host / terminal log batch): plain append.
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'toolResult', text: 'done' })
    await screen.findByText('done')
    expect(screen.getByText('{"step": 1}')).toBeTruthy()
    expect(screen.getByText('plan')).toBeTruthy()
  })

  it('applies the prefix-replace fallback for hosts without contentIndex', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByText('explore')

    // Cumulative no-index snapshot extending the previous row replaces it…
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: 'first' })
    await screen.findByText('first')
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: 'first second' })
    await screen.findByText('first second')
    expect(screen.queryByText('first')).toBeNull()
    // …while a non-prefix entry appends a new row.
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: 'unrelated' })
    await screen.findByText('unrelated')
    expect(screen.getByText('first second')).toBeTruthy()
  })

  it('starts a fresh log row for a new run instead of rewriting the previous run row', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByText('explore')
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: 'run one', contentIndex: 0 })
    await screen.findByText('run one')

    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r2', name: 'explore', task: 'research', state: 'running' } })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: 'run two', contentIndex: 0 })
    await screen.findByText('run two')
    expect(screen.getByText('run one')).toBeTruthy()
    expect(screen.getByText('run two')).toBeTruthy()
  })

  it('keeps the newest fixed page and persists the dragged list/detail split', async () => {
    localStorage.setItem('pipiui:subagent-list-ratio', '0.48')
    const harness = hostHarness()
    const snapshot: AgentSummary[] = Array.from({ length: 31 }, (_, index) => ({
      agentId: `agent-${index}`, runId: `run-${index}`, name: `agent-${index}`, task: '分页', state: 'ok', createdAt: index
    }))
    harness.host.listAgents = async () => snapshot
    const first = render(<SubagentPanel host={harness.host} />)
    await screen.findByText('agent-30')
    expect(screen.queryByTestId('agent-row-agent-0')).toBeNull()
    expect(screen.getByText('最新第 1/2 页')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '较早' }))
    await screen.findByTestId('agent-row-agent-0')
    expect(screen.queryByTestId('agent-row-agent-30')).toBeNull()
    expect(screen.getByText('最新第 2/2 页')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '较新' }))
    await screen.findByTestId('agent-row-agent-30')

    const divider = screen.getByLabelText('调整 agent 列表高度')
    vi.spyOn(divider.parentElement!.parentElement!, 'getBoundingClientRect').mockReturnValue({ height: 400 } as DOMRect)
    fireEvent.pointerDown(divider, { clientY: 100 })
    fireEvent.pointerMove(window, { clientY: 140 })
    fireEvent.pointerUp(window)
    await waitFor(() => expect(Number(localStorage.getItem('pipiui:subagent-list-ratio'))).toBeCloseTo(.58))
    const savedRatio = localStorage.getItem('pipiui:subagent-list-ratio')!

    first.unmount()
    render(<SubagentPanel host={harness.host} />)
    await screen.findByText('agent-30')
    expect((document.querySelector('.subagent-split') as HTMLElement).style.gridTemplateRows).toContain(`${savedRatio}fr`)
  })

  it('only exposes the abort control for state=running', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'stalled', runId: 'r-stalled', name: 'stalled', task: 'waiting for host', state: 'stalled', createdAt: 1 }
    ]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-stalled')
    expect(screen.queryByLabelText('中止 stalled')).toBeNull()
  })

  it('shows a dismissible load error and recovers via retry re-running the loader', async () => {
    const harness = hostHarness()
    const listAgents = vi.fn()
      .mockRejectedValueOnce(new Error('mock list failure'))
      .mockResolvedValueOnce([{ agentId: 'recovered', runId: 'r-recovered', name: 'recovered', task: 'recovered', state: 'ok' }])
    harness.host.listAgents = listAgents
    render(<SubagentPanel host={harness.host} />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('mock list failure')
    expect(screen.getByText('未能加载 subagents')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(listAgents).toHaveBeenCalledTimes(2))
    expect(await screen.findByTestId('agent-row-recovered')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('falls back to the normal empty state after dismissing a load error', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => { throw new Error('mock list failure') }
    render(<SubagentPanel host={harness.host} />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
    expect(await screen.findByText('还没有 subagent')).toBeTruthy()
  })

  it('re-shows the same load error when a retry fails again', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => { throw new Error('mock list failure') }
    render(<SubagentPanel host={harness.host} />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('mock list failure')
    expect(await screen.findByText('未能加载 subagents')).toBeTruthy()
  })
})
