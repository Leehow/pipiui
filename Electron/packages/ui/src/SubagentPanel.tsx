import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import { ActivityCard } from './ActivityCard'
import { toolArgsSummary } from './tool-summary'
import { DismissibleError } from './DismissibleError'
import type { AgentEvent, AgentState, AgentSummary, CostUnit, PipiHostAPI, WorktreeStatus } from '@pipi/host-api'

type Log = {
  id: number
  itemType: 'text' | 'thinking' | 'tool' | 'toolResult'
  text: string
  name?: string
  isError?: boolean
  /** Runtime log_delta key (cumulative snapshot upsert); undefined for terminal `log` batches. */
  contentIndex?: number
}
type Agent = AgentSummary & {
  startedAt: number
  endedAt?: number
  logs: Log[]
  worktree?: WorktreeStatus
  handled?: boolean
}
type Pricing = { unit: CostUnit; exchangeRate: number }

const splitKey = 'pipiui:subagent-list-ratio'
const pageSize = 30
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const terminalIcon: Record<AgentState, string> = { running: '◌', stalled: '!', ok: '✓', failed: '×', aborted: '■', interrupted: '⚡' }

function initialRatio() {
  const value = Number(localStorage.getItem(splitKey))
  return Number.isFinite(value) ? clamp(value, .25, .75) : .48
}

function isActive(agent: Pick<Agent, 'state'>) {
  return agent.state === 'running'
}

function stateText(agent: Agent) {
  return agent.stalled || agent.state === 'stalled'
    ? '卡住'
    : ({ running: '运行中', ok: '已完成', failed: '失败', aborted: '已中止', interrupted: '已中断', stalled: '卡住' }[agent.state])
}

function duration(agent: Agent, now: number) {
  return `${Math.max(0, Math.round(((agent.endedAt ?? now) - agent.startedAt) / 1000))}s`
}

function completedAt(endedAt?: number) {
  if (!endedAt) return '完成'
  try {
    return new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }).format(endedAt)
  } catch {
    return new Date(endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }
}

function pricingFor(agents: Agent[]): Pricing {
  const source = agents.find(agent => agent.costUnit || Number.isFinite(agent.exchangeRate))
  const exchangeRate = source?.exchangeRate
  return {
    unit: source?.costUnit === 'CNY' ? 'CNY' : 'USD',
    exchangeRate: Number.isFinite(exchangeRate) && exchangeRate! > 0 ? exchangeRate! : 7.2
  }
}

function spend(cost: number | undefined, pricing: Pricing, includeConversion = false) {
  if (!cost || cost <= 0) return ''
  const usd = `$${cost.toFixed(2)} USD`
  const cny = `¥${(cost * pricing.exchangeRate).toFixed(2)} CNY`
  const primary = pricing.unit === 'CNY' ? cny : usd
  return includeConversion ? `${primary} · ${pricing.unit === 'CNY' ? usd : cny}` : primary
}

