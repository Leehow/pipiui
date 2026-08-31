// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSummary, PipiHostAPI } from '@pipi/host-api'
import { agentDetailUsage, agentDisplayName, agentEventSupersedes, agentRunLineageSizeForTest, parseCloseoutSummary, resetAgentRunLineageForTest, resolveAgentStalled, SubagentPanel } from './SubagentPanel'

afterEach(() => {
  cleanup()
  document.querySelectorAll('.jsdom-header-slot').forEach(el => el.remove())
  localStorage.removeItem('pipiui:subagent-list-ratio')
  resetAgentRunLineageForTest()
})

function Fixture(props: ComponentProps<typeof SubagentPanel>) {
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  return <div className="jsdom-header-slot" ref={el => setSlot(el)}>{slot && <SubagentPanel {...props} headerSlot={slot} />}</div>
}
function renderSubagentPanel(props: ComponentProps<typeof SubagentPanel>) {
  return render(<Fixture {...props} />)
}

function hostHarness() {
  let agents: ((event: AgentEvent) => void) | undefined
  const logs = new Map<string, (event: Extract<AgentEvent, { type: 'agent_log' }>) => void>()
  // Canonical-host emulation: the real host always scopes agent rows to a session
  // and stamps log events with the emitting run's identity. The harness mirrors
  // that so fixtures stay terse; tests that deliberately need identity-less
  // events use emitRawAgent / pass explicit blanks through emitLog.
  const defaultSessionId = 'session-1'
  const lastAgentById = new Map<string, AgentSummary>()
  const abortAgent = vi.fn(async () => undefined)
  const resolveAgent = vi.fn(async (_sessionId: string, _agentId: string, _runId: string): Promise<void> => undefined)
  const checkAgent = vi.fn(async (sessionId: string, agentId: string, runId: string) => ({ agentId, runId: runId || 'checked', sessionId, name: 'explore', task: '', state: 'running' as const }))
  const mergeWorktree = vi.fn(async (_sessionId: string, agentId: string, _runId: string) => ({ agentId, lifecycle: 'merged' as const, merge: 'merged' as const, discard: 'unavailable' as const }))
  const discardWorktree = vi.fn(async (_sessionId: string, agentId: string, _runId: string) => ({ agentId, lifecycle: 'discarded' as const, merge: 'unavailable' as const, discard: 'discarded' as const }))
  const getAgentLogs = vi.fn(async () => [])
  const host = {
    protocolVersion: 2,
    listAgents: async () => [],
    getAgentLogs,
    subscribeAgents: (listener: (event: AgentEvent) => void) => { agents = listener; return () => undefined },
    subscribeAgentLog: (id: string, listener: (event: Extract<AgentEvent, { type: 'agent_log' }>) => void) => { logs.set(id, listener); return () => logs.delete(id) },
    abortAgent,
    resolveAgent,
    checkAgent,
    mergeWorktree,
    discardWorktree
  } as unknown as PipiHostAPI
  return {
    host,
    abortAgent,
    resolveAgent,
    checkAgent,
    mergeWorktree,
    discardWorktree,
    getAgentLogs,
    hasLogSubscriber: (id: string) => logs.has(id),
    emitAgent: (event: AgentEvent) => {
      if (event.type === 'agent') {
        lastAgentById.set(event.agent.agentId, event.agent)
        // Canonical hosts always scope rows to a session; a fixture without one
        // gets the harness default rather than an identity-less row.
        if (event.agent.sessionId === undefined)
          return agents?.({ type: 'agent', agent: { ...event.agent, sessionId: defaultSessionId } })
      }
      agents?.(event)
    },
    /** Deliberately un-enriched emission: exactly the event given, for strictness tests. */
    emitRawAgent: (event: AgentEvent) => agents?.(event),
    /** Deliberately un-enriched log delivery: exactly the event given, identity-less stays identity-less. */
    emitRawLog: (id: string, event: Extract<AgentEvent, { type: 'agent_log' }>) => logs.get(id)?.(event),
    emitLog: (id: string, event: Extract<AgentEvent, { type: 'agent_log' }>) => {
      const last = lastAgentById.get(id)
      const enriched = last && event.sessionId === undefined && event.runId === undefined
        ? { ...event, sessionId: last.sessionId ?? defaultSessionId, runId: last.runId }
        : event
      logs.get(id)?.(enriched)
    }
  }
}

function expandTranscriptCards() {
  for (let pass = 0; pass < 4; pass += 1) {
    const collapsed = screen.queryAllByRole('button').filter(button => button.getAttribute('aria-expanded') === 'false' && button.closest('[data-activity-card]'))
    if (!collapsed.length) break
    collapsed.forEach(button => fireEvent.click(button))
  }
}

describe('agentDetailUsage', () => {
  it('formats used/window, cache hit rate, and in/out tokens', () => {
    expect(agentDetailUsage({
      contextTokens: 38_200, contextWindowTokens: 200_000,
      inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900,
    })).toEqual({ context: '38k/200k', cache: '42%', io: '12k / 2.1k' })
  })

  it('shows a known window without occupancy as ?/window', () => {
    expect(agentDetailUsage({ contextWindowTokens: 200_000 })).toEqual({ context: '?/200k' })
  })

  it('returns empty facts when the agent has no usage', () => {
    expect(agentDetailUsage({})).toEqual({})
  })
})

describe('resolveAgentStalled', () => {
  it('drops the stall flag on every terminal state', () => {
    for (const state of ['ok', 'failed', 'aborted', 'interrupted'] as const) {
      expect(resolveAgentStalled(state, true)).toBe(false)
    }
  })

  it('clears an inherited stall on running progress and re-flags only a fresh stall', () => {
    expect(resolveAgentStalled('running', false)).toBe(false)
    expect(resolveAgentStalled('running', true)).toBe(true)
    expect(resolveAgentStalled('stalled', false)).toBe(true)
  })
})

describe('agentEventSupersedes', () => {
  it('never downgrades a same-run terminal verdict', () => {
    const previous = { state: 'ok' as const, runId: 'r1', createdAt: 1_000 }
    expect(agentEventSupersedes(previous, { state: 'running', runId: 'r1', createdAt: 2_000 })).toBe(false)
    expect(agentEventSupersedes(previous, { state: 'stalled', runId: 'r1', createdAt: 2_000 })).toBe(false)
    // Terminal→terminal refresh (closeout/handled, a later verdict) still lands.
    expect(agentEventSupersedes(previous, { state: 'ok', runId: 'r1', createdAt: 2_000 })).toBe(true)
  })

  it('keeps same-run progress paths open', () => {
    const live = { state: 'running' as const, runId: 'r1', createdAt: 1_000 }
    expect(agentEventSupersedes(live, { state: 'stalled', runId: 'r1', createdAt: 2_000 })).toBe(true)
    expect(agentEventSupersedes({ ...live, state: 'stalled' }, { state: 'running', runId: 'r1', createdAt: 2_000 })).toBe(true)
    expect(agentEventSupersedes(live, { state: 'ok', runId: 'r1', createdAt: 2_000 })).toBe(true)
  })

  it('merges different runs never: rows are per-episode, ordering is display-only', () => {
    const displayed = { state: 'ok' as const, runId: 'r1', createdAt: 1_000 }
    // A different run is simply another row — it never merges into this one,
    // regardless of which timestamp is newer or which source delivers it.
    for (const incoming of [
      { state: 'running' as const, runId: 'r2', createdAt: 5_000 },
      { state: 'running' as const, runId: 'r0', createdAt: 500 },
      { state: 'ok' as const, runId: 'r2' },
    ]) {
      expect(agentEventSupersedes(displayed, incoming)).toBe(false)
      expect(agentEventSupersedes(incoming, displayed)).toBe(false)
    }
    // Same run id but no timestamps still follows the terminal-stickiness rule.
    expect(agentEventSupersedes({ ...displayed }, { state: 'ok', runId: 'r1' })).toBe(true)
  })
})

