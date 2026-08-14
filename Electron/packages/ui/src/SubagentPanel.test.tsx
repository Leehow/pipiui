// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState, type ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSummary, PipiHostAPI } from '@pipi/host-api'
import { SubagentPanel } from './SubagentPanel'

afterEach(() => {
  cleanup()
  document.querySelectorAll('.jsdom-header-slot').forEach(el => el.remove())
  localStorage.removeItem('pipiui:subagent-list-ratio')
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
  const abortAgent = vi.fn(async () => undefined)
  const resolveAgent = vi.fn(async () => undefined)
  const checkAgent = vi.fn(async (agentId: string) => ({ agentId, runId: 'checked', name: 'explore', task: '', state: 'running' as const }))
  const mergeWorktree = vi.fn(async agentId => ({ agentId, lifecycle: 'merged' as const, merge: 'merged' as const, discard: 'unavailable' as const }))
  const discardWorktree = vi.fn(async agentId => ({ agentId, lifecycle: 'discarded' as const, merge: 'unavailable' as const, discard: 'discarded' as const }))
  const host = {
    protocolVersion: 2,
    listAgents: async () => [],
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
    hasLogSubscriber: (id: string) => logs.has(id),
    emitAgent: (event: AgentEvent) => agents?.(event),
    emitLog: (id: string, event: Extract<AgentEvent, { type: 'agent_log' }>) => logs.get(id)?.(event)
  }
}

function expandTranscriptCards() {
  for (let pass = 0; pass < 4; pass += 1) {
    const collapsed = screen.queryAllByRole('button').filter(button => button.getAttribute('aria-expanded') === 'false' && button.closest('[data-activity-card]'))
    if (!collapsed.length) break
    collapsed.forEach(button => fireEvent.click(button))
  }
}

describe('SubagentPanel', () => {

  it('opens a Markdown reference against the selected agent worktree before the project path', async () => {
    const harness = hostHarness()
    const onOpenDocument = vi.fn()
    render(<SubagentPanel host={harness.host} projectPath="/projects/main" onOpenDocument={onOpenDocument} />)
    await screen.findByText('还没有 subagent')

    harness.emitAgent({ type: 'agent', agent: { agentId: 'docs', runId: 'docs-run', name: 'reviewer', task: 'write docs', state: 'ok', createdAt: 1, finalResult: 'Result: [report](docs/report.md)' } })
    harness.emitAgent({ type: 'worktree', status: { agentId: 'docs', path: '/worktrees/docs', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })

    const card = await screen.findByRole('button', { name: '打开文档 report.md' })
    expect(card.textContent).toContain('/worktrees/docs/docs/report.md')
    fireEvent.click(card)
    expect(onOpenDocument).toHaveBeenCalledWith('/worktrees/docs/docs/report.md')
  })

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
    await waitFor(() => expect(harness.resolveAgent).toHaveBeenCalledWith('failed'))
    await waitFor(() => expect(screen.queryByLabelText('标记 failed 已处理')).toBeNull())
  })

  it('explains a pre-spawn worktree failure in Chinese above the raw stderr', async () => {
    const harness = hostHarness()
    const reason = 'writable isolation requires a git work tree; refusing shared-cwd fallback'
    render(<SubagentPanel host={harness.host} projectPath="/projects/main" />)
    await screen.findByText('还没有 subagent')

    harness.emitAgent({
      type: 'agent',
      agent: {
        agentId: 'iso', runId: 'r-iso', name: 'builder', task: '改布局', state: 'failed', createdAt: 0, endedAt: 1_000,
        finalResult: `Writable subagent isolation failed before spawn: ${reason}`, worktreeError: reason
      }
    })
    const row = await screen.findByTestId('agent-row-iso')
    fireEvent.click(row.querySelector('.agent-select')!)

    expect(await screen.findByText('无法创建隔离工作区：该项目不在 Git 仓库中（或 Git 不可用），可写工人不能并行改文件。可在项目根目录执行 git init 后重试，或让主管改用只读工人 / 串行完成。')).toBeTruthy()
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
    expect(listAgents).toHaveBeenLastCalledWith('selected-other')

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
    expect(listAgents).toHaveBeenLastCalledWith('owner-session')

    view.rerender(<Fixture host={harness.host} sessionId="another-current-session" />)
    await waitFor(() => expect(screen.queryByTestId('agent-row-electron-ui-acceptance')).toBeNull())
    expect(await screen.findByText('还没有 subagent')).toBeTruthy()
    expect(screen.getByText('0 个')).toBeTruthy()
    expect(listAgents).toHaveBeenLastCalledWith('another-current-session')
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

  it('localizes known task, activity, and profile labels while preserving raw tool details', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [
      { agentId: 'fixture', runId: 'r1', name: 'builder', task: 'Build fixture', state: 'ok', createdAt: 1 },
      { agentId: 'round-two', runId: 'r2', name: 'explore', task: 'same-task round 2', state: 'ok', createdAt: 2 },
      { agentId: 'profile', runId: 'r3', name: 'general-purpose', task: 'profile-first-ok', state: 'ok', createdAt: 3 },
      { agentId: 'leader', runId: 'r4', name: 'computer-use-leader', task: 'Computer Use Leader', state: 'ok', createdAt: 4 },
      { agentId: 'tools', runId: 'r5', name: 'computer-terminal', task: 'terminal_file_status {"path":"/tmp/raw fixture.txt"}', state: 'running', createdAt: 5 }
    ]
    render(<SubagentPanel host={harness.host} />)

    expect(await screen.findByText('构建测试夹具')).toBeTruthy()
    expect(screen.getByText('同一任务第 2 轮')).toBeTruthy()
    expect(screen.getByText('优先恢复配置验证成功')).toBeTruthy()
    expect(screen.getByText('协调并核验桌面操作任务')).toBeTruthy()
    expect(screen.getAllByText('执行受限终端步骤').length).toBeGreaterThan(0)
    expect(screen.queryByText('构建')).toBeNull()
    expect(screen.queryByText('探索')).toBeNull()

    await waitFor(() => expect(harness.hasLogSubscriber('tools')).toBe(true))
    harness.emitLog('tools', { type: 'agent_log', agentId: 'tools', itemType: 'tool', name: 'terminal_read_file', text: '{"path":"/tmp/raw fixture.txt","line_start":2}' })
    harness.emitLog('tools', { type: 'agent_log', agentId: 'tools', itemType: 'toolResult', name: 'terminal_read_file', text: '{"path":"/tmp/raw fixture.txt","line_start":2}' })
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
    expect(detail.textContent).toContain('jellytoken')
    expect(detail.textContent).toContain('volcengine/deepseek-v4-flash')
    expect(detail.textContent).toContain('session-exact-123')
    expect(detail.textContent).toContain('审查')
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

  it('renders lifecycle counts and routes abort to the host', async () => {
    const harness = hostHarness()
    renderSubagentPanel({ host: harness.host })
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running', cost: .2 } })
    harness.emitAgent({ type: 'agent', agent: { agentId: 'bad', runId: 'r2', name: 'review', task: 'verify', state: 'failed', cost: .1 } })
    await screen.findByText('2 个')
    expect(screen.getByText('1 运行中')).toBeTruthy()
    expect(screen.getByText('1 失败')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('中止 explore'))
    await waitFor(() => expect(harness.abortAgent).toHaveBeenCalledWith('run'))
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

  it('distinguishes a quiet Computer Worker from healthy indeterminate progress', async () => {
    const harness = hostHarness()
    const now = Date.now()
    harness.host.listAgents = async () => [{
      agentId: 'quiet-operator', runId: 'r-quiet', name: 'operator', task: '在 TextEdit 中打开文件',
      state: 'running', createdAt: now - 60_000, updatedAt: now - 45_000,
      deadlineAt: now + 105_000, listSubtitle: 'desktop_act {"actions":[{"type":"key","keys":["CMD","O"]}]}'
    } as AgentSummary]
    render(<SubagentPanel host={harness.host} />)

    await screen.findByTestId('agent-row-quiet-operator')
    expect(screen.getAllByText(/等待工具返回 · desktop_act/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/45 秒无新进展/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/105 秒后自动中止/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/可能卡住/).length).toBeGreaterThan(0)
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
    harness.host.listAgents = async () => [{ agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' }]
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

  it('keeps a narrow detail pane readable and reveals exact metadata only after opening technical details', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'narrow', runId: 'r1', name: 'reviewer', title: '中文任务简介', task: 'RAW_PROMPT /tmp/exact path',
      state: 'ok', createdAt: 1, endedAt: 2, provider: 'jellytoken', model: 'volcengine/deepseek-v4-flash',
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
    expect(detail.querySelector('.agent-detail-header')?.textContent).not.toMatch(/jellytoken|deepseek|session-raw|ctx|cache|RAW_PROMPT|FULL_RAW_ERROR/)

    fireEvent.click(screen.getByText('技术详情'))
    expect(technical.open).toBe(true)
    expect(technical.textContent).toContain('jellytoken')
    expect(technical.textContent).toContain('volcengine/deepseek-v4-flash')
    expect(technical.textContent).toContain('session-raw-exact')
    expect(technical.textContent).toContain('RAW_PROMPT /tmp/exact path')
    expect(technical.textContent).toContain('FULL_RAW_ERROR exact')
    expect(technical.textContent).toMatch(/ctx 120|in 80|out 40|cache 20/)
  })

  it('matches the Swift hierarchy while rendering detail through the shared assistant transcript', async () => {
    const harness = hostHarness()
    harness.host.listAgents = async () => [{
      agentId: 'fa0238aa', runId: 'r1', name: 'computer-use-leader', task: 'Computer Use Leader {"goal":"raw english goal"}',
      title: '整理桌面交付结果', state: 'ok', createdAt: 1, endedAt: 2, finalResult: '中文最终结论',
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

  it('hides generated agent ids, uses real provider marks, localizes the desktop leader, and fills TLDR from the latest result', async () => {
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
    expect(leader.textContent).toContain('协调并核验桌面操作任务')
    expect(leader.textContent).not.toContain('Give the main agent')

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
    await screen.findByTestId('agent-row-root')
    harness.emitAgent({ type: 'worktree', status: { agentId: 'root', lifecycle: 'pendingReview', merge: 'ready', discard: 'ready' } })
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
        listSubtitle: 'bash npm test --workspaces',
      },
    })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'thinking', text: 'run the suite' })
    harness.emitLog('run', { type: 'agent_log', agentId: 'run', itemType: 'tool', name: 'bash', text: 'npm test --workspaces' })

    const active = await screen.findByTestId('active-tool')
    expect(active.querySelector('b')?.textContent).toBe('bash · npm test --workspaces')
    expect(active.textContent).toContain('运行中')
    expect(screen.getAllByText(/等待工具返回 · bash · npm test --workspaces/).length).toBeGreaterThan(0)
    expect(screen.queryByText('输入')).toBeNull()
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

    await screen.findByRole('button', { name: /个步骤/ })
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
    await screen.findByRole('button', { name: /1 个步骤 · Thinking/ })
    expect(screen.getByText('{"step": 1}')).toBeTruthy()
    const thinkingCard = screen.getByRole('button', { name: /^Thinking/ })
    fireEvent.click(thinkingCard)
    expect(await screen.findByText('plan')).toBeTruthy()
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

    await screen.findByRole('button', { name: /4 个步骤/ })
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

  it('starts a fresh log row for a new run instead of rewriting the previous run row', async () => {
    const harness = hostHarness()
    render(<SubagentPanel host={harness.host} />)
    harness.emitAgent({ type: 'agent', agent: { agentId: 'run', runId: 'r1', name: 'explore', task: 'research', state: 'running' } })
    await screen.findByTestId('agent-row-run')
    await waitFor(() => expect(harness.hasLogSubscriber('run')).toBe(true))
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
      { agentId: 'worker-1', runId: 'r1', name: 'explore', task: 'look around', state: 'running', createdAt: now, updatedAt: now },
    ]
    const onManualStatusCheck = vi.fn()
    render(<SubagentPanel host={harness.host} onManualStatusCheck={onManualStatusCheck} />)

    await screen.findByTestId('agent-row-worker-1')
    fireEvent.click(screen.getByText('技术详情'))
    fireEvent.click(screen.getByTestId('subagent-detail-status-check'))
    expect(onManualStatusCheck).toHaveBeenCalledWith(['worker-1'])
    expect(harness.checkAgent).toHaveBeenCalledWith('worker-1')
  })
})