function formatTokens(value: number | undefined) {
  if (!value || value <= 0) return ''
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function preview(value: string, fallback = '无内容') {
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact ? `${compact.slice(0, 72)}${compact.length > 72 ? '…' : ''}` : fallback
}

function providerLabel(agent: Agent) {
  return agent.provider || agent.model?.split('/')[0] || 'pi'
}

function modelLabel(agent: Agent) {
  const model = agent.model?.trim()
  if (!model) return ''
  return model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
}

function worktreeBadge(status: WorktreeStatus | undefined, active: boolean) {
  if (!status) return null
  switch (status.lifecycle) {
    case 'pendingReview': return { text: '审核', lifecycle: status.lifecycle }
    case 'merged': return { text: '已合并', lifecycle: status.lifecycle }
    case 'mergedCleanupPending': return { text: '待善后', lifecycle: status.lifecycle }
    case 'discarded': return { text: '已丢弃', lifecycle: status.lifecycle }
    case 'active': return active ? { text: 'wt', lifecycle: status.lifecycle } : null
    case 'none': return status.path ? { text: 'wt', lifecycle: status.lifecycle } : null
  }
}

function worktreeText(status?: WorktreeStatus) {
  if (!status) return null
  return ({
    active: '工作中',
    pendingReview: '审核中',
    merged: '已合并',
    mergedCleanupPending: '已合并·待善后',
    discarded: '已丢弃',
    none: status.path ? '工作树' : ''
  }[status.lifecycle])
}

function treeOrder(agents: Agent[]) {
  const byParent = new Map<string, Agent[]>()
  const ids = new Set(agents.map(agent => agent.agentId))
  for (const agent of agents) {
    const parent = agent.parentId && ids.has(agent.parentId) ? agent.parentId : ''
    byParent.set(parent, [...(byParent.get(parent) ?? []), agent])
  }
  const order: Agent[] = []
  const visit = (parent: string) => {
    for (const agent of (byParent.get(parent) ?? []).sort((a, b) => a.startedAt - b.startedAt)) {
      order.push(agent)
      visit(agent.agentId)
    }
  }
  visit('')
  return order
}

export function SubagentPanel({ host, sessionId, retainedWorktreeDispositionAvailable = false, onRunningChange }: { host: PipiHostAPI; sessionId?: string; retainedWorktreeDispositionAvailable?: boolean; onRunningChange?: (running: boolean) => void }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [page, setPage] = useState(0)
  const [ratio, setRatio] = useState(initialRatio)
  const [follow, setFollow] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(() => Date.now())
  const selected = agents.find(agent => agent.agentId === selectedId)

  // Extracted so the full-page load-error state can retry the same loader.
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const snapshot = await host.listAgents(sessionId)
      setAgents(current => snapshot.reduce((next, agent) => applyAgentEvent(next, { type: 'agent', agent }), current))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '无法加载 subagents')
    } finally {
      setLoading(false)
    }
  }, [host, sessionId])

  useEffect(() => {
    // A session switch is a different agent tree, not more of the same one.
    setAgents([])
    setSelectedId(undefined)
    setPage(0)
    void load()
    const off = host.subscribeAgents(event => setAgents(current => sessionScopedEvent(current, event, sessionId) ? applyAgentEvent(current, event) : current))
    return off
  }, [host, load, sessionId])

  useEffect(() => {
    // Auto-select the newest agent; if the current selection no longer exists
    // in this session's tree (e.g. a session switch reloaded a different set),
    // fall back to the newest agent or clear the stale id.
    const exists = agents.some(agent => agent.agentId === selectedId)
    if (exists) return
    setSelectedId(agents.length ? treeOrder(agents).at(-1)?.agentId : undefined)
  }, [agents, selectedId])

  useEffect(() => {
    localStorage.setItem(splitKey, String(ratio))
  }, [ratio])

  useEffect(() => {
    if (!agents.some(isActive)) return
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [agents])

  useEffect(() => {
    if (!selected) return
    return host.subscribeAgentLog(selected.agentId, event => setAgents(current => current.map(agent => agent.agentId === selected.agentId
      ? { ...agent, logs: applyLogDelta(agent.logs, event) }
      : agent)))
  }, [host, selected?.agentId])

  useEffect(() => {
    if (follow && agents.length) setPage(0)
  }, [agents.length, follow])

  const summary = useMemo(() => ({
    running: agents.filter(isActive).length,
    failed: agents.filter(agent => agent.state === 'failed' && !agent.handled).length,
    handled: agents.filter(agent => agent.handled).length,
    cost: agents.reduce((sum, agent) => sum + (agent.cost ?? 0), 0)
  }), [agents])
  const pricing = useMemo(() => pricingFor(agents), [agents])

  useEffect(() => {
    onRunningChange?.(summary.running > 0)
  }, [onRunningChange, summary.running])

  useEffect(() => () => onRunningChange?.(false), [onRunningChange])

  const ordered = treeOrder(agents)
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize))
  const activePage = Math.min(page, pageCount - 1)
  const visible = ordered.slice(Math.max(0, ordered.length - (activePage + 1) * pageSize), ordered.length - activePage * pageSize)

  useEffect(() => {
    if (page !== activePage) setPage(activePage)
  }, [activePage, page])

  const check = async (agent: Agent) => {
    const update = await host.checkAgent(agent.agentId)
    setAgents(current => applyAgentEvent(current, { type: 'agent', agent: update }))
  }
  const worktree = async (agentId: string, action: 'merge' | 'discard') => {
    const status = action === 'merge' ? await host.mergeWorktree(agentId) : await host.discardWorktree(agentId)
    setAgents(current => applyAgentEvent(current, { type: 'worktree', status }))
  }
  const clearFinished = () => {
    setAgents(current => current.filter(isActive))
    setPage(0)
  }
  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const startY = event.clientY
    const startRatio = ratio
    const container = event.currentTarget.parentElement?.parentElement
    const height = container?.getBoundingClientRect().height ?? 1
    const move = (next: PointerEvent) => setRatio(clamp(startRatio + (next.clientY - startY) / height, .25, .75))
    const end = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
  }

  return <section className="subagents" data-testid="subagent-panel">
    <SubagentHeader total={agents.length} {...summary} pricing={pricing} onClear={clearFinished} />
    {loading
      ? <div className="subagent-loading" role="status"><span className="agent-spinner" aria-hidden="true" />正在加载 subagents…</div>
      : loadError
        ? <div className="subagent-empty" data-testid="subagent-load-error"><b>!</b><strong>未能加载 subagents</strong><DismissibleError message={loadError} onDismiss={() => setLoadError('')} onRetry={() => void load()} /></div>
        : !agents.length
          ? <div className="subagent-empty"><b>♙</b><strong>还没有 subagent</strong><p>让 pi 用 subagent 工具委派任务后，这里会实时显示 agent 树。</p></div>
          : <div className="subagent-split" style={{ gridTemplateRows: `${ratio}fr 6px ${1 - ratio}fr` }}>
            <div className="agent-list" onScroll={event => setFollow(event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24)}>
              {visible.map(agent => <AgentRow
                key={agent.agentId}
                agent={agent}
				childCount={agents.filter(candidate => candidate.parentId === agent.agentId).length}
                selected={agent.agentId === selectedId}
                now={now}
                pricing={pricing}
                onSelect={() => setSelectedId(agent.agentId)}
                onAbort={() => void host.abortAgent(agent.agentId)}
                onResolve={() => void host.resolveAgent(agent.agentId).then(() => setAgents(current => current.map(item => item.agentId === agent.agentId ? { ...item, handled: true } : item)))}
              />)}
              {ordered.length > pageSize && <div className="agent-pager">
                <button disabled={activePage === 0} onClick={() => setPage(value => value - 1)}>较新</button>
                <span>最新第 {activePage + 1}/{pageCount} 页</span>
                <button disabled={(activePage + 1) * pageSize >= ordered.length} onClick={() => setPage(value => value + 1)}>较早</button>
              </div>}
            </div>
            <div className="subagent-divider" aria-label="调整 agent 列表高度" role="separator" onPointerDown={startDrag} />
            <AgentDetail agent={selected} now={now} retainedWorktreeDispositionAvailable={retainedWorktreeDispositionAvailable} onCheck={check} onWorktree={worktree} />
          </div>}
  </section>
}