describe('SubagentPanel', () => {

  it('opens a Markdown reference against the selected agent worktree before the project path', async () => {
    const harness = hostHarness()
    const onOpenDocument = vi.fn()
    render(<SubagentPanel host={harness.host} projectPath="/projects/main" onOpenDocument={onOpenDocument} />)
    await screen.findByText('还没有 subagent')

    harness.emitAgent({ type: 'agent', agent: { agentId: 'docs', runId: 'docs-run', sessionId: 'session-1', name: 'reviewer', task: 'write docs', state: 'ok', createdAt: 1, finalResult: 'Result: [report](docs/report.md)' } })
    harness.emitAgent({ type: 'worktree', status: { agentId: 'docs', sessionId: 'session-1', runId: 'docs-run', path: '/worktrees/docs', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })

    const card = await screen.findByRole('button', { name: '打开文档 report.md' })
    expect(card.textContent).toContain('/worktrees/docs/docs/report.md')
    fireEvent.click(card)
    expect(onOpenDocument).toHaveBeenCalledWith('/worktrees/docs/docs/report.md')
  })

  it('links a selected agent to details, renders duration/cost, and marks a failed agent handled', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'runner', runId: 'r-runner', sessionId: 'session-1', name: 'runner', task: 'keep working', state: 'running', createdAt: Date.now() },
      { agentId: 'failed', runId: 'r-failed', sessionId: 'session-1', name: 'failed', title: 'Failed detail', listSubtitle: 'failed row subtitle', task: 'inspect this failure', state: 'failed', createdAt: Date.now() - 120_000, endedAt: Date.now() - 59_000, cost: 1, costUnit: 'CNY', exchangeRate: 7.2, finalResult: 'failed-only result' }
    ]
    render(<SubagentPanel host={harness.host} />)

    const failedRow = await screen.findByTestId('agent-row-failed')
    const runnerRow = screen.getByTestId('agent-row-runner')
    await waitFor(() => expect(runnerRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))
    fireEvent.click(failedRow.querySelector('.agent-select')!)
    await waitFor(() => expect(failedRow.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))
    expect(document.querySelector('.detail-agent-title b')?.textContent).toBe('Failed detail')
    expect(screen.getByText('inspect this failure')).toBeTruthy()
    expect(screen.getByText('failed-only result')).toBeTruthy()
    expect(screen.getByText('¥7.20 CNY')).toBeTruthy()
    expect(screen.getAllByText(/61s/).length).toBeGreaterThan(0)
    expect(screen.getByLabelText('中止 runner')).toBeTruthy()
    expect(screen.queryByLabelText('中止 failed')).toBeNull()

    const resolve = screen.getByLabelText('标记 failed 已处理')
    fireEvent.mouseEnter(failedRow)
    resolve.focus()
    expect(document.activeElement).toBe(resolve)
    fireEvent.click(resolve)
    await waitFor(() => expect(harness.resolveAgent).toHaveBeenCalledWith('session-1', 'failed', 'r-failed'))
    await waitFor(() => expect(screen.queryByLabelText('标记 failed 已处理')).toBeNull())
  })

  it('explains a pre-spawn worktree failure in Chinese above the raw stderr', async () => {
    const harness = hostHarness()
    const reason = 'git worktree add failed; refusing shared-cwd fallback'
    render(<SubagentPanel host={harness.host} projectPath="/projects/main" />)
    await screen.findByText('还没有 subagent')

    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'iso', runId: 'r-iso', name: 'builder', task: '改布局', state: 'failed', createdAt: Date.now() - 60_000, endedAt: Date.now(),
        finalResult: `Writable subagent isolation failed before spawn: ${reason}`, worktreeError: reason
      }
    })
    const row = await screen.findByTestId('agent-row-iso')
    fireEvent.click(row.querySelector('.agent-select')!)

    expect(await screen.findByText('工人没有启动，这次任务也没有自动交回主管。当前 Git 仓库无法建立隔离工作区。未使用 Git 的文件夹不会建隔离工作区，工人会直接在项目目录运行。请查看技术详情后重试。')).toBeTruthy()
    expect(screen.getByText(`Writable subagent isolation failed before spawn: ${reason}`)).toBeTruthy()
  })

  it('shows a Chinese title in the list instead of a long English task', async () => {
    const harness = hostHarness()
    const longTask = 'Investigate why Electron PipiUI cannot use openai-codex Grok models for the right-rail subagent list title'
    harness.host.listAgents = async () => [{
      agentId: 'titled', runId: 'r-titled', name: 'explore', title: '核对思考档与隐藏模型', task: longTask, state: 'ok', createdAt: 1
    }]
    render(<SubagentPanel host={harness.host} />)

    const row = await screen.findByTestId('agent-row-titled')
    expect(row.querySelector('small')?.textContent).toBe('核对思考档与隐藏模型')
    expect(row.textContent).not.toContain(longTask)
    expect(row.textContent).not.toContain('Investigate why Electron PipiUI')
    expect(document.querySelector('.detail-agent-title b')?.textContent).toBe('核对思考档与隐藏模型')
  })

  it('derives a short list label from a long untitled task instead of dumping the brief', async () => {
    const harness = hostHarness()
    const longTask = 'Read-only. Repo: /Users/haoli/leehow/code/pipiui. Investigate why Electron PipiUI cannot use openai-codex Grok models and report the root cause with files and commands.'
    harness.host.listAgents = async () => [{
      agentId: 'untitled', runId: 'r-untitled', name: 'explore', title: '', task: longTask, state: 'ok', createdAt: 1
    }]
    render(<SubagentPanel host={harness.host} />)

    const row = await screen.findByTestId('agent-row-untitled')
    const label = row.querySelector('small')?.textContent ?? ''
    expect(label.startsWith('Read-only.')).toBe(true)
    expect(label.length).toBeLessThanOrEqual(41)
    expect(label).toContain('…')
    expect(row.textContent).not.toContain('/Users/haoli/leehow/code/pipiui')
    expect(row.textContent).not.toContain(longTask)
    expect(document.querySelector('.detail-agent-title b')?.textContent).toBe(label)
  })

  it('prefers an English title over a Chinese task in the list', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'en-title', runId: 'r-en', name: 'reviewer', title: 'Check hidden models', task: '核对思考档与隐藏模型的完整任务说明',
      state: 'ok', createdAt: 1
    }]
    render(<SubagentPanel host={harness.host} />)

    const row = await screen.findByTestId('agent-row-en-title')
    expect(row.querySelector('small')?.textContent).toBe('Check hidden models')
    expect(row.textContent).not.toContain('核对思考档与隐藏模型的完整任务说明')
    expect(document.querySelector('.detail-agent-title b')?.textContent).toBe('Check hidden models')
  })

  it('shows the actionable empty state after an empty snapshot', async () => {
    const harness = hostHarness()
    renderSubagentPanel({ host: harness.host })

    expect(await screen.findByText('还没有 subagent')).toBeTruthy()
    expect(screen.getByText('0 个')).toBeTruthy()
    expect(screen.queryByTestId('agent-row-any')).toBeNull()
  })

  it('shows only the selected session while restoring that session from the durable index', async () => {
    const harness = hostHarness()
    const ownerAgent = { agentId: 'electron-ui-acceptance', runId: 'r1', name: 'general-purpose', task: '验证 Electron UI', listSubtitle: 'bash {"command":"npm test"}', state: 'ok' as const, sessionId: 'owner-session', createdAt: 1 }
    const listAgents = vi.fn(async (sessionId?: string) => sessionId === 'owner-session' ? [ownerAgent] : [])
    harness.host.listAgents = listAgents
    const view = render(<Fixture host={harness.host} sessionId="selected-other" />)
    expect(await screen.findByText('还没有 subagent')).toBeTruthy()
    expect(screen.queryByTestId('agent-row-electron-ui-acceptance')).toBeNull()
    expect(listAgents).toHaveBeenLastCalledWith('selected-other', 'history')

    view.rerender(<Fixture host={harness.host} sessionId="owner-session" />)
    const row = await screen.findByTestId('agent-row-electron-ui-acceptance')
    expect(row.querySelector('strong')?.textContent).toBe('general-purpose')
    expect(row.textContent).not.toContain('electron-ui-acceptance')
    expect(row.textContent).toContain('验证 Electron UI')
    expect(row.textContent).not.toContain('通用')
    expect(row.textContent).not.toContain('owner-session')
    fireEvent.click(row.querySelector('.agent-select')!)
    expect(document.querySelector('.agent-technical-details')?.textContent).toContain('通用')
    expect(document.querySelector('.agent-technical-details')?.textContent).toContain('owner-session')
    expect(listAgents).toHaveBeenLastCalledWith('owner-session', 'history')

    view.rerender(<Fixture host={harness.host} sessionId="another-current-session" />)
    await waitFor(() => expect(screen.queryByTestId('agent-row-electron-ui-acceptance')).toBeNull())
    expect(await screen.findByText('还没有 subagent')).toBeTruthy()
    expect(screen.getByText('0 个')).toBeTruthy()
    expect(listAgents).toHaveBeenLastCalledWith('another-current-session', 'history')
  })

  it('ignores a stale snapshot and streamed events from the previous session', async () => {
    const harness = hostHarness()
    let resolveOld!: (agents: AgentSummary[]) => void
    const oldSnapshot = new Promise<AgentSummary[]>(resolve => { resolveOld = resolve })
    harness.host.listAgents = vi.fn(async (sessionId?: string) => sessionId === 'old-session' ? oldSnapshot : [])
    const view = render(<Fixture host={harness.host} sessionId="old-session" />)

    view.rerender(<Fixture host={harness.host} sessionId="new-session" />)
    expect(await screen.findByText('还没有 subagent')).toBeTruthy()
    harness.emitAgent({ type: 'agent', agent: { agentId: 'old-live', runId: 'old-run', name: 'explore', task: '旧会话任务', state: 'running', sessionId: 'old-session' } })
    expect(screen.queryByTestId('agent-row-old-live')).toBeNull()

    resolveOld([{ agentId: 'old-durable', runId: 'old-durable-run', name: 'reviewer', task: '旧快照', state: 'ok', sessionId: 'old-session' }])
    await Promise.resolve()
    await Promise.resolve()
    expect(screen.queryByTestId('agent-row-old-durable')).toBeNull()
    expect(screen.getByText('0 个')).toBeTruthy()
  })

  it('localizes known generic task and activity labels while preserving raw legacy roles and tool details', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'fixture', runId: 'r1', sessionId: 'session-1', name: 'builder', task: 'Build fixture', state: 'ok', createdAt: 1 },
      { agentId: 'round-two', runId: 'r2', sessionId: 'session-1', name: 'explore', task: 'same-task round 2', state: 'ok', createdAt: 2 },
      { agentId: 'profile', runId: 'r3', sessionId: 'session-1', name: 'general-purpose', task: 'profile-first-ok', state: 'ok', createdAt: 3 },
      { agentId: 'leader', runId: 'r4', sessionId: 'session-1', name: 'computer-use-leader', task: 'Computer Use Leader', state: 'ok', createdAt: 4 },
      { agentId: 'tools', runId: 'r5', sessionId: 'session-1', name: 'computer-terminal', task: 'terminal_file_status {"path":"/tmp/raw fixture.txt"}', state: 'running', createdAt: 5 }
    ]
    render(<SubagentPanel host={harness.host} />)

    expect(await screen.findByText('构建测试夹具')).toBeTruthy()
    expect(screen.getByText('同一任务第 2 轮')).toBeTruthy()
    expect(screen.getByText('优先恢复配置验证成功')).toBeTruthy()
    expect(screen.getByText('Computer Use Leader')).toBeTruthy()
    expect(screen.getAllByText('查看文件状态 · /tmp/raw fixture.txt').length).toBeGreaterThan(0)
    expect(screen.queryByText('构建')).toBeNull()
    expect(screen.queryByText('探索')).toBeNull()

    await waitFor(() => expect(harness.hasLogSubscriber('tools')).toBe(true))
    harness.emitLog('tools', { type: 'agent_log', sessionId: 'session-1', agentId: 'tools', runId: 'r5', itemType: 'tool', name: 'terminal_read_file', text: '{"path":"/tmp/raw fixture.txt","line_start":2}' })
    harness.emitLog('tools', { type: 'agent_log', sessionId: 'session-1', agentId: 'tools', runId: 'r5', itemType: 'toolResult', name: 'terminal_read_file', text: '{"path":"/tmp/raw fixture.txt","line_start":2}' })
    fireEvent.click(await screen.findByRole('button', { name: /个步骤/ }))
    const tool = await screen.findByRole('button', { name: /^terminal_read_file/ })
    expect(tool.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(tool)
    expect(await screen.findByText(/"line_start": 2/)).toBeTruthy()
  })

  it('keeps the list compact and moves exact model, provider, profile, and session metadata into details', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'electron-ui-acceptance', runId: 'r1', name: 'reviewer', task: '验证中文列表', state: 'ok', createdAt: 1,
      provider: 'jellytoken', model: 'volcengine/deepseek-v4-flash', sessionId: 'session-exact-123'
    }]
    render(<SubagentPanel host={harness.host} />)

    const row = await screen.findByTestId('agent-row-electron-ui-acceptance')
    expect(row.textContent).not.toContain('jellytoken')
    expect(row.textContent).not.toContain('volcengine')
    expect(row.textContent).not.toContain('deepseek-v4-flash')
    expect(row.textContent).not.toContain('session-exact-123')
    expect(row.textContent).not.toContain('审查')
    expect(row.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('DeepSeek 模型')

    fireEvent.click(row.querySelector('.agent-select')!)
    const detail = document.querySelector('.agent-detail')!
    expect(detail.querySelector('.detail-agent-title small')?.textContent).toBe('DeepSeek · deepseek-v4-flash')
    expect(detail.textContent).toContain('jellytoken')
    expect(detail.textContent).toContain('volcengine/deepseek-v4-flash')
    expect(detail.textContent).toContain('session-exact-123')
    expect(detail.textContent).toContain('审查')
  })

  it('retains the provider family label when old agent data has no model reference', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'legacy', runId: 'r-legacy', name: 'general-purpose', task: '旧任务', state: 'ok', createdAt: 1, provider: 'openai'
    }]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-legacy')
    expect(document.querySelector('.detail-agent-title small')?.textContent).toBe('GPT')
  })

  it('keeps unknown free text unchanged and gives Chinese labels to common tools', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'memory', runId: 'r1', name: 'reviewer', task: 'memory_query {"query":"subagent reuse"}', state: 'ok', createdAt: 1 },
      { agentId: 'shell', runId: 'r2', name: 'operator', task: 'bash {"command":"pwd"}', state: 'ok', createdAt: 2 },
      { agentId: 'unknown', runId: 'r3', name: 'custom-profile', task: 'Investigate the unusual frobnicator', state: 'ok', createdAt: 3 }
    ]
    render(<SubagentPanel host={harness.host} />)

    expect(await screen.findByText(/查询记忆/)).toBeTruthy()
    expect(screen.getByText('运行命令 · pwd')).toBeTruthy()
    expect(screen.getAllByText('Investigate the unusual frobnicator').length).toBeGreaterThan(0)
    expect(screen.getByTestId('agent-row-shell').textContent).not.toContain('操作')
    expect(screen.getByTestId('agent-row-unknown').querySelector('strong')?.textContent).toBe('custom-profile')
  })

  it('removes the internal isolation sentinel from details and logs', async () => {
    const harness = hostHarness()
    const leaked = '[PipiUI subagent isolation sentinel: skip\nThis sentinel is not a skill instruction; internal only.]'
    harness.host.listAgents = async () => [{ agentId: 'safe', runId: 'r1', name: 'builder', task: `${leaked}\n用户任务`, state: 'ok', finalResult: `${leaked}\n完成`, createdAt: 1 }]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByText('用户任务')
    expect(document.body.textContent).not.toContain('isolation sentinel')
    expect(document.querySelector('[data-testid="subagent-transcript"]')?.textContent).toContain('完成')
  })

  it('shows live elapsed time on the running name line instead of a fourth row stuck at 0s', async () => {
    vi.useFakeTimers({ now: 1_700_000_000_000, toFake: ['Date', 'setInterval', 'clearInterval'] })
    try {
      const harness = hostHarness()
      const startedAt = Date.now() - 12_000
      harness.host.listAgents = async () => [{
        agentId: 'run', runId: 'r1', name: 'explore', title: '查 Electron GLM 鉴权与 MCP 链路',
        // Canonical hosts scope every row to a session (episode triple): without
        // it the stamped incoming event below would adopt a NEW identity mid-flight
        // and remount the row instead of updating it in place.
        sessionId: 'session-1',
        task: 'research', state: 'running', createdAt: startedAt, updatedAt: Date.now(),
        listSubtitle: 'tool', activityActive: true,
      }]
      render(<SubagentPanel host={harness.host} />)
      const row = await screen.findByTestId('agent-row-run')
      expect(row.querySelector('.agent-name-line .agent-row-time')?.textContent).toBe('12s')
      expect(row.querySelectorAll('.agent-copy > small').length).toBe(2)
      expect(row.textContent).toContain('最近活动 · tool')

      act(() => {
        harness.emitAgent({
          type: 'agent',
          agent: {
            agentId: 'run', runId: 'r1', name: 'explore', title: '查 Electron GLM 鉴权与 MCP 链路',
            task: 'research', state: 'running', createdAt: Date.now(), updatedAt: Date.now(),
            listSubtitle: 'tool read', activityActive: true,
          },
        })
        vi.advanceTimersByTime(3_000)
      })
      expect(row.querySelector('.agent-name-line .agent-row-time')?.textContent).toBe('15s')
      expect(row.querySelectorAll('.agent-copy > small').length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('renders lifecycle counts and routes abort to the host', async () => {
    const harness = hostHarness()
    renderSubagentPanel({ host: harness.host })
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running', cost: .2 } })
    harness.emitAgent({ type: 'agent', agent: { agentId: 'bad', runId: 'r2', name: 'review', task: 'verify', state: 'failed', cost: .1 } })
    await screen.findByText('2 个')
    expect(screen.getByText('1 运行中')).toBeTruthy()
    expect(screen.getByText('1 失败')).toBeTruthy()
    const runningBadge = screen.getByTestId('subagent-running-badge')
    expect(runningBadge.closest('.subagent-header-right')).toBeTruthy()
    expect(runningBadge.closest('.subagent-header-left')).toBeNull()
    fireEvent.click(screen.getByLabelText('中止 explore'))
    await waitFor(() => expect(harness.abortAgent).toHaveBeenCalledWith('session-1', 'run', 'r1'))
  })

  it('hides rows explicitly marked as test fixtures behind the collapsed 历史 group', async () => {
    const harness = hostHarness()
    const dayAgo = Date.now() - 36 * 60 * 60 * 1000
    harness.host.listAgents = async () => [
      { agentId: 'blocker', runId: 'r-blocker', sessionId: 'session-1', name: 'blocker', task: 'keep blocker busy', state: 'ok', testFixture: true, createdAt: dayAgo, endedAt: dayAgo },
      { agentId: 'fresh', runId: 'r-fresh', sessionId: 'session-1', name: 'explore', task: '审计 fallback 路径', state: 'running', createdAt: Date.now() }
    ]
    renderSubagentPanel({ host: harness.host })

    expect(await screen.findByTestId('agent-row-fresh')).toBeTruthy()
    expect(screen.queryByTestId('agent-row-blocker')).toBeNull()
    expect(screen.getByTestId('subagent-archive-toggle').textContent).toContain('历史')
    expect(screen.getByTestId('subagent-archive-toggle').textContent).toContain('1')
  })

  it('never folds a running worker into 历史 even when its snapshot carries an old endedAt', async () => {
    const harness = hostHarness()
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000
    // Screenshot repro: 历史（2）held a live general-purpose row (“0 秒前有新进展”)
    // and an explore that finished 398s ago. Neither may fold.
    harness.host.listAgents = async () => [
      { agentId: 'live-runner', runId: 'r-live', sessionId: 'session-1', name: 'worker', task: '持续修复徽标样式', state: 'running', role: 'general-purpose', createdAt: twoDaysAgo, endedAt: twoDaysAgo },
      { agentId: 'just-done', runId: 'r-done', sessionId: 'session-1', name: 'explore', task: '调查记录消失根因', state: 'ok', createdAt: Date.now() - 400_000, endedAt: Date.now() - 398_000 }
    ]
    renderSubagentPanel({ host: harness.host })

    expect(await screen.findByTestId('agent-row-live-runner')).toBeTruthy()
    expect(screen.getByTestId('agent-row-just-done')).toBeTruthy()
    expect(screen.queryByTestId('subagent-archive')).toBeNull()
  })

  it('keeps a terminal row without a timestamp visible instead of folding it into 历史', async () => {
    const harness = hostHarness()
    // Undated means unknown, not ancient: missing endedAt must stay inline.
    harness.host.listAgents = async () => [
      { agentId: 'undated', runId: 'r-undated', sessionId: 'session-1', name: 'explore', task: '无结束时间的完成行', state: 'ok', createdAt: Date.now() - 60_000 }
    ]
    renderSubagentPanel({ host: harness.host })

    expect(await screen.findByTestId('agent-row-undated')).toBeTruthy()
    expect(screen.queryByTestId('subagent-archive')).toBeNull()
  })

  it('never hides a real episode just because its task text contains the old [seam: marker', async () => {
    const harness = hostHarness()
    renderSubagentPanel({ host: harness.host })
    // Production text heuristics are gone: only the explicit testFixture flag folds a row.
    harness.emitAgent({ type: 'agent', agent: { agentId: 'real-task', runId: 'r-real', sessionId: 'session-1', name: 'explore', task: '[seam: cone-hold] 记录真实任务的说明', state: 'running', createdAt: Date.now() } })

    const row = await screen.findByTestId('agent-row-real-task')
    expect(row.textContent).toContain('记录真实任务的说明')
    expect(screen.queryByTestId('subagent-archive-toggle')).toBeNull()
  })

  it('reveals flagged fixtures and stale terminal rows after expanding 历史, keeping row controls', async () => {
    const harness = hostHarness()
    const dayAgo = Date.now() - 36 * 60 * 60 * 1000
    harness.host.listAgents = async () => [
      { agentId: 'blocker', runId: 'r-blocker', sessionId: 'session-1', name: 'blocker', task: 'keep blocker busy', state: 'aborted', testFixture: true, createdAt: dayAgo, endedAt: dayAgo },
      { agentId: 'qfix', runId: 'r-qfix', sessionId: 'session-1', name: 'fixer', task: '修复 quota 徽标样式', state: 'failed', createdAt: dayAgo, endedAt: dayAgo },
      { agentId: 'cutoff-ok', runId: 'r-edge', sessionId: 'session-1', name: 'explore', task: '24 小时内完成', state: 'ok', createdAt: Date.now() - 20 * 60 * 60 * 1000, endedAt: Date.now() - 20 * 60 * 60 * 1000 }
    ]
    renderSubagentPanel({ host: harness.host })

    const toggle = await screen.findByTestId('subagent-archive-toggle')
    expect(toggle.textContent).toContain('2')
    fireEvent.click(toggle)

    expect(screen.getByTestId('agent-row-blocker')).toBeTruthy()
    expect(screen.getByTestId('agent-row-qfix')).toBeTruthy()
    // A settled-but-recent row stays inline; only long-settled rows fold away.
    expect(screen.getByTestId('agent-row-cutoff-ok')).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByLabelText('标记 fixer 已处理')).toBeTruthy()
  })

  it('shows live tokens on a running row and totals them on the header badge', async () => {
    const harness = hostHarness()
    renderSubagentPanel({ host: harness.host })
    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running',
        inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900,
      },
    })
    harness.emitAgent({
      type: 'agent',
      agent: { agentId: 'done', runId: 'r2', sessionId: 'session-1', name: 'review', task: 'verify', state: 'ok', inputTokens: 4_000, outputTokens: 800 },
    })
    await screen.findByTestId('agent-row-run')
    expect(screen.getByTestId('agent-row-tokens-run').textContent).toBe('23k')
    expect(screen.queryByTestId('agent-row-tokens-done')).toBeNull()
    const badge = screen.getByTestId('subagent-running-badge')
    expect(badge.textContent).toBe('1 运行中 · 23k')
    expect(badge.closest('.subagent-header-right')).toBeTruthy()
    expect(screen.getByText('1 运行中', { exact: false })).toBeTruthy()
  })

  it('shows a pending stop state until the real terminal event arrives', async () => {
    const harness = hostHarness()
    let finishAbort!: () => void
    harness.host.abortAgent = vi.fn(() => new Promise<void>(resolve => { finishAbort = resolve }))
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })

    fireEvent.click(await screen.findByLabelText('中止 explore'))
    expect((await screen.findByLabelText('正在中止 explore') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '正在停止' }) as HTMLButtonElement).disabled).toBe(true)
    finishAbort()
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'aborted', endedAt: Date.now() } })
    await waitFor(() => expect(screen.queryByLabelText('正在中止 explore')).toBeNull())
    expect(screen.getByText('已中止')).toBeTruthy()
  })

  it('keeps a 45-second quiet Computer Worker neutral instead of calling it stuck or claiming its tool is pending', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'quiet-operator', runId: 'r-quiet', name: 'operator', task: '在 TextEdit 中打开文件', activityActive: true,
      state: 'running', createdAt: now - 60_000, updatedAt: now - 45_000,
      deadlineAt: now + 105_000, listSubtitle: 'desktop_act {"actions":[{"type":"key","keys":["CMD","O"]}]}'
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-quiet-operator')
    expect(screen.getAllByText(/暂无新状态 · 最近活动 · desktop_act/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/45 秒无新进展/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/105 秒后自动中止/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/等待工具返回/)).toBeNull()
    expect(screen.queryByText(/可能卡住/)).toBeNull()
  })

  it('only calls a quiet running agent possibly stuck after 120 seconds', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'stale-operator', runId: 'r-stale', name: 'operator', task: '在 TextEdit 中打开文件', activityActive: true,
      state: 'running', createdAt: now - 150_000, updatedAt: now - 120_000,
      deadlineAt: now + 30_000, listSubtitle: 'desktop_act {"actions":[{"type":"key","keys":["CMD","O"]}]}'
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-stale-operator')
    expect(screen.getAllByText(/界面暂无新事件 · 最近活动 · desktop_act/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/120 秒无新进展/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/30 秒后自动中止/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/可能卡住/)).toBeNull()
  })

  it('shows stall diagnostics in technical details without calling a live tool stuck', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'probe', runId: 'r-probe', name: 'general-purpose', task: 'fast-app', activityActive: true,
      state: 'running', createdAt: now - 150_000, updatedAt: now - 120_000,
      listSubtitle: 'bash ~/.codex/skills/pipiui-electron-build/scripts/pipiui-electron-build fast-app',
      diagnostics: {
        eventSeq: 12,
        processGeneration: '77:1',
        hostGeneration: '77:1',
        generationMatch: true,
        toolWaitName: 'bash',
        cpuVerdict: 'working',
        lastCpuDeltaMs: 1800,
        watchdogDecision: 'cpu-progress',
        hostReceivedAt: now - 5_000,
      }
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-probe')
    expect(screen.getAllByText(/工具仍在推进/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/可能卡住/)).toBeNull()
    fireEvent.click(screen.getByText('技术详情'))
    expect(screen.getByTestId('agent-stall-conclusion').textContent).toContain('尚未构成真实卡死')
    expect(screen.getByTestId('agent-stall-diagnostics').textContent).toContain('事件序号：12')
  })

  it('does not keep showing progress after the last probe snapshot is stale', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'stale-probe', runId: 'r-stale-probe', name: 'general-purpose', task: 'fast-app', activityActive: true,
      state: 'running', createdAt: now - 150_000, updatedAt: now - 120_000,
      listSubtitle: 'bash pack',
      diagnostics: {
        eventSeq: 12,
        generationMatch: true,
        cpuVerdict: 'working',
        watchdogDecision: 'cpu-progress',
        hostReceivedAt: now - 90_000,
      }
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-stale-probe')
    expect(screen.getAllByText(/事件链路无新序号/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/工具仍在推进/)).toBeNull()
  })

  it('does not call a quiet-not-stalled tool still advancing', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'quiet-tool', runId: 'r-quiet-tool', name: 'general-purpose', task: 'fast-app', activityActive: true,
      state: 'running', createdAt: now - 150_000, updatedAt: now - 120_000,
      listSubtitle: 'bash pack',
      diagnostics: {
        eventSeq: 4,
        generationMatch: true,
        watchdogDecision: 'tool-quiet-alive',
        hostReceivedAt: now - 5_000,
      }
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-quiet-tool')
    expect(screen.getAllByText(/工具静默未过门槛/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/工具仍在推进/)).toBeNull()
  })

  it('uses tool-result logs to distinguish provider waiting from sticky tool activity', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'returned-tool', runId: 'r-returned', name: 'explore', task: '检查事件日志',
      state: 'running', createdAt: now - 60_000, updatedAt: now - 45_000,
      listSubtitle: 'grep ./heartbeat/agent_events.jsonl', activityActive: false, activityEndedAt: now - 46_000
    } as AgentSummary]
    harness.host.getAgentLogs = vi.fn(async () => [
      { itemType: 'tool' as const, name: 'grep', text: './heartbeat/agent_events.jsonl' },
      { itemType: 'toolResult' as const, name: 'grep', text: 'matching event' }
    ])
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-returned-tool')
    await waitFor(() => expect(screen.getAllByText(/等待模型响应/).length).toBeGreaterThan(0))
    expect(screen.queryByText(/最近活动 · grep/)).toBeNull()
    expect(screen.queryByText(/等待工具返回/)).toBeNull()
  })

  it('shows the remaining overlapping tool after git diff would have ended first', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'overlap', runId: 'r-overlap', name: 'explore', task: 'inspect',
      state: 'running', createdAt: now - 20_000, updatedAt: now - 5_000,
      listSubtitle: 'read b.ts', activityActive: true, activityToolCallId: 'tc-read',
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    const row = await screen.findByTestId('agent-row-overlap')
    expect(row.textContent).toContain('最近活动 · read')
    expect(row.textContent).not.toContain('git diff')
  })

  it('stops showing a finished git diff as the live activity', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'diff-done', runId: 'r-diff', name: 'explore', title: '查 activity 投影',
      task: 'inspect', state: 'running', createdAt: now - 20_000, updatedAt: now - 5_000,
      listSubtitle: 'bash git diff HEAD -- Electron/packages/pi-backend/src/index.ts',
      activityActive: false, activityEndedAt: now - 4_000,
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    const row = await screen.findByTestId('agent-row-diff-done')
    expect(row.textContent).toContain('等待模型响应')
    expect(row.textContent).not.toContain('最近活动 · bash')
    expect(row.textContent).not.toContain('git diff HEAD')
    fireEvent.click(screen.getByText('技术详情'))
    expect(screen.getByText(/上一工具已结束于/).textContent).toMatch(/上一工具已结束于/)
  })

  it('shows a quiet Leader as coordinating while one of its children is still active', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'leader', runId: 'leader-run', name: 'computer-use-leader', task: 'coordinate workers',
      state: 'running', createdAt: now - 60_000, updatedAt: now - 45_000, deadlineAt: now + 75_000
    }, {
      agentId: 'operator', runId: 'operator-run', parentId: 'leader', name: 'operator', task: 'open the file',
      state: 'running', createdAt: now - 20_000, updatedAt: now - 5_000, deadlineAt: now + 130_000,
      listSubtitle: 'desktop_act {"actions":[{"type":"key","keys":["CMD","O"]}]}'
    }] as AgentSummary[]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-leader')
    expect(screen.getAllByText('正在协调 · 1 个子 agent 运行中').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('agent-row-leader')?.textContent).not.toContain('可能卡住')
  })

  it('shows and dismisses an actionable stop error', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{ agentId: 'run', runId: 'r1', sessionId: 'session-1', name: 'explore', task: 'research', state: 'running' }]
    harness.host.abortAgent = vi.fn(async () => { throw new Error('Pi 没有确认停止请求') })
    render(<SubagentPanel host={harness.host} />)

    fireEvent.click(await screen.findByLabelText('中止 explore'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('无法停止 explore')
    expect(alert.textContent).toContain('Pi 没有确认停止请求')
    expect((screen.getByLabelText('中止 explore') as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '关闭错误提示' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('renders AgentRow model, worktree, stalled, and currency metadata', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'live', runId: 'r-live', sessionId: 'session-1', name: 'secretary', task: '收尾任务', state: 'running', stalled: true, stalledIdleSec: 42,
        provider: 'anthropic', model: 'anthropic/claude-sonnet-4', cost: .05, costUnit: 'CNY', exchangeRate: 7.2
      }
    })
    harness.emitAgent({ type: 'worktree', status: { agentId: 'live', sessionId: 'session-1', runId: 'r-live', lifecycle: 'active', merge: 'unavailable', discard: 'unavailable' } })
    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'done', runId: 'r-done', sessionId: 'session-1', name: 'reviewer', task: '审核变更', state: 'failed', createdAt: Date.now() - 30_000, endedAt: Date.now(),
        provider: 'openai', model: 'openai/gpt-5', cost: .5, costUnit: 'CNY', exchangeRate: 7.2
      }
    })
    harness.emitAgent({ type: 'worktree', status: { agentId: 'done', sessionId: 'session-1', runId: 'r-done', lifecycle: 'merged', merge: 'merged', discard: 'unavailable' } })

    const liveRow = await screen.findByTestId('agent-row-live')
    expect(liveRow.textContent).not.toContain('anthropic')
    expect(liveRow.textContent).not.toContain('claude-sonnet-4')
    fireEvent.click(liveRow.querySelector('.agent-select')!)
    expect(document.querySelector('.agent-detail')?.textContent).toContain('anthropic/claude-sonnet-4')
    expect(document.querySelector('.agent-detail')?.textContent).toContain('收尾秘书')
    expect(screen.getByText('卡住 42s')).toBeTruthy()
    expect(screen.getByText('wt')).toBeTruthy()
    expect(screen.getByText('已合并')).toBeTruthy()
    fireEvent.click(screen.getByTestId('agent-row-done').querySelector('.agent-select')!)
    expect(screen.getByText('¥3.60 CNY')).toBeTruthy()
  })

  it('keeps a narrow detail pane readable while showing the resolved model before technical details', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'narrow', runId: 'r1', name: 'reviewer', title: '中文任务简介', task: 'RAW_PROMPT /tmp/exact path',
      state: 'ok', createdAt: Date.now() - 2_000, endedAt: Date.now(), provider: 'jellytoken', model: 'volcengine/deepseek-v4-flash',
      sessionId: 'session-raw-exact', contextTokens: 120, inputTokens: 80, outputTokens: 40, cacheTokens: 20,
      finalResult: '中文 TLDR：验证完成', worktree: { agentId: 'narrow', lifecycle: 'mergedCleanupPending', merge: 'unavailable', discard: 'unavailable', error: 'FULL_RAW_ERROR exact' }
    }]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-narrow')
    const detail = document.querySelector('.agent-detail') as HTMLElement
    detail.style.width = '280px'
    expect(detail.querySelector('[data-testid="subagent-transcript"]')?.textContent).toContain('中文 TLDR：验证完成')
    const technical = detail.querySelector('.agent-technical-details') as HTMLDetailsElement
    expect(technical.open).toBe(false)
    expect(detail.querySelector('.agent-detail-header')?.textContent).toContain('DeepSeek · deepseek-v4-flash')
    expect(detail.querySelector('.agent-detail-header')?.textContent).not.toMatch(/jellytoken|session-raw|ctx |cache |RAW_PROMPT|FULL_RAW_ERROR/)

    fireEvent.click(screen.getByText('技术详情'))
    expect(technical.open).toBe(true)
    expect(technical.textContent).toContain('jellytoken')
    expect(technical.textContent).toContain('volcengine/deepseek-v4-flash')
    expect(technical.textContent).toContain('session-raw-exact')
    expect(technical.textContent).toContain('RAW_PROMPT /tmp/exact path')
    expect(technical.textContent).toContain('FULL_RAW_ERROR exact')
    expect(technical.textContent).toMatch(/ctx 120|in 80|out 40|cache 20/)
  })

  it('shows context window, cache hit, and in/out tokens on the selected detail header', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'live', runId: 'r-live', name: 'general-purpose', title: '修会话记录丢失',
      task: 'fix session loss', state: 'running', createdAt: Date.now(), updatedAt: Date.now(), provider: 'xai', model: 'xai/grok-4',
      contextTokens: 38_200, contextWindowTokens: 200_000, inputTokens: 12_400, outputTokens: 2_130, cacheTokens: 8_900,
    }]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-live')
    const usage = await screen.findByTestId('agent-detail-usage')
    const contextRow = screen.getByTestId('agent-detail-usage-context')
    expect(contextRow.textContent).toContain('上下文')
    expect(contextRow.textContent).toContain('38k/200k')
    expect(contextRow.textContent).toContain('缓存')
    expect(contextRow.textContent).toContain('42%')
    expect(contextRow.textContent).not.toContain('入/出')
    expect(usage.textContent).toContain('入/出')
    expect(usage.textContent).toContain('12k / 2.1k')
    expect(document.querySelector('.agent-detail-header')?.contains(usage)).toBe(true)
    expect(document.querySelector('.detail-agent-title')?.textContent).toContain('修会话记录丢失')
    expect(document.querySelector('.detail-agent-title')?.textContent).toContain('Grok')
  })

  it('omits the detail header usage block when the selected agent has no token facts', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'empty', runId: 'r-empty', name: 'explore', title: '无用量', task: 'look around', state: 'running', createdAt: 1,
    }]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-empty')
    expect(screen.queryByTestId('agent-detail-usage')).toBeNull()
  })

  it('matches the Swift hierarchy while rendering detail through the shared assistant transcript', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'fa0238aa', runId: 'r1', name: 'computer-use-leader', task: 'Computer Use Leader {"goal":"raw english goal"}',
      title: '整理桌面交付结果', state: 'ok', createdAt: Date.now() - 2_000, endedAt: Date.now(), finalResult: '中文最终结论',
      provider: 'openai', model: 'openai/gpt-5', sessionId: 'session-exact'
    }]
    render(<SubagentPanel host={harness.host} />)
    const row = await screen.findByTestId('agent-row-fa0238aa')
    expect(row.querySelector('strong')?.textContent).toBe('computer-use-leader')
    expect(row.textContent).toContain('整理桌面交付结果')
    expect(row.textContent).not.toContain('fa0238aa')
    expect(row.textContent).not.toContain('raw english goal')
    const icon = row.querySelector('[role="img"], img') as HTMLElement
    expect(icon.getAttribute('aria-label') || icon.getAttribute('alt')).toBeTruthy()
    expect(icon.textContent).not.toBe('◇')

    const detail = document.querySelector('.agent-detail')!
    const transcript = detail.querySelector('[data-testid="subagent-transcript"]')!
    const technical = detail.querySelector('.agent-technical-details')!
    expect(transcript.querySelector('[data-testid="assistant-transcript-content"]')).toBeTruthy()
    expect(technical.parentElement).toBe(detail.querySelector('[data-testid="subagent-transcript-scroll"]'))
    expect(transcript.textContent).toContain('中文最终结论')
    expect(technical.textContent).not.toContain('中文最终结论')
    expect(row.textContent).not.toContain('session-exact')
    fireEvent.click(screen.getByText('技术详情'))
    expect(technical.textContent).toContain('fa0238aa')
    expect(technical.textContent).toContain('session-exact')
  })

  it('hides generated agent ids, uses real provider marks, preserves legacy roles, and fills TLDR from the latest result', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      {
        agentId: 'agent-695e75d00abc', runId: 'r1', name: 'computer-terminal',
        task: 'Run a restricted terminal step', state: 'ok', createdAt: 1,
        provider: 'jellytoken', model: 'volcengine/deepseek-v4-flash'
      },
      {
        agentId: 'agent-13cbc1234def', runId: 'r2', parentId: 'agent-695e75d00abc', name: 'computer-use-leader',
        task: 'Give the main agent a detailed summary of the computer use work', state: 'ok', createdAt: 2,
        provider: 'openai', model: 'openai/gpt-5'
      },
      {
        agentId: 'agent-images', runId: 'r3', name: 'subagent', task: 'subagent', state: 'interrupted', createdAt: 3,
        provider: 'google', model: 'google/gemini-2.5-pro', finalResult: '已整理图片并返回可用结果'
      }
    ]
    render(<SubagentPanel host={harness.host} />)

    const terminal = await screen.findByTestId('agent-row-agent-695e75d00abc')
    const leader = screen.getByTestId('agent-row-agent-13cbc1234def')
    expect(terminal.querySelector('strong')?.textContent).toBe('computer-terminal')
    expect(leader.querySelector('strong')?.textContent).toBe('computer-use-leader')
    expect(terminal.textContent).not.toContain('agent-695e75d')
    expect(leader.textContent).not.toContain('agent-13cbc')
    expect(leader.textContent).toContain('Give the main agent')

    const icon = terminal.querySelector('[role="img"]')!
    expect(icon.getAttribute('aria-label')).toBe('DeepSeek 模型')
    expect(icon.querySelector('[data-testid="provider-logo-deepseek"]')).toBeTruthy()
    expect(icon.textContent).not.toMatch(/^[DGA]$/)

    fireEvent.click(screen.getByTestId('agent-row-agent-images').querySelector('.agent-select')!)
    expect(document.querySelector('.detail-agent-title b')?.textContent).toContain('已整理图片并返回可用结果')
    expect(document.querySelector('[data-testid="subagent-transcript"]')?.textContent).toContain('已整理图片并返回可用结果')
    expect(document.querySelector('.agent-detail-header')?.textContent).not.toContain('subagent')
  })

  it('uses a compact independently scrolling list/detail split and represents the full long history with standard folding', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'long-log', runId: 'r1', name: 'explore', task: '检查日志', state: 'running' } })
    await screen.findByTestId('agent-row-long-log')
    await waitFor(() => expect(harness.hasLogSubscriber('long-log')).toBe(true))
    const raw = `LONG_RAW_JSON ${JSON.stringify({ tool: 'memory_query', path: '/tmp/exact raw path', payload: 'x'.repeat(500) })}`
    harness.emitLog('long-log', { type: 'agent_log', agentId: 'long-log', itemType: 'thinking', text: 'FULL_THINKING_PROCESS' })
    harness.emitLog('long-log', { type: 'agent_log', agentId: 'long-log', itemType: 'tool', name: 'memory_query', text: '{"query":"exact"}' })
    harness.emitLog('long-log', { type: 'agent_log', agentId: 'long-log', itemType: 'toolResult', text: 'TOOL_RESULT_EXACT' })
    harness.emitLog('long-log', { type: 'agent_log', agentId: 'long-log', itemType: 'text', text: raw })
    const list = document.querySelector('.agent-list') as HTMLElement
    const scroll = screen.getByTestId('subagent-transcript-scroll')
    expect(list.dataset.density).toBe('compact')
    expect(list).not.toBe(scroll)
    expect(scroll.classList.contains('agent-transcript-scroll')).toBe(true)
    await waitFor(() => expect(screen.getAllByTestId('assistant-transcript-content')).toHaveLength(1))
    expect(screen.getByText(/LONG_RAW_JSON/)).toBeTruthy()
    expect(screen.queryByText('FULL_THINKING_PROCESS')).toBeNull()
    expect(screen.queryByText('TOOL_RESULT_EXACT')).toBeNull()
    // Subagent transcript step groups default collapsed and expand interactively.
    const steps = await screen.findByRole('button', { name: /个步骤/ })
    expect(steps.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(steps)
    expect(steps.getAttribute('aria-expanded')).toBe('true')
    const tool = await screen.findByRole('button', { name: /^memory_query/ })
    expect(tool.getAttribute('aria-expanded')).toBe('false')
    expandTranscriptCards()
    expect(await screen.findByText('FULL_THINKING_PROCESS')).toBeTruthy()
    expect(screen.getByText('TOOL_RESULT_EXACT')).toBeTruthy()
    scroll.scrollTop = 120
    fireEvent.scroll(scroll)
    expect(scroll.scrollTop).toBe(120)
  })

  it('keeps the detail transcript pinned to the latest log while the viewer is at the bottom', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'live', runId: 'r-live', name: 'explore', task: '定位按钮', state: 'running' } })
    await screen.findByTestId('agent-row-live')
    await waitFor(() => expect(harness.hasLogSubscriber('live')).toBe(true))
    const scroll = screen.getByTestId('subagent-transcript-scroll')
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 200 })
    let height = 400
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => height })

    harness.emitLog('live', { type: 'agent_log', agentId: 'live', itemType: 'text', text: 'FIRST_RESULT' })
    await waitFor(() => expect(screen.getByText('FIRST_RESULT')).toBeTruthy())
    expect(scroll.scrollTop).toBe(200)

    scroll.scrollTop = 40
    fireEvent.scroll(scroll)
    height = 480
    harness.emitLog('live', { type: 'agent_log', agentId: 'live', itemType: 'text', text: 'MIDDLE_RESULT' })
    await waitFor(() => expect(screen.getByText('MIDDLE_RESULT')).toBeTruthy())
    expect(scroll.scrollTop).toBe(40)

    scroll.scrollTop = 264
    fireEvent.scroll(scroll)
    height = 600
    harness.emitLog('live', { type: 'agent_log', agentId: 'live', itemType: 'text', text: 'LATEST_RESULT' })
    await waitFor(() => expect(screen.getByText('LATEST_RESULT')).toBeTruthy())
    expect(scroll.scrollTop).toBe(400)
  })

  it('shows a 回到最新 button when the detail transcript is scrolled away from the bottom and resumes following on click', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'live', runId: 'r-live', name: 'explore', task: '定位按钮', state: 'running' } })
    await screen.findByTestId('agent-row-live')
    await waitFor(() => expect(harness.hasLogSubscriber('live')).toBe(true))
    const scroll = screen.getByTestId('subagent-transcript-scroll')
    Object.defineProperty(scroll, 'clientHeight', { configurable: true, value: 200 })
    let height = 400
    Object.defineProperty(scroll, 'scrollHeight', { configurable: true, get: () => height })

    harness.emitLog('live', { type: 'agent_log', agentId: 'live', itemType: 'text', text: 'FIRST_RESULT' })
    await waitFor(() => expect(screen.getByText('FIRST_RESULT')).toBeTruthy())

    // no button while at the bottom and following
    expect(screen.queryByRole('button', { name: '回到最新' })).toBeNull()

    // scroll away from the bottom -> button appears
    scroll.scrollTop = 40
    fireEvent.scroll(scroll)
    expect(screen.getByRole('button', { name: '回到最新' })).toBeTruthy()

    // clicking resumes follow and scrolls back to the bottom, button disappears
    height = 480
    fireEvent.click(screen.getByRole('button', { name: '回到最新' }))
    expect(scroll.scrollTop).toBe(280)
    expect(screen.queryByRole('button', { name: '回到最新' })).toBeNull()
  })

  it('keeps the agent list pinned to the newest row while the viewer is at the bottom', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'old', runId: 'r-old', name: 'explore', task: '旧任务', state: 'ok', createdAt: 1 } })
    await screen.findByTestId('agent-row-old')
    const list = document.querySelector('.agent-list') as HTMLElement
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 })
    let height = 400
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => height })

    harness.emitAgent({ type: 'agent', agent: { agentId: 'mid', runId: 'r-mid', name: 'explore', task: '中任务', state: 'ok', createdAt: 2 } })
    await screen.findByTestId('agent-row-mid')
    await waitFor(() => expect(list.scrollTop).toBe(200))

    list.scrollTop = 40
    fireEvent.scroll(list)
    height = 480
    harness.emitAgent({ type: 'agent', agent: { agentId: 'later', runId: 'r-later', name: 'explore', task: '后任务', state: 'ok', createdAt: 3 } })
    await screen.findByTestId('agent-row-later')
    expect(list.scrollTop).toBe(40)

    list.scrollTop = 264
    fireEvent.scroll(list)
    height = 600
    harness.emitAgent({ type: 'agent', agent: { agentId: 'newest', runId: 'r-newest', name: 'explore', task: '最新任务', state: 'ok', createdAt: 4 } })
    await screen.findByTestId('agent-row-newest')
    await waitFor(() => expect(list.scrollTop).toBe(400))
  })

  it('pins the agent list to the newest row when the pane becomes visible', async () => {
    const harness = hostHarness()
    const view = render(<SubagentPanel host={harness.host} visible={false} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'hidden', runId: 'r-hidden', name: 'explore', task: '后台任务', state: 'ok', createdAt: 1 } })
    await screen.findByTestId('agent-row-hidden')
    const list = document.querySelector('.agent-list') as HTMLElement
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 })
    Object.defineProperty(list, 'scrollHeight', { configurable: true, value: 500 })
    expect(list.scrollTop).toBe(0)

    view.rerender(<SubagentPanel host={harness.host} visible />)
    await waitFor(() => expect(list.scrollTop).toBe(300))
  })

  it('loads the snapshot tree and routes review worktree actions', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'root', runId: 'r1', sessionId: 'session-1', name: 'builder', role: 'general-purpose', title: 'Build UI', task: 'build', state: 'ok', depth: 1, createdAt: 1 },
      { agentId: 'child', runId: 'r2', parentId: 'root', sessionId: 'session-1', name: 'review', task: 'review', state: 'ok', depth: 2, createdAt: 2 }
    ]
    render(<SubagentPanel host={harness.host} retainedWorktreeDispositionAvailable />)
    await screen.findByText('Build UI')
	expect(screen.getByText('主管 · 1 个子 agent')).toBeTruthy()
	expect(screen.getByTestId('agent-row-child').classList.contains('agent-child')).toBe(true)
	expect(screen.getByLabelText('Leader 的子 agent')).toBeTruthy()
    harness.emitAgent({ type: 'worktree', status: { agentId: 'root', sessionId: 'session-1', runId: 'r1', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })
    fireEvent.click(screen.getByText('Build UI'))
    await screen.findByText('合并到主分支')
    fireEvent.click(screen.getByText('合并到主分支'))
    await waitFor(() => expect(harness.mergeWorktree).toHaveBeenCalledWith('session-1', 'root', 'r1'))
  })

  it('hides manual retained-worktree disposition when the host capability is false', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'root', runId: 'r1', sessionId: 'session-1', name: 'builder', task: 'build', state: 'failed', createdAt: 1 }
    ]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-root')
    harness.emitAgent({ type: 'worktree', status: { agentId: 'root', sessionId: 'session-1', runId: 'r1', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })
    expect(screen.queryByText('合并到主分支')).toBeNull()
    expect(screen.queryByText('丢弃 worktree')).toBeNull()
  })

  it('hydrates a completed agent transcript from getAgentLogs after a restart', async () => {
    const harness = hostHarness()
    harness.host.getAgentLogs = async () => [
      { itemType: 'thinking', text: 'first-plan' },
      { itemType: 'text', text: '先读 A' },
      { itemType: 'tool', name: 'read', text: '{"path":"A.md"}' },
      { itemType: 'toolResult', text: 'README contents' },
    ]
    harness.host.listAgents = async () => [
      { agentId: 'done', runId: 'r1', sessionId: 's1', name: 'explore', task: 'research', state: 'ok', finalResult: '## TLDR only' },
    ]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-done')
    expect(await screen.findByText('先读 A')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /个步骤/ }).length).toBeGreaterThan(0)
    expect(screen.queryByText('README contents')).toBeNull()
    expect(screen.getByText(/TLDR only/)).toBeTruthy()
  })

  it('shows the running bash command on the live tool row and status line', async () => {
    const harness = hostHarness()
    const now = Date.now()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'run', runId: 'r1', name: 'general-purpose', title: '视觉模型设置收尾验证',
        task: 'verify', state: 'running', createdAt: now - 10_000, updatedAt: now,
        listSubtitle: 'bash npm test --workspaces', activityActive: true,
      },
    })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'run the suite' })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'bash', text: 'npm test --workspaces' })

    const active = await screen.findByTestId('active-tool')
    expect(active.querySelector('b')?.textContent).toBe('bash · npm test --workspaces')
    expect(active.textContent).toContain('运行中')
    expect(screen.getAllByText(/最近活动 · bash · npm test --workspaces/).length).toBeGreaterThan(0)
    expect(screen.queryByText('输入')).toBeNull()
  })

  it('shows skill_search and skill_load in subagent activity alongside ordinary tools', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'skills', runId: 'r-skill', name: 'explore', task: 'load a skill', state: 'running',
        listSubtitle: 'skill_load tdd', activityActive: true,
      },
    })
    await screen.findByTestId('agent-row-skills')
    await waitFor(() => expect(harness.hasLogSubscriber('skills')).toBe(true))
    harness.emitLog('skills', { type: 'agent_log', agentId: 'skills', itemType: 'tool', name: 'skill_search', text: '{"query":"office document"}' })
    harness.emitLog('skills', { type: 'agent_log', agentId: 'skills', itemType: 'toolResult', name: 'skill_search', text: 'skill_load({name}).' })
    harness.emitLog('skills', { type: 'agent_log', agentId: 'skills', itemType: 'tool', name: 'skill_load', text: '{"name":"tdd"}' })
    harness.emitLog('skills', { type: 'agent_log', agentId: 'skills', itemType: 'toolResult', name: 'skill_load', text: '# Skill: tdd' })
    harness.emitLog('skills', { type: 'agent_log', agentId: 'skills', itemType: 'tool', name: 'read', text: '{"path":"src/a.ts"}' })
    harness.emitLog('skills', { type: 'agent_log', agentId: 'skills', itemType: 'toolResult', name: 'read', text: 'file body' })
    await waitFor(() => expect(screen.getAllByTestId('assistant-transcript-content')).toHaveLength(1))
    fireEvent.click(await screen.findByRole('button', { name: /个步骤/ }))
    expect(await screen.findByRole('button', { name: /^skill_search/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^skill_load/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^read/ })).toBeTruthy()
    expect(screen.getAllByText(/最近活动 · skill_load · tdd/).length).toBeGreaterThan(0)
  })

  it('pairs same-name tool results by toolCallId even when results arrive in reverse order', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'ids', runId: 'r1', name: 'explore', task: 'pair by id', state: 'running' } })
    await screen.findByTestId('agent-row-ids')
    await waitFor(() => expect(harness.hasLogSubscriber('ids')).toBe(true))
    harness.emitLog('ids', { type: 'agent_log', agentId: 'ids', itemType: 'tool', name: 'read', text: '{"path":"A.ts"}', toolCallId: 'ta' })
    harness.emitLog('ids', { type: 'agent_log', agentId: 'ids', itemType: 'tool', name: 'read', text: '{"path":"B.ts"}', toolCallId: 'tb' })
    // Same-name concurrent calls, results arriving in reverse order.
    harness.emitLog('ids', { type: 'agent_log', agentId: 'ids', itemType: 'toolResult', name: 'read', text: 'RESULT_B', toolCallId: 'tb' })
    harness.emitLog('ids', { type: 'agent_log', agentId: 'ids', itemType: 'toolResult', name: 'read', text: 'RESULT_A', toolCallId: 'ta' })
    await waitFor(() => expect(screen.getAllByTestId('assistant-transcript-content')).toHaveLength(1))
    expandTranscriptCards()
    const cardA = screen.getByText('RESULT_A').closest('[data-activity-card="tool"]')
    const cardB = screen.getByText('RESULT_B').closest('[data-activity-card="tool"]')
    expect(cardA).toBeTruthy()
    expect(cardB).toBeTruthy()
    expect(cardA?.textContent).toContain('A.ts')
    expect(cardA?.textContent).not.toContain('RESULT_B')
    expect(cardB?.textContent).toContain('B.ts')
    expect(cardB?.textContent).not.toContain('RESULT_A')
  })

  it('binds a nameless toolResult to its toolCallId instead of the first same-name tool', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'nameless', runId: 'r1', name: 'explore', task: 'nameless result', state: 'running' } })
    await screen.findByTestId('agent-row-nameless')
    await waitFor(() => expect(harness.hasLogSubscriber('nameless')).toBe(true))
    harness.emitLog('nameless', { type: 'agent_log', agentId: 'nameless', itemType: 'tool', name: 'read', text: '{"path":"A.ts"}', toolCallId: 'ta' })
    harness.emitLog('nameless', { type: 'agent_log', agentId: 'nameless', itemType: 'tool', name: 'read', text: '{"path":"B.ts"}', toolCallId: 'tb' })
    // No toolName on the result; only the call identity identifies the owner.
    harness.emitLog('nameless', { type: 'agent_log', agentId: 'nameless', itemType: 'toolResult', text: 'ONLY_B', toolCallId: 'tb' })
    await waitFor(() => expect(screen.getAllByTestId('assistant-transcript-content')).toHaveLength(1))
    expandTranscriptCards()
    const cardB = screen.getByText('ONLY_B').closest('[data-activity-card="tool"]')
    expect(cardB?.textContent).toContain('B.ts')
    expect(cardB?.textContent).not.toContain('A.ts')
    // The first call stays unpaired rather than stealing the nameless result.
    const summaries = [...document.querySelectorAll('[data-activity-card="tool"] b')].map(node => node.textContent)
    expect(summaries.some(summary => summary?.includes('A.ts'))).toBe(true)
    expect([...document.querySelectorAll('[data-activity-card="tool"]')].filter(card => card.textContent?.includes('A.ts')).every(card => !card.textContent?.includes('ONLY_B'))).toBe(true)
  })

  it('renders an orphan toolResult as a result card, never as markdown prose', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'orphan', runId: 'r1', name: 'reviewer', task: 'review', state: 'running' } })
    await screen.findByTestId('agent-row-orphan')
    await waitFor(() => expect(harness.hasLogSubscriber('orphan')).toBe(true))
    // The tool row was lost (mid-run reload/stream gap); only its result arrives.
    harness.emitLog('orphan', { type: 'agent_log', agentId: 'orphan', itemType: 'toolResult', name: 'read', text: 'def _loop_warnings(envelope):\n    return []\n\n\ndef test_third_call():\n    assert True' })
    await waitFor(() => expect(screen.getAllByTestId('assistant-transcript-content')).toHaveLength(1))
    expandTranscriptCards()
    // The raw output stays inside a tool/result card (pre-wrap monospace), and no
    // markdown text segment picks it up — collapsed newlines turned it into a wall of prose.
    const card = screen.getByText(/def _loop_warnings/).closest('[data-activity-card="tool"]')
    expect(card).toBeTruthy()
    for (const segment of document.querySelectorAll('[data-transcript-segment="text"]')) {
      expect(segment.textContent).not.toContain('def _loop_warnings')
    }
  })

  it('backfills a lost tool row from the cache so its result pairs instead of staying orphaned', async () => {
    const harness = hostHarness()
    // Reproduce the mid-run reload hole: the live stream already has the result
    // (its tool row was lost — the runtime never re-sends already-streamed tool
    // calls), and the cache snapshot resolves only AFTER those live rows landed.
    let resolveLogs: (entries: { itemType: 'tool'; name: string; text: string; toolCallId: string }[]) => void = () => {}
    harness.host.getAgentLogs = () => new Promise(resolve => { resolveLogs = resolve })
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'backfill', runId: 'r1', name: 'reviewer', task: 'review', state: 'running' } })
    await screen.findByTestId('agent-row-backfill')
    await waitFor(() => expect(harness.hasLogSubscriber('backfill')).toBe(true))
    harness.emitLog('backfill', { type: 'agent_log', agentId: 'backfill', itemType: 'toolResult', name: 'read', text: 'LOST_RESULT_BODY', toolCallId: 'tc-lost' })
    // The batched flush lands the owner-less result as a finished result card in
    // the steps group (never as markdown prose).
    await waitFor(() => expect(screen.getAllByTestId('assistant-transcript-content')).toHaveLength(1))
    resolveLogs([{ itemType: 'tool', name: 'read', text: '{"path":"lost.md"}', toolCallId: 'tc-lost' }])
    // The backfilled tool row absorbs its result into one paired card (input +
    // output together). Expansion repeats inside the wait because the group's
    // expansion state resets when the transcript restructures around the pairing.
    await waitFor(() => {
      expandTranscriptCards()
      expect(screen.getByText('LOST_RESULT_BODY').closest('[data-activity-card="tool"]')?.textContent).toContain('lost.md')
    })
    expect(document.querySelectorAll('[data-activity-card="tool"]').length).toBe(1)
  })

  it('merges the cache backfill idempotently: snapshot rows dedup against live rows', async () => {
    const harness = hostHarness()
    harness.host.getAgentLogs = async () => [
      { itemType: 'thinking', text: 'PLAN_AHEAD' },
      { itemType: 'tool', name: 'read', text: '{"path":"a.md"}', toolCallId: 'tc1' },
      { itemType: 'toolResult', name: 'read', text: 'A_MD_BODY', toolCallId: 'tc1' },
    ]
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'dedup', runId: 'r1', name: 'reviewer', task: 'review', state: 'running' } })
    await screen.findByTestId('agent-row-dedup')
    await waitFor(() => expect(harness.hasLogSubscriber('dedup')).toBe(true))
    // The live stream already delivered the same rows the snapshot contains, plus
    // a newer text row the snapshot predates.
    harness.emitLog('dedup', { type: 'agent_log', agentId: 'dedup', itemType: 'thinking', text: 'PLAN_AHEAD' })
    harness.emitLog('dedup', { type: 'agent_log', agentId: 'dedup', itemType: 'tool', name: 'read', text: '{"path":"a.md"}', toolCallId: 'tc1' })
    harness.emitLog('dedup', { type: 'agent_log', agentId: 'dedup', itemType: 'toolResult', name: 'read', text: 'A_MD_BODY', toolCallId: 'tc1' })
    harness.emitLog('dedup', { type: 'agent_log', agentId: 'dedup', itemType: 'text', text: 'AFTER_SNAPSHOT_LINE' })
    // The live flush batches at 200ms: wait for the post-snapshot row, then expand.
    await waitFor(() => expect(screen.getByText('AFTER_SNAPSHOT_LINE')).toBeTruthy())
    expandTranscriptCards()
    expect(screen.getAllByText('PLAN_AHEAD')).toHaveLength(1)
    expect(screen.getAllByText('A_MD_BODY')).toHaveLength(1)
    expect(document.querySelectorAll('[data-activity-card="tool"]').length).toBe(1)
  })

  it('keeps a running tool card collapsed so execution details stay folded', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'read', text: '{"path":"SECRET.md"}' })
    const active = await screen.findByTestId('active-tool')
    expect(active.querySelector('b')?.textContent).toBe('read · SECRET.md')
    expect(active.querySelector('[aria-expanded]')).toBeNull()
    expect(screen.queryByText('输入')).toBeNull()
  })

  it('renders thinking, tools, results, diffs, and final output through shared collapsed cards', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    const hiddenThought = `思考摘要 ${'x'.repeat(80)} EXPANDED_THINKING_BODY`
    harness.emitAgent({
      type: 'agent',
      agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running', finalResult: '最终输出内容' }
    })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: hiddenThought })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'edit', text: '{"path":"Electron/packages/ui/src/SubagentPanel.tsx"}' })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'toolResult', text: 'diff --git a/demo.ts b/demo.ts\n--- a/demo.ts\n+++ b/demo.ts\n@@ -1 +1 @@\n-old\n+new' })

    const steps = await screen.findByRole('button', { name: /个步骤/ })
    expect(steps.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(steps)
    expect(screen.queryByText(/EXPANDED_THINKING_BODY/)).toBeNull()
    // Thinking card is collapsed inside the expanded step card.
    const thinking = await screen.findByRole('button', { name: /^Thinking/ })
    expect(thinking.closest('[data-activity-card="thinking"]')).toBeTruthy()
    fireEvent.click(thinking)
    await screen.findByText(/EXPANDED_THINKING_BODY/)
    // Tool card is collapsed; expand to see the diff.
    const tool = await screen.findByRole('button', { name: /^edit/ })
    expect(tool.closest('[data-activity-card="tool"]')).toBeTruthy()
    if (tool.getAttribute('aria-expanded') === 'false') fireEvent.click(tool)
    expect(screen.getByText(/diff --git a\/demo.ts/)).toBeTruthy()
    expect(document.querySelector('[data-activity-card="final"]')).toBeNull()
  })

  it('upserts streamed log_delta snapshots into one row per contentIndex', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))

    // Three cumulative snapshots of the same contentIndex must collapse into one
    // content row — the final cumulative text wins, intermediate partials don't linger.
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '{"step":', contentIndex: 0 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '{"step": 1', contentIndex: 0 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '{"step": 1}', contentIndex: 0 })
    expect(await screen.findAllByText('{"step": 1}')).toHaveLength(1)
    expect(screen.queryByText('{"step":')).toBeNull()
    expect(screen.queryByText('{"step": 1')).toBeNull()

    // A different contentIndex opens a second row: thinking becomes its own step
    // (a "1 个步骤 · Thinking" card) alongside the existing content.
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'plan', contentIndex: 1 })
    const liveSteps = await screen.findByRole('button', { name: /1 个步骤 · Thinking/ })
    expect(liveSteps.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(liveSteps)
    expect(screen.getByText('{"step": 1}')).toBeTruthy()
    // Live thinking is open once the boss expands the folded group, so the user
    // sees tokens arrive instead of a collapsed wait.
    expect(await screen.findByText('plan')).toBeTruthy()
  })

  it('batches a burst of cumulative live-log snapshots into one visible refresh', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'batch', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByTestId('agent-row-batch')
    await waitFor(() => expect(harness.hasLogSubscriber('batch')).toBe(true))

    await act(async () => {
      for (let i = 0; i < 80; i += 1) {
        harness.emitLog('batch', { type: 'agent_log', agentId: 'batch', itemType: 'text', text: `LIVE_BATCH_FINAL_${i}`, contentIndex: 0 })
      }
    })

    // The renderer must not rebuild the complete Markdown/detail tree 80 times
    // in the producer's burst. The latest cumulative snapshot appears when the
    // bounded render batch flushes.
    expect(screen.queryByText('LIVE_BATCH_FINAL_79')).toBeNull()
    expect(await screen.findAllByText('LIVE_BATCH_FINAL_79')).toHaveLength(1)
    expect(screen.queryByText('LIVE_BATCH_FINAL_78')).toBeNull()
  })

  it('streams thinking and tools as chronological detail steps instead of one overwritten Thinking header', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))

    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'first-plan', contentIndex: 0 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'grep', text: '{"pattern":"agentTranscript"}', contentIndex: 1 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'toolResult', text: 'match', contentIndex: 2 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'second-plan', contentIndex: 3 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'find', text: '{"pattern":"*.tsx"}', contentIndex: 4 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'toolResult', text: 'file', contentIndex: 5 })

    fireEvent.click(await screen.findByRole('button', { name: /4 个步骤/ }))
    const thinkingCards = screen.getAllByRole('button', { name: /^Thinking/ })
    expect(thinkingCards).toHaveLength(2)
    const stepCards = [...document.querySelectorAll('[data-testid="subagent-transcript"] [data-activity-card="thinking"], [data-testid="subagent-transcript"] [data-activity-card="tool"]')]
    expect(stepCards.map(card => card.getAttribute('data-activity-card'))).toEqual(['thinking', 'tool', 'thinking', 'tool'])
    expect(stepCards[1].textContent).toMatch(/grep/)
    expect(stepCards[3].textContent).toMatch(/find/)
    expect(screen.queryByText('first-plan')).toBeNull()
    fireEvent.click(thinkingCards[0])
    expect(await screen.findByText('first-plan')).toBeTruthy()
    if (thinkingCards[1].getAttribute('aria-expanded') === 'false') fireEvent.click(thinkingCards[1])
    expect(await screen.findByText('second-plan')).toBeTruthy()
    expect(screen.queryByText(/first-plan\s*second-plan/)).toBeNull()
  })

  it('does not let the next assistant turn overwrite earlier thinking or swallow mid-turn text', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))

    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'first-plan', contentIndex: 0 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '先读 A', contentIndex: 1 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '', resetStreamSlots: true })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'read', text: '{"path":"A.tsx"}' })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'second-plan', contentIndex: 0 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '再读 B', contentIndex: 1 })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: '', resetStreamSlots: true })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'read', text: '{"path":"B.tsx"}' })

    await screen.findByText('先读 A')
    expect(screen.getByText('再读 B')).toBeTruthy()
    for (const button of screen.getAllByRole('button', { name: /个步骤/ })) {
      if (button.getAttribute('aria-expanded') === 'false') fireEvent.click(button)
    }
    const thinkingCards = screen.getAllByRole('button', { name: /^Thinking/ })
    expect(thinkingCards).toHaveLength(2)
    const timeline = [...document.querySelectorAll('[data-testid="subagent-transcript"] [data-activity-card="thinking"], [data-testid="subagent-transcript"] [data-activity-card="tool"], [data-testid="subagent-transcript"] [data-transcript-segment="text"]')]
    expect(timeline.map(node => node.getAttribute('data-activity-card') ?? node.getAttribute('data-transcript-segment'))).toEqual([
      'thinking', 'text', 'tool', 'thinking', 'text', 'tool',
    ])
    expect(screen.queryByText('first-plan')).toBeNull()
    fireEvent.click(thinkingCards[0])
    expect(await screen.findByText('first-plan')).toBeTruthy()
  })

  it('applies the prefix-replace fallback for hosts without contentIndex', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))

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

  it('keeps each sibling run its own streamed transcript instead of clearing the finished one', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    const base = { agentId: 'run', name: 'explore', task: 'research' }
    const now = Date.now()
    harness.emitAgent({ type: 'agent', agent: { ...base, sessionId: 'session-1', runId: 'r1', state: 'running', createdAt: now - 4_000 } })
    // A lone run shows under the bare slug; the --runId suffix appears once a
    // sibling run of the same slug coexists.
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: 'run one', contentIndex: 0 })

    harness.emitAgent({ type: 'agent', agent: { ...base, sessionId: 'session-1', runId: 'r2', state: 'running', createdAt: now } })
    expect(await screen.findByTestId('agent-row-run--r2')).toBeTruthy()
    expect(screen.getByTestId('agent-row-run--r1')).toBeTruthy()

    // Selecting r2 re-binds the exact-episode log subscription; let effects flush,
    // then its first streamed log paints under r2 only.
    fireEvent.click(screen.getByTestId('agent-row-run--r2').querySelector('.agent-select')!)
    await act(async () => { await Promise.resolve() })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'text', text: 'run two', contentIndex: 0 })
    expect(await screen.findByText('run two')).toBeTruthy()
    expect(screen.queryByText('run one')).toBeNull()

    // Switching back shows r1's own stream untouched: per-episode rows own their
    // transcripts; a sibling run starting never clears another run's record.
    fireEvent.click(screen.getByTestId('agent-row-run--r1').querySelector('.agent-select')!)
    expect(await screen.findByText('run one')).toBeTruthy()
    expect(screen.queryByText('run two')).toBeNull()
  })

  it('keeps the newest fixed page and persists the dragged list/detail split', async () => {
    localStorage.setItem('pipiui:subagent-list-ratio', '0.48')
    const harness = hostHarness()
    const snapshot: AgentSummary[] = Array.from({ length: 31 }, (_, index) => ({
      agentId: `agent-${index}`, runId: `run-${index}`, name: `agent-${index}`, task: '分页', state: 'ok', createdAt: index
    }))
    harness.host.listAgents = async () => snapshot
    const first = render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-agent-30')
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
    await screen.findByTestId('agent-row-agent-30')
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

  it('treats snapshot agents as pre-existing runs and only reveals starts after hydration', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'pre-running', runId: 'run-1', name: 'explore', task: 'already running before mount', state: 'running', createdAt: 1 }
    ]
    const onAgentStarted = vi.fn()
    render(<SubagentPanel host={harness.host} onAgentStarted={onAgentStarted} />)

    expect(await screen.findByText('explore')).toBeTruthy()
    await waitFor(() => expect(onAgentStarted).not.toHaveBeenCalled())

    harness.emitAgent({ type: 'agent', agent: { agentId: 'fresh-run', runId: 'run-2', name: 'builder', task: 'started live', state: 'running', createdAt: 2 } })
    expect(await screen.findByText('builder')).toBeTruthy()
    await waitFor(() => expect(onAgentStarted).toHaveBeenCalledTimes(1))
  })

  it('warns when a running worker has been silent for 10 minutes and lets the user ask the main agent to check status', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [
      { agentId: 'ghost', runId: 'r-ghost', name: 'explore', task: 'vanished worker', state: 'running', createdAt: now - 11 * 60_000, updatedAt: now - 11 * 60_000 },
      { agentId: 'fresh', runId: 'r-fresh', name: 'builder', task: 'still reporting', state: 'running', createdAt: now, updatedAt: now },
      { agentId: 'done', runId: 'r-done', name: 'reviewer', task: 'already finished', state: 'ok', createdAt: now - 11 * 60_000, updatedAt: now - 11 * 60_000 },
    ]
    const onManualStatusCheck = vi.fn()
    render(<SubagentPanel host={harness.host} onManualStatusCheck={onManualStatusCheck} />)

    const warning = await screen.findByTestId('subagent-status-channel-warning')
    expect(warning.textContent).toContain('1 个子代理（ghost）')
    expect(warning.textContent).toContain('自动状态通道可能不可用')
    expect(warning.textContent).not.toContain('fresh')
    expect(warning.textContent).not.toContain('done')

    fireEvent.click(screen.getByTestId('subagent-manual-status-check'))
    expect(onManualStatusCheck).toHaveBeenCalledWith(['ghost'])
  })

  it('does not show the status-channel warning while every running worker is still being observed', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [
      { agentId: 'fresh', runId: 'r-fresh', name: 'builder', task: 'still reporting', state: 'running', createdAt: now, updatedAt: now },
    ]
    render(<SubagentPanel host={harness.host} onManualStatusCheck={vi.fn()} />)

    expect(await screen.findByTestId('agent-row-fresh')).toBeTruthy()
    expect(screen.queryByTestId('subagent-status-channel-warning')).toBeNull()
  })

  it('asks the main agent to inspect the selected worker when technical-details 手动检查 is clicked', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [
      { agentId: 'worker-1', runId: 'r1', sessionId: 'session-1', name: 'explore', task: 'look around', state: 'running', createdAt: now, updatedAt: now },
    ]
    const onManualStatusCheck = vi.fn()
    render(<SubagentPanel host={harness.host} onManualStatusCheck={onManualStatusCheck} />)

    await screen.findByTestId('agent-row-worker-1')
    fireEvent.click(screen.getByText('技术详情'))
    fireEvent.click(screen.getByTestId('subagent-detail-status-check'))
    expect(onManualStatusCheck).toHaveBeenCalledWith(['worker-1'])
    expect(harness.checkAgent).toHaveBeenCalledWith('session-1', 'worker-1', 'r1')
  })

  it('shows live write token estimates on the active card and list status', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'run', runId: 'r1', sessionId: 'session-1', name: 'explore', task: 'research', state: 'running',
      createdAt: Date.now(), updatedAt: Date.now(), listSubtitle: 'write src/a.ts', activityActive: true,
    }]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
    harness.emitLog('run', { type: 'agent_log', sessionId: 'session-1', agentId: 'run', runId: 'r1', itemType: 'tool', name: 'write', text: JSON.stringify({ path: 'src/a.ts', payloadChars: 8 }), contentIndex: 0 })
    expect((await screen.findByTestId('active-tool')).textContent).toMatch(/~2 tokens/)
    expect(screen.getAllByText(/最近活动 · write · src\/a.ts/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/~2 tokens/).length).toBeGreaterThan(0)
    harness.emitLog('run', { type: 'agent_log', sessionId: 'session-1', agentId: 'run', runId: 'r1', itemType: 'tool', name: 'write', text: JSON.stringify({ path: 'src/a.ts', payloadChars: 40 }), contentIndex: 0 })
    await waitFor(() => expect(screen.getByTestId('active-tool').textContent).toMatch(/~10 tokens/))
  })

  it('shows finished write/edit +/− from compact log stats', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'ok' } })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'write', text: JSON.stringify({ path: 'a.ts', payloadChars: 16, addedChars: 16, removedChars: 0, addedLines: 3, removedLines: 0 }) })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'toolResult', name: 'write', text: 'ok' })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'edit', text: JSON.stringify({ path: 'b.ts', payloadChars: 8, addedChars: 8, removedChars: 4, addedLines: 1, removedLines: 1 }) })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'toolResult', name: 'edit', text: 'ok' })
    const steps = await screen.findByRole('button', { name: /个步骤/ })
    if (steps.getAttribute('aria-expanded') === 'false') fireEvent.click(steps)
    expect((await screen.findByRole('button', { name: /write · a.ts/ })).textContent).toMatch(/\+3/)
    expect(screen.getByRole('button', { name: /edit · b.ts/ }).textContent).toMatch(/\+1/)
    expect(screen.getByRole('button', { name: /edit · b.ts/ }).textContent).toMatch(/\u22121/)
  })

  it('shows real closeout phases instead of thinking or stale git diff', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'closing', runId: 'r-close', name: 'general-purpose', task: 'pack',
      state: 'running', createdAt: now - 180_000, updatedAt: now - 130_000,
      listSubtitle: 'bash git diff HEAD -- a.ts', activityActive: true,
      diagnostics: {
        finalizationPhase: 'verifying',
        phaseSince: now - 12_000,
        watchdogDecision: 'tool-quiet-alive',
        cpuVerdict: 'working',
      },
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    const row = await screen.findByTestId('agent-row-closing')
    expect(row.textContent).toContain('收尾中：验证')
    expect(row.textContent).toContain('12s')
    expect(row.textContent).not.toContain('思考中')
    expect(row.textContent).not.toContain('无新进展')
    expect(row.textContent).not.toContain('git diff')
    expect(screen.getAllByText(/收尾中：验证/).length).toBeGreaterThan(0)
  })

  it('stops streaming a large expanded transcript once the final answer enters closeout', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'closing-report', runId: 'r-close-report', sessionId: 'session-1',
      name: 'explore', task: 'write a large report', state: 'running',
      createdAt: now - 180_000, updatedAt: now,
      diagnostics: { finalizationPhase: 'final-received', phaseSince: now - 2_000 },
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-closing-report')
    await waitFor(() => expect(harness.hasLogSubscriber('closing-report')).toBe(true))
    for (let index = 0; index < 56; index += 1) {
      harness.emitLog('closing-report', {
        type: 'agent_log', agentId: 'closing-report', runId: 'r-close-report', sessionId: 'session-1',
        itemType: 'tool', name: 'grep', text: `{"pattern":"evidence-${index}"}`, contentIndex: index * 2,
      })
      harness.emitLog('closing-report', {
        type: 'agent_log', agentId: 'closing-report', runId: 'r-close-report', sessionId: 'session-1',
        itemType: 'toolResult', name: 'grep', text: `match-${index}`, contentIndex: index * 2 + 1,
      })
    }
    harness.emitLog('closing-report', {
      type: 'agent_log', agentId: 'closing-report', runId: 'r-close-report', sessionId: 'session-1',
      itemType: 'text', text: `# Final report\n\n${'| source | finding |\n| --- | --- |\n| file | result |\n'.repeat(80)}`, contentIndex: 112,
    })

    const group = await screen.findByRole('button', { name: /个步骤/ })
    expect(group.closest('[data-activity-card]')?.getAttribute('data-activity-status')).toBe('ok')
    fireEvent.click(group)
    expect(screen.getAllByRole('button', { name: /^grep/ })).toHaveLength(20)
    expect(await screen.findByText('Final report')).toBeTruthy()
  })

  it('renders the secretary closeout summary as a structured card instead of raw key=value text', async () => {
    const harness = hostHarness()
    const finalResult = [
      'closeout=pass',
      'integration_verify=pass',
      'commit=created:a9b6c10959744a0f9b80453e5675c29d2900083',
      'committed_paths=["Electron/package.json","Electron/packages/pi-backend/src/index.ts"]',
      'remaining_dirty_paths=["AGENTS.md"]',
      'cleaned_branches=[]',
      'cleaned_worktrees=[]',
      'retained=[]',
      'needs_fixer=[]',
      'needs_user=[]',
      'docs_updated=[]',
      'residual_risks=[]',
    ].join('\n')
    harness.host.listAgents = async () => [{
      agentId: 'sec', runId: 'r-sec', sessionId: 'session-1', name: 'secretary', task: '提交 Git 扩展重构',
      state: 'ok', createdAt: 1, endedAt: 2, finalResult,
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} sessionId="session-1" />)
    // A single finished agent auto-renders its detail; no row click needed.
    const card = await screen.findByTestId('secretary-closeout-card')
    expect(card.textContent).toContain('收尾通过')
    expect(card.textContent).toContain('验证通过')
    expect(card.textContent).toContain('提交 a9b6c10959')
    expect(screen.getByText('Electron/package.json')).toBeTruthy()
    const transcript = document.querySelector('[data-testid="subagent-transcript"]')!
    expect(transcript.textContent).not.toContain('committed_paths=')
    expect(transcript.textContent).not.toContain('closeout=pass')
  })

  it('shows a blocked secretary commit as a warning card with retained items', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'sec2', runId: 'r-sec2', sessionId: 'session-1', name: 'secretary', task: '收尾',
      state: 'ok', createdAt: 1, endedAt: 2,
      finalResult: ['closeout=needs-action', 'integration_verify=fail', 'commit=blocked:dirty-index', 'committed_paths=[]', 'remaining_dirty_paths=[]', 'cleaned_branches=[]', 'cleaned_worktrees=[]', 'retained=[{"item":"wt-a","reason":"dirty"}]', 'needs_fixer=[]', 'needs_user=[]', 'docs_updated=[]', 'residual_risks=[]'].join('\n'),
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} sessionId="session-1" />)
    const card = await screen.findByTestId('secretary-closeout-card')
    expect(card.textContent).toContain('需处理')
    expect(card.textContent).toContain('验证失败')
    expect(card.textContent).toContain('提交受阻 · dirty-index')
    expect(card.textContent).toContain('wt-a — dirty')
  })

  it('renders a runtime-capped terminal tail as plain text', async () => {
    const harness = hostHarness()
    const retainedTail = ('| partial table cell | `unterminated inline code\n'.repeat(220)).slice(0, 8_000)
    harness.host.listAgents = async () => [{
      agentId: 'capped-tail', runId: 'r-capped-tail', sessionId: 'session-1',
      name: 'explore', task: 'long report', state: 'ok', finalResult: retainedTail,
      createdAt: 1, endedAt: 2,
    } as AgentSummary]

    render(<SubagentPanel host={harness.host} sessionId="session-1" />)

    const plain = await screen.findByTestId('subagent-final-result-plain')
    expect(plain.tagName).toBe('PRE')
    expect(plain.textContent).toBe(retainedTail)
    expect(plain.querySelector('.markdown')).toBeNull()
  })

  it('stalled list still shows closeout after final-received instead of ordinary stall copy', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'closing-stalled', runId: 'r-close-stalled', name: 'general-purpose', task: 'pack',
      state: 'stalled', stalled: true, stalledIdleSec: 90,
      createdAt: now - 180_000, updatedAt: now - 130_000,
      listSubtitle: 'bash git diff HEAD -- a.ts', activityActive: true,
      diagnostics: {
        finalizationPhase: 'post-verify',
        phaseSince: now - 8_000,
        watchdogDecision: 'first-stall-notify',
      },
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    const row = await screen.findByTestId('agent-row-closing-stalled')
    expect(row.textContent).toContain('收尾中：合并后验证')
    expect(row.textContent).toContain('8s')
    expect(row.textContent).not.toContain('卡住')
    expect(row.textContent).not.toContain('无新进展')
    expect(row.textContent).not.toContain('思考中')
    expect(screen.queryByLabelText('中止 general-purpose')).toBeNull()
  })

  it('stops closeout copy once the terminal state arrives', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'done', runId: 'r-done', name: 'general-purpose', task: 'pack',
      state: 'ok', createdAt: now - 20_000, updatedAt: now - 1_000, endedAt: now - 500,
      diagnostics: { finalizationPhase: 'done-await-host', phaseSince: now - 1_000, verifyElapsedMs: 800 },
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    const row = await screen.findByTestId('agent-row-done')
    expect(row.textContent).not.toContain('收尾中')
    expect(row.textContent).not.toContain('思考中')
  })

  it('clears a sticky 卡住 badge on running progress and terminal events, and re-flags a fresh stall', async () => {
    const harness = hostHarness()
    const base = { agentId: 'smoke', runId: 'r1', name: 'general-purpose', task: '真跑模型smoke', createdAt: Date.now() - 571_000 }
    harness.host.listAgents = async () => [{ ...base, state: 'stalled', stalled: true } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-smoke')
    expect(screen.getAllByText('卡住', { selector: '.stalled-badge' }).length).toBeGreaterThan(0)

    // Running progress without a stall flag clears the transient badge.
    harness.emitAgent({ type: 'agent', agent: { ...base, state: 'running' } as AgentSummary })
    await waitFor(() => expect(screen.queryByText('卡住', { selector: '.stalled-badge' })).toBeNull())
    expect(screen.getByTitle('运行中')).toBeTruthy()

    // The watchdog may re-flag a still-quiet worker with a fresh stall event.
    harness.emitAgent({ type: 'agent', agent: { ...base, state: 'stalled', stalled: true } as AgentSummary })
    await waitFor(() => expect(screen.getAllByText('卡住', { selector: '.stalled-badge' }).length).toBeGreaterThan(0))

    // A terminal event wins even when it arrives carrying a stale stalled:true flag.
    harness.emitAgent({ type: 'agent', agent: { ...base, state: 'ok', stalled: true, finalResult: '全部通过', endedAt: Date.now() } as AgentSummary })
    await waitFor(() => expect(screen.queryByText('卡住', { selector: '.stalled-badge' })).toBeNull())
    expect(screen.getByTitle('已完成')).toBeTruthy()
  })

  it('keeps a terminal verdict when a slower listAgents snapshot still shows the run as live', async () => {
    const harness = hostHarness()
    let resolveSnapshot!: (agents: AgentSummary[]) => void
    harness.host.listAgents = () => new Promise<AgentSummary[]>(resolve => { resolveSnapshot = resolve })
    render(<SubagentPanel host={harness.host} />)

    // The terminal event lands through the live subscription while listAgents() is in flight.
    harness.emitAgent({ type: 'agent', agent: { agentId: 'smoke', runId: 'r1', name: 'general-purpose', task: '真跑模型smoke', state: 'ok', createdAt: Date.now() - 9_000, endedAt: Date.now() - 8_000, finalResult: '全部通过' } as AgentSummary })

    // The snapshot was captured before the end event: same run, still running.
    await act(async () => resolveSnapshot([{ agentId: 'smoke', runId: 'r1', name: 'general-purpose', task: '真跑模型smoke', state: 'running', createdAt: 1_000, updatedAt: 1_500 } as AgentSummary]))
    expect(await screen.findByTitle('已完成')).toBeTruthy()
    expect(screen.queryByLabelText('中止 general-purpose')).toBeNull()
    expect(screen.queryByText('卡住', { selector: '.stalled-badge' })).toBeNull()

    // A late same-run stall event must not re-flag the finished run either.
    harness.emitAgent({ type: 'agent', agent: { agentId: 'smoke', runId: 'r1', name: 'general-purpose', task: '真跑模型smoke', state: 'stalled', stalled: true, createdAt: 2_500 } as AgentSummary })
    expect(screen.getByTitle('已完成')).toBeTruthy()
    expect(screen.queryByText('卡住', { selector: '.stalled-badge' })).toBeNull()
  })

  it('shows both runs of a re-dispatched agentId side by side and never drops the finished one', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    const base = { agentId: 'smoke', name: 'general-purpose', sessionId: 'session-1' }

    const now = Date.now()
    // First run finishes; the same semantic id is re-dispatched as a second run.
    harness.emitAgent({ type: 'agent', agent: { ...base, runId: 'r1', task: '第一轮任务', state: 'ok', createdAt: now - 6_000, endedAt: now - 5_000 } as AgentSummary })
    harness.emitAgent({ type: 'agent', agent: { ...base, runId: 'r2', task: '第二轮任务', state: 'running', createdAt: now } as AgentSummary })

    // Two rows: the completed r1 keeps its record while r2 runs beside it.
    expect(await screen.findByTestId('agent-row-smoke--r1')).toBeTruthy()
    expect(screen.getByTestId('agent-row-smoke--r1').textContent).toContain('第一轮任务')
    expect(screen.getByTitle('已完成')).toBeTruthy()
    const r2 = screen.getByTestId('agent-row-smoke--r2')
    expect(r2.textContent).toContain('第二轮任务')
    expect(screen.getByLabelText('中止 general-purpose')).toBeTruthy()

    // A late running/stalled event for r1 lands on r1's own row and cannot reopen it.
    harness.emitAgent({ type: 'agent', agent: { ...base, runId: 'r1', task: '第一轮任务', state: 'stalled', stalled: true, createdAt: now - 5_000 } as AgentSummary })
    expect(screen.getByTestId('agent-row-smoke--r1').textContent).not.toContain('卡住')
    expect(screen.getByTitle('已完成')).toBeTruthy()

    // When r2 completes too, BOTH records stay visible side by side.
    harness.emitAgent({ type: 'agent', agent: { ...base, runId: 'r2', task: '第二轮任务', state: 'ok', createdAt: now, endedAt: now + 1_000 } as AgentSummary })
    await waitFor(() => expect(within(screen.getByTestId('agent-row-smoke--r2')).getByTitle('已完成')).toBeTruthy())
    expect(screen.getByTestId('agent-row-smoke--r1')).toBeTruthy()
    expect(screen.queryByLabelText('中止 general-purpose')).toBeNull()
  })

  it('restores every retained run after a restart without collapsing fresh completions', async () => {
    const now = Date.now()
    let requestedScope: string | undefined
    const historyHost = hostHarness()
    historyHost.host.listAgents = vi.fn(async (_sessionId?: string, scope?: 'current' | 'history') => {
      requestedScope = scope
      return [
        { agentId: 'duo', runId: 'run-a', sessionId: 'session-1', name: 'explore', task: '早一轮任务', state: 'ok', createdAt: now - 6_000, endedAt: now - 5_000 },
        { agentId: 'duo', runId: 'run-b', sessionId: 'session-1', name: 'explore', task: '晚一轮任务', state: 'ok', createdAt: now - 2_000, endedAt: now - 1_000 },
        { agentId: 'solo', runId: 'run-c', sessionId: 'session-1', name: 'reviewer', task: '刚完成', state: 'ok', createdAt: now - 100, endedAt: now - 50 },
      ] as AgentSummary[]
    })
    renderSubagentPanel({ host: historyHost.host, sessionId: 'session-1' })

    // The panel hydrates from the durable full-run history, not one summary per slug.
    await waitFor(() => expect(requestedScope).toBe('history'))
    expect(await screen.findByTestId('agent-row-duo--run-a')).toBeTruthy()
    expect(screen.getByTestId('agent-row-duo--run-b').textContent).toContain('晚一轮任务')
    // Freshly settled rows stay inline right after load; nothing hides behind 历史.
    expect(screen.getByTestId('agent-row-solo')).toBeTruthy()
    expect(screen.queryByTestId('subagent-archive-toggle')).toBeNull()
  })

  it('清空 hides only plain terminal rows in the current view: stalled and pendingReview stay', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => []
    renderSubagentPanel({ host: harness.host, sessionId: 'session-1' })
    const now = Date.now()
    // A stalled live row and a terminal row whose worktree still owes the user a
    // merge/discard decision stay; a settled failed row with nothing pending hides.
    harness.emitAgent({ type: 'agent', agent: { agentId: 'stall-row', runId: 'r-s', sessionId: 'session-1', name: 'fixer', task: '卡住的任务', state: 'stalled', stalled: true, createdAt: now } as AgentSummary })
    harness.emitAgent({ type: 'agent', agent: { agentId: 'pr-row', runId: 'r-pr', sessionId: 'session-1', name: 'builder', task: '待善后任务', state: 'aborted', createdAt: now - 5_000, endedAt: now - 4_000 } as AgentSummary })
    harness.emitAgent({ type: 'worktree', status: { agentId: 'pr-row', runId: 'r-pr', sessionId: 'session-1', path: '/tmp/wt-pr', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })
    harness.emitAgent({ type: 'agent', agent: { agentId: 'done-row', runId: 'r-d', sessionId: 'session-1', name: 'explore', task: '已完成的记录', state: 'failed', createdAt: now - 9_000, endedAt: now - 8_000 } as AgentSummary })
    await screen.findByTestId('agent-row-stall-row')

    fireEvent.click(screen.getByText('清空'))
    expect(screen.getByTestId('agent-row-stall-row')).toBeTruthy()
    expect(screen.getByTestId('agent-row-pr-row')).toBeTruthy()
    expect(screen.queryByTestId('agent-row-done-row')).toBeNull()
  })

  it('清空 is view-only: switching sessions away and back restores the hidden rows', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = vi.fn(async (sid?: string): Promise<AgentSummary[]> =>
      sid === 'session-1'
        ? [
          { agentId: 'smoke', runId: 'r1', sessionId: 'session-1', name: 'general-purpose', task: '第一轮任务', state: 'ok', createdAt: now - 6_000, endedAt: now - 5_000 },
          { agentId: 'smoke', runId: 'r2', sessionId: 'session-1', name: 'general-purpose', task: '第二轮任务', state: 'running', createdAt: now },
        ]
        : [])
    const view = renderSubagentPanel({ host: harness.host, sessionId: 'session-1' })
    await screen.findByTestId('agent-row-smoke--r1')

    fireEvent.click(screen.getByText('清空'))
    expect(screen.queryByTestId('agent-row-smoke--r1')).toBeNull()
    expect(screen.getByTestId('agent-row-smoke--r2')).toBeTruthy() // running r2 stays

    // Nothing was deleted remotely: another session away and back reloads the
    // history scope and the cleared row is visible again.
    view.rerender(<Fixture host={harness.host} sessionId="session-2" />)
    await screen.findByText('还没有 subagent')
    view.rerender(<Fixture host={harness.host} sessionId="session-1" />)
    expect(await screen.findByTestId('agent-row-smoke--r1')).toBeTruthy()
  })

  it('keeps same agentId+runId episodes of DIFFERENT sessions apart in aggregate mode', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = vi.fn(async (): Promise<AgentSummary[]> => [
      { agentId: 'w', runId: 'r1', sessionId: 's-a', name: 'explore', task: '甲会话任务', state: 'failed', createdAt: now - 30_000, endedAt: now - 29_000 },
      { agentId: 'w', runId: 'r1', sessionId: 's-b', name: 'explore', task: '乙会话任务', state: 'running', createdAt: now },
    ])
    renderSubagentPanel({ host: harness.host })
    const rowWith = (text: string) => screen.getAllByTestId('agent-row-w--r1').find(row => row.textContent?.includes(text))
    await screen.findByText('乙会话任务')
    // Full episode identity means two DISTINCT rows — the old (agentId, runId)
    // upsert merged these two sessions into one row / collided their keys.
    expect(screen.getAllByTestId('agent-row-w--r1')).toHaveLength(2)
    const beforeA = rowWith('甲会话任务')!.textContent!
    const beforeB = rowWith('乙会话任务')!.textContent!
    // Updating s-b's episode must not repaint s-a's identical triple.
    harness.emitRawAgent({ type: 'agent', agent: { agentId: 'w', runId: 'r1', sessionId: 's-b', name: 'explore', task: '乙会话任务', state: 'aborted', createdAt: now } })
    await waitFor(() => expect(rowWith('乙会话任务')!.textContent).not.toBe(beforeB))
    expect(rowWith('甲会话任务')!.textContent).toBe(beforeA)
    expect(screen.getAllByTestId('agent-row-w--r1')).toHaveLength(2)
  })

  it('carries the exact episode identity on abort, resolve and manual check', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'fix-pill', runId: 'run-2', sessionId: 'session-9', name: 'fixer', title: 'Fix the pill', task: 'fix', state: 'running', createdAt: 1 },
    ]
    render(<SubagentPanel host={harness.host} sessionId="session-9" />)
    const row = await screen.findByTestId('agent-row-fix-pill')

    fireEvent.click(screen.getByLabelText('中止 fixer'))
    await waitFor(() => expect(harness.abortAgent).toHaveBeenCalledWith('session-9', 'fix-pill', 'run-2'))

    // Manual check from the technical details panel names the exact run it inspects.
    const detail = screen.getByTestId('subagent-detail-status-check')
    // The detail probe lives inside the collapsed technical <details>; open it first.
    const summary = detail.closest('details')?.querySelector('summary')
    if (summary) fireEvent.click(summary)
    fireEvent.click(detail)
    await waitFor(() => expect(harness.checkAgent).toHaveBeenCalledWith('session-9', 'fix-pill', 'run-2'))
    expect(row.textContent).toBeTruthy()
  })

  it('marks a failed episode handled with its exact session and run, and shows resolve failures', async () => {
    const harness = hostHarness()
    harness.resolveAgent = vi.fn(async () => { throw new Error('unknown episode session-x/fix-pill/run-stale') })
    harness.host.resolveAgent = harness.resolveAgent
    harness.host.listAgents = async () => [
      { agentId: 'fix-pill', runId: 'run-1', sessionId: 'session-9', name: 'fixer', title: 'Failed detail', task: 'fix', state: 'failed', createdAt: 1 },
    ]
    render(<SubagentPanel host={harness.host} sessionId="session-9" />)
    await screen.findByTestId('agent-row-fix-pill')

    fireEvent.click(screen.getByLabelText('标记 fixer 已处理'))
    await waitFor(() => expect(harness.resolveAgent).toHaveBeenCalledWith('session-9', 'fix-pill', 'run-1'))
    // Failure stays visible instead of dying as an unhandled rejection.
    expect(await screen.findByText(/unknown episode session-x\/fix-pill\/run-stale/)).toBeTruthy()
  })

  it('does not mark the newer run handled when a pending resolve was issued for the previous run', async () => {
    const harness = hostHarness()
    let releaseResolve!: () => void
    harness.resolveAgent = vi.fn(() => new Promise<void>(resolve => { releaseResolve = resolve }))
    harness.host.resolveAgent = harness.resolveAgent as typeof harness.host.resolveAgent
    harness.host.listAgents = async () => [
      { agentId: 'fix-pill', runId: 'run-1', sessionId: 'session-9', name: 'fixer', title: 'Retry slice', task: 'fix', state: 'failed', createdAt: 1 },
    ]
    render(<SubagentPanel host={harness.host} sessionId="session-9" />)
    await screen.findByTestId('agent-row-fix-pill')

    // Resolve run-1, and while it is still in flight the same slug starts run-2.
    fireEvent.click(screen.getByLabelText('标记 fixer 已处理'))
    await waitFor(() => expect(harness.resolveAgent).toHaveBeenCalledWith('session-9', 'fix-pill', 'run-1'))
    await act(async () => {
      harness.emitAgent({ type: 'agent', agent: { agentId: 'fix-pill', runId: 'run-2', sessionId: 'session-9', name: 'fixer', title: 'Retry slice', task: 'second attempt', state: 'running', createdAt: Date.now() - 1_000 } })
    })

    // Two rows now: run-2 keeps streaming live beside the failed run-1 record.
    const r2Row = await screen.findByTestId('agent-row-fix-pill--run-2')
    const r1Row = screen.getByTestId('agent-row-fix-pill--run-1')
    expect(r2Row.querySelector('[aria-label="中止 fixer"]')).toBeTruthy()
    expect(r2Row.querySelector('[aria-label="标记 fixer 已处理"]')).toBeNull()

    // The old request completes: only the exact (session, agent, run) triple it
    // named may be marked handled — the new run must stay unmarked.
    await act(async () => { releaseResolve() })
    await act(async () => {
      harness.emitAgent({ type: 'agent', agent: { agentId: 'fix-pill', runId: 'run-2', sessionId: 'session-9', name: 'fixer', title: 'Retry slice', task: 'second attempt', state: 'failed', createdAt: Date.now() - 1_000, endedAt: Date.now() } })
    })
    // run-1 resolves handled; run-2 reaches failed UNMARKED: its resolve button
    // is offered while run-1's is not.
    await waitFor(() => expect(within(r1Row).queryByLabelText('标记 fixer 已处理')).toBeNull())
    expect(within(r2Row).getByLabelText('标记 fixer 已处理')).toBeTruthy()
    expect(harness.resolveAgent).toHaveBeenCalledTimes(1)
  })

  it("drops a sibling-run log frame instead of painting it on the selected run", async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => []
    const now = Date.now()
    render(<SubagentPanel host={harness.host} sessionId="session-9" />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'smoke', runId: 'r1', sessionId: 'session-9', name: 'explore', task: '第一轮', state: 'running', createdAt: now - 4_000 } })
    await screen.findByTestId('agent-row-smoke')
    harness.emitAgent({ type: 'agent', agent: { agentId: 'smoke', runId: 'r2', sessionId: 'session-9', name: 'explore', task: '第二轮', state: 'running', createdAt: now } })
    await screen.findByTestId('agent-row-smoke--r2')
    fireEvent.click(screen.getByTestId('agent-row-smoke--r2').querySelector('.agent-select')!)
    await waitFor(() => expect(harness.hasLogSubscriber('smoke')).toBe(true))

    // The selected row is r2; a frame still tagged r1 belongs to its own episode
    // and must never land in r2's transcript.
    harness.emitLog('smoke', { type: 'agent_log', sessionId: 'session-9', agentId: 'smoke', runId: 'r1', itemType: 'text', text: 'OLD-RUN-FRAME', contentIndex: 0 })
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByText(/OLD-RUN-FRAME/)).toBeNull()
    // r2's own frame lands.
    harness.emitLog('smoke', { type: 'agent_log', sessionId: 'session-9', agentId: 'smoke', runId: 'r2', itemType: 'text', text: 'NEW-RUN-STREAM', contentIndex: 0 })
    expect(await screen.findByText(/NEW-RUN-STREAM/)).toBeTruthy()
    expect(screen.queryByText(/OLD-RUN-FRAME/)).toBeNull()
  })

  it('never repaints the current run\u2019s worktree badge from a retired run\u2019s event', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'wt-agent', runId: 'run-2', sessionId: 'session-9', name: 'builder', title: 'Rebuilt', task: 'build', state: 'running', createdAt: 2 },
    ]
    render(<SubagentPanel host={harness.host} sessionId="session-9" />)
    await screen.findByTestId('agent-row-wt-agent')

    // Current run's own badge lands.
    harness.emitAgent({ type: 'worktree', status: { agentId: 'wt-agent', sessionId: 'session-9', runId: 'run-2', lifecycle: 'active', merge: 'unavailable', discard: 'unavailable' } })
    await waitFor(() => expect(document.querySelector('.worktree-badge.active')).toBeTruthy())
    // A late badge from the retired run-1 must not repaint the row, in either direction.
    harness.emitAgent({ type: 'worktree', status: { agentId: 'wt-agent', sessionId: 'session-9', runId: 'run-1', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })
    expect(document.querySelector('.worktree-badge.pendingReview')).toBeNull()
    expect(document.querySelector('.worktree-badge.active')).toBeTruthy()
    // An identity-less status cannot be attributed to any episode: it is ignored
    // outright (no agentId fallback, no blank-identity repaint); the active badge stays.
    harness.emitAgent({ type: 'worktree', status: { agentId: 'wt-agent', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } as never })
    expect(document.querySelector('.worktree-badge.pendingReview')).toBeNull()
    expect(document.querySelector('.worktree-badge.active')).toBeTruthy()
  })

  it('ignores identity-less agent, worktree, and log events instead of matching by agentId', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} sessionId="session-9" />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'smoke', runId: 'r1', sessionId: 'session-9', name: 'explore', task: '当前运行', state: 'running', createdAt: 1 } })
    const row = await screen.findByTestId('agent-row-smoke')
    await waitFor(() => expect(harness.hasLogSubscriber('smoke')).toBe(true))

    // Identity-less agent event (same slug, no sessionId/runId): ignored — the row
    // keeps its current run, state, and task; no agentId-only fallback match.
    harness.emitRawAgent({ type: 'agent', agent: { agentId: 'smoke', name: 'explore', task: '幽灵任务', state: 'failed' } as AgentSummary })
    // A blank-string identity is just as identity-less: still ignored.
    harness.emitRawAgent({ type: 'agent', agent: { agentId: 'smoke', sessionId: '', runId: '', name: 'explore', task: '空标识任务', state: 'ok' } as AgentSummary })
    // Identity-less worktree status: no badge appears on the row.
    harness.emitRawAgent({ type: 'worktree', status: { agentId: 'smoke', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } as never })
    // Identity-less log event: dropped by the strict batch match, never appended.
    harness.emitRawLog('smoke', { type: 'agent_log', agentId: 'smoke', itemType: 'text', text: 'GHOST-LOG' })
    // A log event for a DIFFERENT run of the same slug is equally foreign.
    harness.emitRawLog('smoke', { type: 'agent_log', sessionId: 'session-9', agentId: 'smoke', runId: 'r-other', itemType: 'text', text: 'OTHER-RUN-LOG' })

    expect(row.textContent).toContain('当前运行')
    expect(row.textContent).not.toContain('幽灵任务')
    expect(row.textContent).not.toContain('空标识任务')
    expect(document.querySelector('.worktree-badge')).toBeNull()
    await waitFor(() => {
      expect(screen.queryByText(/GHOST-LOG/)).toBeNull()
      expect(screen.queryByText(/OTHER-RUN-LOG/)).toBeNull()
    })
    // The row itself is untouched: still running with its exact identity.
    expect((screen.getByLabelText('中止 explore') as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders an identity-less snapshot row inert: no controls, no log subscription, no host reads', async () => {
    const harness = hostHarness()
    // A host snapshot row without a sessionId: displayable, but it has no exact
    // episode identity, so nothing episode-scoped may be issued on its behalf.
    harness.host.listAgents = async () => [
      { agentId: 'noid', runId: 'r9', name: 'explore', title: '无会话标识', task: '缺少会话标识的任务', state: 'running', createdAt: 1 },
    ]
    render(<SubagentPanel host={harness.host} />)
    const row = await screen.findByTestId('agent-row-noid')
    expect(row.textContent).toContain('无会话标识')

    // Stop control rendered but disabled; a forced click still issues no host call
    // (the handler itself is inert, not just the button).
    const stop = screen.getByLabelText('中止 explore')
    expect((stop as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(stop)
    expect(harness.abortAgent).not.toHaveBeenCalled()

    // No log subscription is registered for the identity-less row and no cached
    // transcript is fetched: both would address a blank episode key.
    await act(async () => { await Promise.resolve() })
    expect(harness.hasLogSubscriber('noid')).toBe(false)
    expect(harness.getAgentLogs).not.toHaveBeenCalled()

    // The detail pane obeys the same rule: the manual status probe is disabled.
    fireEvent.click(row.querySelector('.agent-select')!)
    await waitFor(() => expect(row.querySelector('.agent-select')?.getAttribute('aria-pressed')).toBe('true'))
    expect((screen.getByTestId('subagent-detail-status-check') as HTMLButtonElement).disabled).toBe(true)
    // The explicit history view is not offered for an identity-less row.
    expect(screen.queryByText('查看全部运行历史')).toBeNull()
  })

  it('loads run-scoped cached logs by default and the cross-run history only through the explicit view', async () => {
    const harness = hostHarness()
    const getAgentLogs = vi.fn(async (_agentId: string, _session: string, runId: string, scope?: 'run' | 'agent') =>
      scope === 'agent'
        ? [{ itemType: 'text' as const, text: 'OLD-RUN-EVIDENCE' }, { itemType: 'text' as const, text: 'CURRENT-RUN-EVIDENCE' }]
        : runId === 'run-2' ? [{ itemType: 'text' as const, text: 'CURRENT-RUN-EVIDENCE' }] : [])
    harness.host.getAgentLogs = getAgentLogs
    harness.host.listAgents = async () => [
      { agentId: 'logs', runId: 'run-2', sessionId: 'session-9', name: 'explore', title: 'Research', task: 'research', state: 'failed', createdAt: 2 },
    ]
    render(<SubagentPanel host={harness.host} sessionId="session-9" />)
    await screen.findByTestId('agent-row-logs')

    // Default: the exact run's cached transcript — never the old run's tool logs.
    expect(await screen.findByText('CURRENT-RUN-EVIDENCE')).toBeTruthy()
    expect(screen.queryByText('OLD-RUN-EVIDENCE')).toBeNull()
    expect(getAgentLogs).toHaveBeenCalledWith('logs', 'session-9', 'run-2')
    expect(getAgentLogs).not.toHaveBeenCalledWith('logs', 'session-9', 'run-2', 'agent')

    // The explicit history view is labeled and clearly separated.
    fireEvent.click(await screen.findByText('查看全部运行历史'))
    expect(await screen.findByText('OLD-RUN-EVIDENCE')).toBeTruthy()
    expect(getAgentLogs).toHaveBeenCalledWith('logs', 'session-9', 'run-2', 'agent')
    expect(screen.getByTestId('agent-log-scope').textContent).toContain('全部运行历史')

    // Back to the current run: the old run's logs are gone again.
    fireEvent.click(screen.getByText('仅看当前运行'))
    await waitFor(() => expect(screen.queryByText('OLD-RUN-EVIDENCE')).toBeNull())
    expect(screen.getByText('CURRENT-RUN-EVIDENCE')).toBeTruthy()
  })

  it('discards a manual-check response that resolves after the session switched away', async () => {
    const harness = hostHarness()
    const now = Date.now()
    let resolveCheck!: (update: AgentSummary) => void
    let resolveB!: (agents: AgentSummary[]) => void
    let checkAgentId = ''
    harness.host.checkAgent = (_sessionId: string, agentId: string) => {
      checkAgentId = agentId
      return new Promise<AgentSummary>(resolve => { resolveCheck = resolve })
    }
    harness.host.listAgents = vi.fn((id?: string) => id === 'B'
      ? new Promise<AgentSummary[]>(resolve => { resolveB = resolve })
      : Promise.resolve([{ agentId: 'worker-a', runId: 'ra', name: 'explore', task: 'A 的任务', state: 'running', sessionId: 'A', createdAt: now, updatedAt: now } as AgentSummary]))
    const view = render(<Fixture host={harness.host} sessionId="A" />)
    await screen.findByTestId('agent-row-worker-a')
    fireEvent.click(screen.getByText('技术详情'))
    fireEvent.click(screen.getByTestId('subagent-detail-status-check'))
    expect(checkAgentId).toBe('worker-a')

    // Switch to session B while the probe response is still pending.
    view.rerender(<Fixture host={harness.host} sessionId="B" />)
    await act(async () => resolveB([{ agentId: 'worker-b', runId: 'rb', name: 'explore', task: 'B 的任务', state: 'running', sessionId: 'B', createdAt: now, updatedAt: now } as AgentSummary]))
    expect(await screen.findByTestId('agent-row-worker-b')).toBeTruthy()

    // Session A's probe response arrives late: it must not write into B's list.
    await act(async () => resolveCheck({ agentId: 'worker-a', runId: 'ra', name: 'explore', task: 'A 的任务', state: 'ok', sessionId: 'A', createdAt: now, updatedAt: now, endedAt: now } as AgentSummary))
    expect(screen.queryByTestId('agent-row-worker-a')).toBeNull()
    expect(screen.getByTestId('agent-row-worker-b').textContent).toContain('B 的任务')
    expect(screen.getByTitle('运行中')).toBeTruthy()

    // Switching back to A re-hydrates from A's own snapshot/live — never from the stale probe.
    view.rerender(<Fixture host={harness.host} sessionId="A" />)
    await waitFor(() => expect(screen.getByTestId('agent-row-worker-a')).toBeTruthy())
    expect(screen.getByTitle('运行中')).toBeTruthy()
    expect(screen.queryByTitle('已完成')).toBeNull()
  })

  it('discards a manual-check response for the same agentId after the session switched away', async () => {
    const harness = hostHarness()
    const now = Date.now()
    let resolveCheck!: (update: AgentSummary) => void
    harness.host.checkAgent = () => new Promise<AgentSummary>(resolve => { resolveCheck = resolve })
    const row = (sessionId: string, task: string, state: AgentSummary['state'] = 'running') =>
      ({ agentId: 'shared-worker', runId: `run-${sessionId}`, name: 'explore', task, state, sessionId, createdAt: now, updatedAt: now } as AgentSummary)
    harness.host.listAgents = vi.fn((id?: string) => Promise.resolve(id === 'B' ? [row('B', 'B 的任务')] : [row('A', 'A 的任务')]))
    const view = render(<Fixture host={harness.host} sessionId="A" />)
    await screen.findByTestId('agent-row-shared-worker')
    fireEvent.click(screen.getByText('技术详情'))
    fireEvent.click(screen.getByTestId('subagent-detail-status-check'))

    view.rerender(<Fixture host={harness.host} sessionId="B" />)
    await waitFor(() => expect(screen.getByTestId('agent-row-shared-worker').textContent).toContain('B 的任务'))

    // The stale A probe reports the same agentId as terminal — it must not overwrite B's live row.
    await act(async () => resolveCheck(row('A', 'A 的任务', 'ok')))
    expect(screen.getByTestId('agent-row-shared-worker').textContent).toContain('B 的任务')
    expect(screen.getByTitle('运行中')).toBeTruthy()
    expect(screen.queryByTitle('已完成')).toBeNull()
  })

  it('applies a same-session manual-check response through the snapshot merge path', async () => {
    const harness = hostHarness()
    const now = Date.now()
    let resolveCheck!: (update: AgentSummary) => void
    harness.host.checkAgent = () => new Promise<AgentSummary>(resolve => { resolveCheck = resolve })
    harness.host.listAgents = async () => [
      { agentId: 'worker-1', runId: 'r1', sessionId: 'session-1', name: 'explore', task: 'look around', state: 'running', createdAt: now, updatedAt: now },
    ]
    render(<SubagentPanel host={harness.host} />)
    await screen.findByTestId('agent-row-worker-1')
    fireEvent.click(screen.getByText('技术详情'))
    fireEvent.click(screen.getByTestId('subagent-detail-status-check'))

    // The same session's probe verdict updates the row: snapshot precedence, no cross-run switch.
    await act(async () => resolveCheck({ agentId: 'worker-1', runId: 'r1', name: 'explore', task: 'look around', state: 'ok', createdAt: now, updatedAt: now, endedAt: now } as AgentSummary))
    expect(await screen.findByTitle('已完成')).toBeTruthy()
    expect(screen.queryByLabelText('中止 explore')).toBeNull()
  })
})