/**
 * Keep another session's agents out of this panel.
 *
 * Only `agent` events carry a sessionId; `agent_log` and `worktree` are addressed by agentId, so
 * they belong to us exactly when the agent they name is already in this tree. A host that omits
 * sessionId entirely (aggregating hosts, or an unscoped panel) is trusted as before.
 */
function sessionScopedEvent(current: Agent[], event: AgentEvent, sessionId?: string): boolean {
  if (!sessionId) return true
  if (event.type === 'agent') return !event.agent.sessionId || event.agent.sessionId === sessionId
  const agentId = event.type === 'worktree' ? event.status.agentId : event.agentId
  return current.some(agent => agent.agentId === agentId)
}

function applyAgentEvent(current: Agent[], event: AgentEvent): Agent[] {
  if (event.type === 'worktree') return current.map(agent => agent.agentId === event.status.agentId ? { ...agent, worktree: event.status } : agent)
  if (event.type !== 'agent') return current
  const incoming = event.agent
  const index = current.findIndex(agent => agent.agentId === incoming.agentId)
  const previous = current[index]
  const active = incoming.state === 'running'
  // A new run restarts contentIndex at 0; forget the previous run's slot keys so its
  // rows are never rewritten by the next run's first deltas (Swift clears its stream
  // slots on `start` for the same reason).
  const newRun = active && Boolean(previous?.runId && incoming.runId && incoming.runId !== previous.runId)
  const logs = previous?.logs
    ? newRun
      ? previous.logs.map(log => log.contentIndex === undefined ? log : { ...log, contentIndex: undefined })
      : previous.logs
    : []
  const next: Agent = {
    ...previous,
    ...incoming,
    startedAt: incoming.createdAt ?? previous?.startedAt ?? Date.now(),
    endedAt: active ? undefined : incoming.endedAt ?? previous?.endedAt ?? Date.now(),
    logs,
  }
  return index < 0 ? [...current, next] : current.map((agent, itemIndex) => itemIndex === index ? next : agent)
}

/**
 * Upsert one streamed log row, mirroring Swift `SubagentStore.applyLogDelta`.
 *
 * Runtime `log_delta` pushes the *cumulative* full text keyed by `contentIndex`, so a
 * later snapshot must replace the row it owns — otherwise every SSE chunk renders a new
 * progressive-JSON line. Entries without a `contentIndex` (terminal `log` batches, hosts
 * that don't pass the key) are appended; as a fallback for those hosts, a cumulative
 * snapshot that simply extends the previous row replaces it instead of duplicating.
 */
function applyLogDelta(logs: Log[], event: Extract<AgentEvent, { type: 'agent_log' }>): Log[] {
  const { itemType, text, name, isError } = event
  if (event.contentIndex !== undefined) {
    const index = logs.findIndex(log => log.contentIndex === event.contentIndex)
    if (index >= 0) {
      const old = logs[index]
      return logs.map((log, itemIndex) => itemIndex === index
        ? { ...old, itemType, text, name: name || old.name, isError: old.isError }
        : log)
    }
    // Skip empty placeholders (delta before the first real chunk) so the panel
    // doesn't flash a blank row.
    if (!text && itemType !== 'tool') return logs
    return [...logs, { id: logs.length + 1, itemType, text, name, isError, contentIndex: event.contentIndex }]
  }
  const last = logs[logs.length - 1]
  if (last && last.itemType === itemType && text.length > last.text.length && text.startsWith(last.text)) {
    return logs.map(log => log.id === last.id ? { ...log, text } : log)
  }
  return [...logs, { id: logs.length + 1, itemType, text, name, isError }]
}

function SubagentHeader({ total, running, failed, handled, cost, pricing, onClear }: {
  total: number
  running: number
  failed: number
  handled: number
  cost: number
  pricing: Pricing
  onClear: () => void
}) {
  const finished = Math.max(0, total - running)
  return <header className="subagent-header">
    <div className="subagent-header-left">
      <b>♙ Subagents</b>
      <span>{total} 个</span>
      <i className={`running-badge${running ? '' : ' is-zero'}`}>{running} 运行中</i>
      <i className={`failed-badge${failed ? '' : ' is-zero'}`}>{failed} 失败</i>
      <i className={`handled-badge${handled ? '' : ' is-zero'}`}>{handled} 已处理</i>
    </div>
    <div className="subagent-header-right">
      {cost > 0 && <span className="subagent-total-spend" title={`1 USD = ¥${pricing.exchangeRate.toFixed(2)}`}>
        {spend(cost, pricing, true)} · ×{pricing.exchangeRate.toFixed(2)}
      </span>}
      <button onClick={onClear} disabled={finished === 0}>清空</button>
    </div>
  </header>
}