describe('agentDisplayName identity pollution', () => {
  it('prefers the stable worker role over a tool-polluted name', () => {
    expect(agentDisplayName({ agentId: 'a1', name: 'bash', role: 'general-purpose' })).toBe('general-purpose')
    expect(agentDisplayName({ agentId: 'a2', name: 'grep', role: 'explore' })).toBe('explore')
    expect(agentDisplayName({ agentId: 'a3', name: 'read', role: 'explore' })).toBe('explore')
  })

  it('shows the role for any unknown or future tool-style name — no blocklist involved', () => {
    expect(agentDisplayName({ agentId: 'a1', name: 'mcp__server__thing', role: 'explore' })).toBe('explore')
    expect(agentDisplayName({ agentId: 'a2', name: 'future_unknown_tool', role: 'general-purpose' })).toBe('general-purpose')
  })

  it('falls back to name only when role is missing, then to the agent id', () => {
    expect(agentDisplayName({ agentId: 'a1', name: 'quota-pill' })).toBe('quota-pill')
    // A custom agent that wants its own label carries it as an explicit role.
    expect(agentDisplayName({ agentId: 'a2', name: 'irrelevant', role: 'quota-pill' })).toBe('quota-pill')
    expect(agentDisplayName({ agentId: 'a3', name: 'grep' })).toBe('grep')
    expect(agentDisplayName({ agentId: 'a4', name: '', role: 'reviewer' })).toBe('reviewer')
    expect(agentDisplayName({ agentId: 'a5', name: '', role: '' })).toBe('a5')
  })

  it('renders the worker type in list rows for tool-polluted summaries (user screenshot)', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'polluted-bash', runId: 'r1', name: 'bash', role: 'general-purpose', title: '继续排查假卡住', task: '继续排查假卡住', state: 'running', createdAt: 1 },
      { agentId: 'polluted-grep', runId: 'r2', name: 'grep', role: 'explore', title: '重查 stalled 状态链', task: '重查 stalled 状态链', state: 'running', createdAt: 2 }
    ] as AgentSummary[]
    render(<SubagentPanel host={harness.host} />)

    const bashRow = await screen.findByTestId('agent-row-polluted-bash')
    expect(bashRow.querySelector('strong')?.textContent).toBe('general-purpose')
    expect(bashRow.querySelector('strong')?.textContent).not.toBe('bash')
    expect(bashRow.textContent).toContain('继续排查假卡住')

    const grepRow = screen.getByTestId('agent-row-polluted-grep')
    expect(grepRow.querySelector('strong')?.textContent).toBe('explore')
    expect(grepRow.querySelector('strong')?.textContent).not.toBe('grep')
    expect(grepRow.textContent).toContain('重查 stalled 状态链')
  })
})