function AgentRow({ agent, childCount, selected, now, pricing, onSelect, onAbort, onResolve }: {
  agent: Agent
	childCount: number
  selected: boolean
  now: number
  pricing: Pricing
  onSelect: () => void
  onAbort: () => void
  onResolve: () => void
}) {
  const active = isActive(agent)
  const worktree = worktreeBadge(agent.worktree, active)
  const subtitle = agent.listSubtitle || agent.title || agent.task || 'subagent'
  const handled = !active && !agent.handled && ['failed', 'aborted', 'interrupted'].includes(agent.state)
  const stalled = agent.stalled || agent.state === 'stalled'
  const model = modelLabel(agent)

  return <article className={`agent-row ${agent.parentId ? 'agent-child' : 'agent-root'} ${selected ? 'selected' : ''}`} data-testid={`agent-row-${agent.agentId}`}>
    <button className="agent-select" onClick={onSelect} aria-pressed={selected}>
      <span className="agent-indent" style={{ width: Math.max(0, (agent.depth ?? 1) - 1) * 16 }} />
	  {agent.parentId && <span className="agent-parent" aria-label="Leader 的子 agent">└</span>}
      <span className={`agent-state ${agent.state}`} title={stateText(agent)}>
        {active && agent.state === 'running' ? <span className="agent-spinner" aria-label="运行中" /> : terminalIcon[agent.state]}
      </span>
      <span className="agent-copy">
        <span className="agent-name-line">
          <em className="provider-badge">{providerLabel(agent)}</em>
          {model && <em className="model-badge" title={agent.model}>{model}</em>}
          <strong>{agent.name}</strong>
		  {childCount > 0 && <em className="agent-leader-badge">主管 · {childCount} 个子 agent</em>}
          {agent.name === 'secretary' && <em className="closeout-badge">收尾</em>}
          {stalled && <em className="stalled-badge">{agent.stalledIdleSec ? `卡住 ${agent.stalledIdleSec}s` : '卡住'}</em>}
          {worktree && <em className={`worktree-badge ${worktree.lifecycle}`}>{worktree.text}</em>}
        </span>
        <small>{subtitle}</small>
      </span>
      <span className="agent-metrics">
        <small>{active ? `运行中 · ${duration(agent, now)}` : `${completedAt(agent.endedAt)} · ${duration(agent, now)}`}</small>
        {agent.cost && agent.cost > 0 && <small>{spend(agent.cost, pricing)}</small>}
      </span>
    </button>
    {active && <button aria-label={`中止 ${agent.name}`} title="中止 agent" className="agent-control abort" onClick={onAbort}>■</button>}
    {handled && <button aria-label={`标记 ${agent.name} 已处理`} title="标记已处理" className="agent-control resolve" onClick={onResolve}>标记已处理</button>}
  </article>
}

function AgentDetail({ agent, now, retainedWorktreeDispositionAvailable, onCheck, onWorktree }: {
  agent?: Agent
  now: number
  retainedWorktreeDispositionAvailable: boolean
  onCheck: (agent: Agent) => void
  onWorktree: (agentId: string, action: 'merge' | 'discard') => void
}) {
  if (!agent) return <div className="agent-detail empty">选择一个 agent 查看详情</div>
  const reviewable = agent.worktree?.lifecycle === 'pendingReview'
  const model = agent.model || `${providerLabel(agent)}/${agent.name}`
  const output = agent.finalResult?.trim()

  return <div className="agent-detail">
    <header className="agent-detail-header">
      <div className="detail-agent-title">
        <div><b>{agent.title || agent.name}</b><span className={`detail-state ${agent.state}`}>{stateText(agent)}</span></div>
        <small title={model}>{model}</small>
      </div>
      <DetailMetrics agent={agent} />
      <button onClick={() => void onCheck(agent)}>手动检查</button>
    </header>
    <p className="agent-task">{agent.task}</p>
    {agent.closeout && <p className="agent-closeout">收尾 · {agent.closeout}</p>}
    {agent.worktree && <div className="worktree-meta">
      <span className={`worktree-status ${agent.worktree.lifecycle}`}>{worktreeText(agent.worktree)}</span>
      {agent.worktree.branch && <code>{agent.worktree.branch}</code>}
      {agent.worktree.error && <small>{agent.worktree.error}</small>}
      {reviewable && retainedWorktreeDispositionAvailable && <span className="worktree-actions"><button onClick={() => void onWorktree(agent.agentId, 'merge')}>合并到主分支</button><button onClick={() => void onWorktree(agent.agentId, 'discard')}>丢弃 worktree</button></span>}
    </div>}
    <div className="agent-log" data-testid="agent-log">
      {isActive(agent) && <div className="agent-running-activity"><span className="agent-spinner" aria-hidden="true" />正在执行 · {agent.listSubtitle || agent.task}</div>}
      {agent.logs.length ? agent.logs.map(log => <LogRow key={log.id} log={log} />) : !output && <p>{isActive(agent) ? '等待 agent 返回第一条工作记录…' : '没有可显示的工作记录'}</p>}
      {output && <ActivityCard kind="final" label="最终结果" summary={preview(output)} meta="完成结果"><div className="agent-final-result">{output}</div></ActivityCard>}
      {!isActive(agent) && <span className="agent-finished-at">结束于 {completedAt(agent.endedAt)} · {duration(agent, now)}</span>}
    </div>
  </div>
}