describe('parseCloseoutSummary', () => {
  const fullBlock = [
    'closeout=pass',
    'integration_verify=pass',
    'commit=created:a9b6c10959744a0f9b80453e5675c29d2900083',
    'committed_paths=["a.ts","b.ts"]',
    'remaining_dirty_paths=[]',
    'cleaned_branches=["pipiui/wt-a"]',
    'cleaned_worktrees=[]',
    'retained=[]',
    'needs_fixer=[]',
    'needs_user=[]',
    'docs_updated=[]',
    'residual_risks=[]',
  ].join('\n')

  it('parses the block and splits surrounding prose', () => {
    const parsed = parseCloseoutSummary(`收尾完成。\n\n${fullBlock}\n\n以上。`)
    expect(parsed).toBeTruthy()
    expect(parsed!.preamble).toBe('收尾完成。')
    expect(parsed!.remainder).toBe('以上。')
    expect(parsed!.summary.closeout).toBe('pass')
    expect(parsed!.summary.integrationVerify).toBe('pass')
    expect(parsed!.summary.commit).toBe('created:a9b6c10959744a0f9b80453e5675c29d2900083')
    expect(parsed!.summary.committedPaths).toEqual(['a.ts', 'b.ts'])
    expect(parsed!.summary.cleanedBranches).toEqual(['pipiui/wt-a'])
  })

  it('ignores a fenced code block quoting the contract template', () => {
    const parsed = parseCloseoutSummary(['说明：', '', '```', 'closeout=pass | needs-action | blocked', 'integration_verify=pass | fail | none', 'committed_paths=[]', '```'].join('\n'))
    expect(parsed).toBeNull()
  })

  it('takes the concrete value when the template alternatives are echoed', () => {
    const parsed = parseCloseoutSummary(['closeout=needs-action | pass | blocked', 'integration_verify=none | pass | fail', 'commit=not-required', 'committed_paths=[]'].join('\n'))
    expect(parsed?.summary.closeout).toBe('needs-action')
    expect(parsed?.summary.integrationVerify).toBe('none')
    expect(parsed?.summary.commit).toBe('not-required')
  })

  it('keeps non-JSON list values readable instead of throwing', () => {
    const parsed = parseCloseoutSummary(['closeout=blocked', 'integration_verify=fail', 'commit=blocked:stage-failed', 'committed_paths=not-json', 'retained=[{item:wt,reason:dirty}]'].join('\n'))
    expect(parsed?.summary.committedPaths).toEqual(['not-json'])
    expect(parsed?.summary.retained).toEqual([{ item: '[{item:wt,reason:dirty}]' }])
  })

  it('returns null for ordinary prose', () => {
    expect(parseCloseoutSummary('任务已完成，全部测试通过。')).toBeNull()
    expect(parseCloseoutSummary('')).toBeNull()
  })
})