function DetailMetrics({ agent }: { agent: Agent }) {
  const context = formatTokens(agent.contextTokens)
  const contextLimit = formatTokens(agent.contextWindowTokens)
  const input = formatTokens(agent.inputTokens)
  const output = formatTokens(agent.outputTokens)
  const cache = formatTokens(agent.cacheTokens)
  return <div className="detail-metrics" aria-label="模型上下文统计">
    {context && <span title="上下文占用">ctx {context}{contextLimit ? `/${contextLimit}` : ''}</span>}
    {input && <span title="累计输入 tokens">in {input}</span>}
    {output && <span title="累计输出 tokens">out {output}</span>}
    {cache && <span title="缓存命中 tokens">cache {cache}</span>}
  </div>
}

function LogRow({ log }: { log: Log }) {
  if (log.itemType === 'thinking') {
    return <ActivityCard kind="thinking" label="Thinking" summary={preview(log.text, '思考过程')} meta="思考"><pre className="agent-card-pre thinking-copy">{log.text}</pre></ActivityCard>
  }
  if (log.itemType === 'tool') {
    const argsSummary = toolArgsSummary(log.name ?? 'tool', log.text)
    return <ActivityCard kind="tool" label="工具" summary={`${log.name ?? 'tool'}${argsSummary !== '…' ? ` · ${argsSummary}` : ''}`} meta="调用参数"><pre className="agent-card-pre">{log.text || '（无参数）'}</pre></ActivityCard>
  }
  if (log.itemType === 'toolResult') {
    const diff = diffSummary(log.text)
    if (diff) {
      return <ActivityCard kind="diff" label="Diff" summary={`${diff.files} 个文件 · +${diff.additions} −${diff.deletions}`} meta="工具结果"><div className="agent-diff">{renderDiff(log.text)}</div></ActivityCard>
    }
    return <ActivityCard kind="result" label="结果" error={Boolean(log.isError)} summary={preview(log.text, log.isError ? '工具调用失败' : '工具结果')} meta={log.isError ? '错误' : '工具结果'}><pre className="agent-card-pre">{log.text || '（无输出）'}</pre></ActivityCard>
  }
  return <article className="agent-log-row text">
    <span className="agent-log-kind">日志</span>
    <p className="agent-log-text">{log.text}</p>
  </article>
}

function diffSummary(text: string) {
  if (!/^diff --git /m.test(text)) return null
  const lines = text.split('\n')
  return {
    files: Math.max(1, lines.filter(line => line.startsWith('diff --git ')).length),
    additions: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
    deletions: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length
  }
}

function renderDiff(text: string) {
  try {
    return parseDiff(text).map(file => <Diff key={file.oldPath + file.newPath} viewType="split" diffType={file.type} hunks={file.hunks}>
      {hunks => hunks.map(hunk => <Hunk key={hunk.content} hunk={hunk} />)}
    </Diff>)
  } catch {
    return <pre className="agent-card-pre">{text}</pre>
  }
}
