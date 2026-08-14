import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import { ActivityCard } from './ActivityCard'
import { toolActivitySummary, toolArgsSummary } from './tool-summary'
import { DismissibleError } from './DismissibleError'
import { ProviderLogo } from './ProviderLogo'
import { providerBrand, type ProviderBrand } from './provider-logo'
import { AssistantTranscriptContent, type AssistantTranscriptMessage, type TranscriptActivity, type TranscriptTool } from './AssistantTranscriptContent'
import genericAgentIcon from './sf-icons/person-2.png'
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

const profileNames: Record<string, string> = {
  builder: '构建',
  explore: '探索',
  'general-purpose': '通用',
  reviewer: '审查',
  review: '审查',
  plan: '规划',
  secretary: '收尾秘书',
  'long-test': '长时测试',
  'computer-use-leader': '电脑操作主管',
  'computer-terminal': '终端操作',
  'computer-verifier': '操作验证',
  operator: '操作'
}

const toolNames: Record<string, string> = {
  terminal_file_status: '查看文件状态',
  terminal_read_file: '读取文件',
  memory_query: '查询记忆',
  bash: '运行命令',
  pwd: '查看工作目录'
}

export function localizedProfileName(name: string): string {
  return profileNames[name.trim().toLowerCase()] ?? name
}

function knownTaskSummary(text: string): string | undefined {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (!compact) return undefined
  if (/^build fixture[.!]?$/i.test(compact)) return '构建测试夹具'
  const sameTask = compact.match(/^same-task round (\d+)[.!]?$/i)
  if (sameTask) return `同一任务第 ${sameTask[1]} 轮`
  if (/^profile-first-ok[.!]?$/i.test(compact)) return '优先恢复配置验证成功'
  if (/^profile-second-ok[.!]?$/i.test(compact)) return '第二轮配置恢复成功'
  if (/^computer use leader[.!]?$/i.test(compact)) return '电脑操作主管'
  return undefined
}

/** Deterministic display-only localization. Unknown prose stays untouched. */
export function localizedTaskSummary(text: string): string {
  const clean = visibleAgentText(text)
  const direct = knownTaskSummary(clean)
  if (direct) return direct
  const activity = clean.match(/^([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/)
  if (activity && toolNames[activity[1]]) {
    const args = activity[2]?.trim()
    const detail = args ? toolActivitySummary(`${activity[1]} ${args}`).replace(new RegExp(`^${activity[1]}(?:\\s*·?\\s*)?`), '') : ''
    return detail && detail !== '…' ? `${toolNames[activity[1]]} · ${detail}` : toolNames[activity[1]]
  }
  return clean
}

function firstNonEmptyLine(text: string): string {
  for (const line of visibleAgentText(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed) return trimmed
  }
  return ''
}

function shortTaskLabel(task: string): string {
  const line = firstNonEmptyLine(task)
  if (!line) return ''
  const compact = localizedTaskSummary(line).replace(/\s+/g, ' ').trim()
  return compact.length > 40 ? `${compact.slice(0, 40)}…` : compact
}

function agentListSubtitle(agent: Agent): string {
  const title = agent.title?.trim()
  if (title) return localizedTaskSummary(title)
  if (agent.name === 'computer-use-leader' || agent.role === 'computer-use-leader') return '协调并核验桌面操作任务'
  if (agent.name === 'computer-terminal') return '执行受限终端步骤'
  if (agent.name === 'computer-verifier') return '核验桌面操作结果'
  const taskLabel = agent.task?.trim() ? shortTaskLabel(agent.task) : ''
  if (taskLabel) return taskLabel
  const activity = agent.listSubtitle?.trim()
  if (activity) return localizedTaskSummary(activity)
  const profile = agent.name?.trim()
  return profile ? localizedProfileName(profile) : 'subagent'
}

type LiveAgentStatus = { text: string; severity: 'active' | 'quiet' | 'deadline' }

function liveToolActivityLabel(rawActivity: string): string | undefined {
  const match = rawActivity.match(/^([a-z][a-z0-9_-]*)\b/i)
  if (!match) return undefined
  const name = match[1]
  const rest = rawActivity.slice(match[0].length).trim()
  if (!rest || rest === '…') return name
  if (rest.startsWith('{')) {
    const summary = toolArgsSummary(name, rest)
    return summary !== '…' ? `${name} · ${summary}` : name
  }
  return `${name} · ${rest}`
}

function liveAgentStatus(agent: Agent, now: number, activeChildCount = 0): LiveAgentStatus {
	if (activeChildCount > 0) {
		return { severity: 'active', text: `正在协调 · ${activeChildCount} 个子 agent 运行中` }
	}
  const quietSeconds = agent.updatedAt === undefined ? undefined : Math.max(0, Math.floor((now - agent.updatedAt) / 1000))
  const rawActivity = visibleAgentText(agent.listSubtitle ?? '').trim()
  const toolLabel = liveToolActivityLabel(rawActivity)
  const replanning = /^(?:Revise this Computer Task plan|Repair this Computer Task plan)/i.test(agent.task)
  const phase = replanning
    ? '正在调查失败并重新规划'
    : toolLabel
      ? `等待工具返回 · ${toolLabel}`
      : '等待模型响应'
  const deadlineSeconds = agent.deadlineAt ? Math.max(0, Math.ceil((agent.deadlineAt - now) / 1000)) : undefined
  if (quietSeconds === undefined) {
    return { text: `${phase} · 等待新的状态事件`, severity: 'active' }
  }
  if (deadlineSeconds === 0) {
    return { text: `正在自动中止 · ${phase} · ${quietSeconds} 秒无新进展`, severity: 'deadline' }
  }
  if (quietSeconds >= 30) {
    return {
      text: `可能卡住 · ${phase} · ${quietSeconds} 秒无新进展${deadlineSeconds === undefined ? '' : ` · ${deadlineSeconds} 秒后自动中止`}`,
      severity: 'quiet'
    }
  }
  return {
    text: `${phase} · ${quietSeconds} 秒前有新进展${deadlineSeconds === undefined ? '' : ` · 最迟 ${deadlineSeconds} 秒后自动中止`}`,
    severity: 'active'
  }
}

function providerLabel(agent: Agent) {
  return agent.provider || agent.model?.split('/')[0] || 'pi'
}

function modelLabel(agent: Agent) {
  const model = agent.model?.trim()
  if (!model) return ''
  return model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model
}

const modelFamilyNames: Partial<Record<ProviderBrand, string>> = {
  anthropic: 'Claude', deepseek: 'DeepSeek', google: 'Gemini', openai: 'GPT', codex: 'Codex',
  xai: 'Grok', kimi: 'Kimi', qwen: 'Qwen', zhipu: 'GLM', mistral: 'Mistral', meta: 'Llama'
}

function modelFamily(agent: Agent) {
  const brand = providerBrand(agent.provider ?? '', agent.model)
  return { brand, family: modelFamilyNames[brand] ?? (brand === 'unknown' ? '通用' : brand) }
}

function ModelFamilyIcon({ agent }: { agent: Agent }) {
  const icon = modelFamily(agent)
  return icon.brand === 'unknown'
    ? <img className="agent-model-icon generic" src={genericAgentIcon} alt="通用 agent" />
    : <span className="agent-model-icon" role="img" aria-label={`${icon.family} 模型`}><ProviderLogo provider={agent.provider ?? ''} modelId={agent.model} size={18} /></span>
}

export function agentDisplayName(agent: Pick<Agent, 'agentId' | 'name' | 'role'>): string {
  return agent.name || agent.role || 'subagent'
}

function latestReadableResult(agent: Agent): string {
  const finalResult = visibleAgentText(agent.finalResult ?? '').trim()
  if (finalResult) return finalResult
  // A tool result is execution detail, not an assistant conclusion. Promoting it
  // into prose is what exposed raw JSON twice: once as a tool and again as TLDR.
  const latest = [...agent.logs].reverse().find(log => log.itemType === 'text')
  return visibleAgentText(latest?.text ?? '').trim()
}

function detailTaskTitle(agent: Agent, result: string): string {
  const task = agentListSubtitle(agent).trim()
  if (task && !/^(?:subagent|agent|task)$/i.test(task)) return task
  if (result) return preview(localizedTaskSummary(result), '任务结果')
  const identity = agentDisplayName(agent)
  return identity === 'subagent' ? '子任务' : identity
}

function agentTranscript(agent: Agent, finalResult: string): AssistantTranscriptMessage[] {
  // Build ONE unified message — exactly like the main agent transcript — so the
  // subagent detail reuses AssistantTranscriptContent verbatim: one "N 个步骤"
  // card containing all thinking + tools, followed by the text content.
  const activities: TranscriptActivity[] = []
  const tools: TranscriptTool[] = []
  const contentParts: string[] = []
  let nextIndex = 0
  const activityIndex = (log: Log) => log.contentIndex ?? nextIndex
  const consumed = new Set<number>()
  const nameOf = (log: Log) => (log.name ?? '').trim()
  const takeResult = (tool: Log, toolIndex: number): Log | undefined => {
    if (tool.contentIndex !== undefined) {
      const same = agent.logs.findIndex(log => log.itemType === 'toolResult' && log.contentIndex === tool.contentIndex)
      if (same >= 0) { consumed.add(same); return agent.logs[same] }
    }
    const adjacent = agent.logs[toolIndex + 1]
    if (adjacent?.itemType === 'toolResult' && !consumed.has(toolIndex + 1)) {
      consumed.add(toolIndex + 1)
      return adjacent
    }
    for (let i = 0; i < agent.logs.length; i += 1) {
      const candidate = agent.logs[i]
      if (candidate.itemType !== 'toolResult' || consumed.has(i)) continue
      const resultName = nameOf(candidate)
      const toolName = nameOf(tool)
      if (!resultName || !toolName || resultName === toolName) {
        consumed.add(i)
        return candidate
      }
    }
    return undefined
  }
  for (let index = 0; index < agent.logs.length; index += 1) {
    const log = agent.logs[index]
    const text = visibleAgentText(log.text)
    if (log.itemType === 'thinking') {
      if (!text) continue
      const contentIndex = activityIndex(log)
      activities.push({ type: 'thinking', id: `thinking:${log.id}`, contentIndex, content: text })
      nextIndex = Math.max(nextIndex, contentIndex + 1)
    } else if (log.itemType === 'tool') {
      const result = takeResult(log, index)
      const laterTool = agent.logs.slice(index + 1).some(candidate => candidate.itemType === 'tool')
      const tool: TranscriptTool = { id: `subagent-tool-${log.id}`, name: log.name ?? 'tool', input: log.text, result: result ? visibleAgentText(result.text) : undefined, error: result?.isError, startedAt: agent.startedAt, finished: Boolean(result) || !isActive(agent) || laterTool }
      const contentIndex = activityIndex(log)
      tools.push(tool)
      activities.push({ type: 'tool', contentIndex, tool })
      nextIndex = Math.max(nextIndex, contentIndex + 1)
    } else if (log.itemType === 'toolResult') {
      if (!consumed.has(index) && text) contentParts.push(text)
    } else if (text) {
      const contentIndex = activityIndex(log)
      activities.push({ type: 'text', id: `text:${log.id}`, contentIndex, content: text })
      nextIndex = Math.max(nextIndex, contentIndex + 1)
    }
  }
  const content = contentParts.join('\n\n')
  const messages: AssistantTranscriptMessage[] = []
  const hasSteps = activities.length > 0
  if (hasSteps || content) {
    messages.push({
      content,
      thinking: activities.find((activity): activity is Extract<TranscriptActivity, { type: 'thinking' }> => activity.type === 'thinking')?.content,
      tools: tools.length > 0 ? tools : undefined,
      activities: hasSteps ? activities : undefined,
      streaming: isActive(agent)
    })
  }
  if (finalResult && finalResult.trim() && !content.includes(finalResult.trim()) && !activities.some(activity => activity.type === 'text' && activity.content.includes(finalResult.trim()))) {
    messages.push({ content: finalResult })
  }
  if (!messages.length && !isActive(agent)) messages.push({ content: agent.state === 'ok' ? '任务已完成' : agent.state === 'failed' ? '任务失败。请查看技术详情中的完整错误。' : `任务${stateText(agent)}，尚无返回内容。` })
  return messages
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

export function SubagentPanel({ host, sessionId, projectPath, onOpenDocument, retainedWorktreeDispositionAvailable = false, onRunningChange, onRunningCountChange, onAgentStarted }: { host: PipiHostAPI; sessionId?: string; projectPath?: string; onOpenDocument?: (path: string) => void; retainedWorktreeDispositionAvailable?: boolean; onRunningChange?: (running: boolean) => void; onRunningCountChange?: (count: number) => void; onAgentStarted?: () => void }) {
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedId, setSelectedId] = useState<string>()
  const [page, setPage] = useState(0)
  const [ratio, setRatio] = useState(initialRatio)
  const [follow, setFollow] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
	const [abortError, setAbortError] = useState('')
	const [abortingIds, setAbortingIds] = useState<Set<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const loadGeneration = useRef(0)
  const selected = agents.find(agent => agent.agentId === selectedId)

  // Extracted so the full-page load-error state can retry the same loader.
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setLoadError('')
    try {
      // The durable host index survives restarts, but the visible tree belongs to the
      // selected chat. Replacing (rather than accumulating) the snapshot keeps agents
      // from another session out of the panel.
      const snapshot = await host.listAgents(sessionId)
      if (generation !== loadGeneration.current) return
      // The session-change effect already cleared the previous chat. Merge the
      // snapshot into any events that arrived while this request was in flight,
      // otherwise a fast START can be erased by a slower empty snapshot.
      setAgents(current => snapshot.reduce((next, agent) => applyAgentEvent(next, { type: 'agent', agent }), current))
    } catch (error) {
      if (generation !== loadGeneration.current) return
      setLoadError(error instanceof Error ? error.message : '无法加载 subagents')
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [host, sessionId])

  useEffect(() => {
    // Clear the old chat synchronously before its replacement snapshot arrives. The
    // generation guard also prevents a slow response for the previous chat from
    // repopulating the panel after a rapid switch.
    loadGeneration.current += 1
    setAgents([])
    setSelectedId(undefined)
    setPage(0)
		setAbortError('')
		setAbortingIds(new Set())
    void load()
    const off = host.subscribeAgents(event => setAgents(current => sessionScopedEvent(current, event, sessionId)
      ? applyAgentEvent(current, event)
      : current))
    return () => {
      loadGeneration.current += 1
      off()
    }
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
    // Agent events update the activity text immediately. The clock only ages
    // relative labels and must not churn the whole accessibility tree once per
    // second: Computer Use deliberately rejects actions when the target UI
    // changes between observation and click.
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [agents])

  useEffect(() => {
    if (!selected) return
    return host.subscribeAgentLog(selected.agentId, event => setAgents(current => current.map(agent => agent.agentId === selected.agentId
      ? { ...agent, logs: applyLogDelta(agent.logs, event) }
      : agent)), selected.sessionId ?? '', selected.runId ?? '')
  }, [host, selected?.agentId, selected?.sessionId, selected?.runId])

  // Fetch cached logs for the selected agent so completed subagents show their
  // full transcript (live subscription only delivers events while running).
  useEffect(() => {
    if (!selected?.agentId || !host.getAgentLogs) return
    let cancelled = false
    const agentId = selected.agentId
    const session = selected.sessionId ?? ''
    const runId = selected.runId ?? ''
    void host.getAgentLogs(agentId, session, runId).then(entries => {
      if (cancelled || !entries.length) return
      setAgents(current => current.map(agent => {
        if (agent.agentId !== agentId || agent.logs.length > 0) return agent
        let logs: Log[] = []
        for (const entry of entries) logs = applyLogDelta(logs, { type: 'agent_log', agentId, ...entry })
        return { ...agent, logs }
      }))
    })
    return () => { cancelled = true }
  }, [host, selected?.agentId, selected?.sessionId, selected?.runId])

  useEffect(() => {
    if (follow && agents.length) setPage(0)
  }, [agents.length, follow])

  const summary = useMemo(() => ({
    running: agents.filter(isActive).length,
    succeeded: agents.filter(agent => agent.state === 'ok').length,
    failed: agents.filter(agent => agent.state === 'failed').length,
  }), [agents])

  const previousRunningRef = useRef(0)
  useEffect(() => {
    onRunningCountChange?.(summary.running)
    onRunningChange?.(summary.running > 0)
    if (summary.running > previousRunningRef.current) onAgentStarted?.()
    previousRunningRef.current = summary.running
  }, [onAgentStarted, onRunningChange, onRunningCountChange, summary.running])

  useEffect(() => () => {
    onRunningCountChange?.(0)
    onRunningChange?.(false)
  }, [onRunningChange, onRunningCountChange])

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
	const abort = async (agent: Agent) => {
		if (abortingIds.has(agent.agentId)) return
		setAbortError('')
		setAbortingIds(current => new Set(current).add(agent.agentId))
		try {
			await host.abortAgent(agent.agentId)
		} catch (error) {
			setAbortError(`无法停止 ${agentDisplayName(agent)}：${error instanceof Error ? error.message : '停止请求失败'}`)
		} finally {
			setAbortingIds(current => {
				const next = new Set(current)
				next.delete(agent.agentId)
				return next
			})
		}
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
    <SubagentHeader total={agents.length} {...summary} onClear={clearFinished} />
		{abortError && <div className="subagent-abort-error"><DismissibleError message={abortError} onDismiss={() => setAbortError('')} /></div>}
    {loading
      ? <div className="subagent-loading" role="status"><span className="agent-spinner" aria-hidden="true" />正在加载 subagents…</div>
      : loadError
        ? <div className="subagent-empty" data-testid="subagent-load-error"><b>!</b><strong>未能加载 subagents</strong><DismissibleError message={loadError} onDismiss={() => setLoadError('')} onRetry={() => void load()} /></div>
        : !agents.length
          ? <div className="subagent-empty"><b>♙</b><strong>还没有 subagent</strong><p>让 pi 用 subagent 工具委派任务后，这里会实时显示 agent 树。</p></div>
          : <div className="subagent-split" style={{ gridTemplateRows: `${ratio}fr 6px ${1 - ratio}fr` }}>
            <div className="agent-list compact" data-density="compact" onScroll={event => setFollow(event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24)}>
              {visible.map(agent => <AgentRow
                key={agent.agentId}
                agent={agent}
				childCount={agents.filter(candidate => candidate.parentId === agent.agentId).length}
				activeChildCount={agents.filter(candidate => candidate.parentId === agent.agentId && isActive(candidate)).length}
                selected={agent.agentId === selectedId}
				aborting={abortingIds.has(agent.agentId)}
				now={now}
                onSelect={() => setSelectedId(agent.agentId)}
				onAbort={() => void abort(agent)}
                onResolve={() => void host.resolveAgent(agent.agentId).then(() => setAgents(current => current.map(item => item.agentId === agent.agentId ? { ...item, handled: true } : item)))}
              />)}
              {ordered.length > pageSize && <div className="agent-pager">
                <button disabled={activePage === 0} onClick={() => setPage(value => value - 1)}>较新</button>
                <span>最新第 {activePage + 1}/{pageCount} 页</span>
                <button disabled={(activePage + 1) * pageSize >= ordered.length} onClick={() => setPage(value => value + 1)}>较早</button>
              </div>}
            </div>
            <div className="subagent-divider" aria-label="调整 agent 列表高度" role="separator" onPointerDown={startDrag} />
			<AgentDetail agent={selected} activeChildCount={selected ? agents.filter(candidate => candidate.parentId === selected.agentId && isActive(candidate)).length : 0} aborting={Boolean(selected && abortingIds.has(selected.agentId))} now={now} projectPath={projectPath} onOpenDocument={onOpenDocument} retainedWorktreeDispositionAvailable={retainedWorktreeDispositionAvailable} onCheck={check} onWorktree={worktree} onAbort={agent => void abort(agent)} />
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
  if (event.type === 'agent') {
    if (event.agent.sessionId) return event.agent.sessionId === sessionId
    return current.some(agent => agent.agentId === event.agent.agentId)
  }
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
function sealStreamSlots(logs: Log[]): Log[] {
  return logs.map(log => log.contentIndex === undefined ? log : { ...log, contentIndex: undefined })
}

function applyLogDelta(logs: Log[], event: Extract<AgentEvent, { type: 'agent_log' }>): Log[] {
  const { itemType, text, name, isError } = event
  if (event.resetStreamSlots) logs = sealStreamSlots(logs)
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
  if (event.resetStreamSlots && !text && itemType !== 'tool') return logs
  // A no-index `kind:"log"` item is a turn boundary: forget live slots so the
  // next message's contentIndex 0 cannot rewrite the previous thinking/text.
  logs = event.resetStreamSlots ? logs : sealStreamSlots(logs)
  const last = logs[logs.length - 1]
  if (last && last.itemType === itemType && text.length > last.text.length && text.startsWith(last.text)) {
    return logs.map(log => log.id === last.id ? { ...log, text } : log)
  }
  return [...logs, { id: logs.length + 1, itemType, text, name, isError }]
}

function SubagentHeader({ total, running, succeeded, failed, onClear }: {
  total: number
  running: number
  succeeded: number
  failed: number
  onClear: () => void
}) {
  const finished = Math.max(0, total - running)
  return <header className="subagent-header">
    <div className="subagent-header-left">
      <b>♙ Subagents</b>
      <span>{total} 个</span>
      <i className={`running-badge${running ? '' : ' is-zero'}`}>{running} 运行中</i>
      <i className={`handled-badge${succeeded ? '' : ' is-zero'}`}>{succeeded} 成功</i>
      <i className={`failed-badge${failed ? '' : ' is-zero'}`}>{failed} 失败</i>
    </div>
    <div className="subagent-header-right">
      <button onClick={onClear} disabled={finished === 0}>清空</button>
    </div>
  </header>
}

function AgentRow({ agent, childCount, activeChildCount, selected, aborting, now, onSelect, onAbort, onResolve }: {
  agent: Agent
	childCount: number
	activeChildCount: number
  selected: boolean
	aborting: boolean
  now: number
  onSelect: () => void
  onAbort: () => void
  onResolve: () => void
}) {
  const active = isActive(agent)
  const worktree = worktreeBadge(agent.worktree, active)
  const subtitle = agentListSubtitle(agent)
  const handled = !active && !agent.handled && ['failed', 'aborted', 'interrupted'].includes(agent.state)
  const stalled = agent.stalled || agent.state === 'stalled'
	const live = active ? liveAgentStatus(agent, now, activeChildCount) : undefined

  return <article className={`agent-row ${agent.parentId ? 'agent-child' : 'agent-root'} ${selected ? 'selected' : ''}`} data-testid={`agent-row-${agent.agentId}`}>
    <button className="agent-select" onClick={onSelect} aria-pressed={selected}>
      <span className="agent-indent" style={{ width: Math.max(0, (agent.depth ?? 1) - 1) * 10 }} />
	  {agent.parentId && <span className="agent-parent" aria-label="Leader 的子 agent">└</span>}
      <span className={`agent-state ${agent.state}`} title={stateText(agent)}>
        {active && agent.state === 'running' ? <span className="agent-spinner" aria-label="运行中" /> : terminalIcon[agent.state]}
      </span>
      <span className="agent-copy">
        <span className="agent-name-line">
          <ModelFamilyIcon agent={agent} />
          <strong>{agentDisplayName(agent)}</strong>
		  {childCount > 0 && <em className="agent-leader-badge">主管 · {childCount} 个子 agent</em>}
          {stalled && <em className="stalled-badge">{agent.stalledIdleSec ? `卡住 ${agent.stalledIdleSec}s` : '卡住'}</em>}
          {worktree && <em className={`worktree-badge ${worktree.lifecycle}`}>{worktree.text}</em>}
        </span>
        <small>{subtitle}</small>
        {active && <small className="agent-row-time">· {duration(agent, now)}</small>}
        {!active && agent.endedAt && <small className="agent-row-time">{completedAt(agent.endedAt)} · {duration(agent, now)}</small>}
		{live && <small className={`agent-live-state ${live.severity}`}>{live.text}</small>}
      </span>
    </button>
    {active && <button aria-label={`${aborting ? '正在中止' : '中止'} ${agent.name}`} title={aborting ? '正在中止 agent' : '中止 agent'} className="agent-control abort" disabled={aborting} onClick={onAbort}>{aborting ? <span className="agent-spinner" aria-hidden="true" /> : '■'}</button>}
    {handled && <button aria-label={`标记 ${agent.name} 已处理`} title="标记已处理" className="agent-control resolve" onClick={onResolve}>标记已处理</button>}
  </article>
}

function AgentDetail({ agent, activeChildCount, aborting, now, projectPath, onOpenDocument, retainedWorktreeDispositionAvailable, onCheck, onWorktree, onAbort }: {
  agent?: Agent
	activeChildCount: number
	aborting: boolean
  now: number
  projectPath?: string
  onOpenDocument?: (path: string) => void
  retainedWorktreeDispositionAvailable: boolean
  onCheck: (agent: Agent) => void
  onWorktree: (agentId: string, action: 'merge' | 'discard') => void
  onAbort: (agent: Agent) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const output = agent ? latestReadableResult(agent) : ''
  const latestLog = agent?.logs.at(-1)

  useEffect(() => {
    followRef.current = true
  }, [agent?.agentId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !followRef.current) return
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  }, [agent?.agentId, agent?.logs.length, agent?.state, latestLog?.text, latestLog?.itemType, output])

  if (!agent) return <div className="agent-detail empty">选择一个 agent 查看详情</div>
  const reviewable = agent.worktree?.lifecycle === 'pendingReview'
  const model = agent.model || `${providerLabel(agent)}/${agent.name}`
  const activity = localizedTaskSummary(agent.listSubtitle || agent.title || agent.task)
	const live = isActive(agent) ? liveAgentStatus(agent, now, activeChildCount) : undefined
  const detailTitle = detailTaskTitle(agent, output)
  const transcript = agentTranscript(agent, output)

  return <div className="agent-detail">
    <header className="agent-detail-header">
      <div className="detail-agent-title">
        <div><ModelFamilyIcon agent={agent} /><b>{detailTitle}</b></div>
        <small>{modelFamily(agent).family}</small>
      </div>
    </header>
    <p className="agent-closeout">{agent.closeout ? `收尾　${agent.closeout}` : `${stateText(agent)}${agent.worktree ? `　${worktreeText(agent.worktree)}` : ''}`}</p>
    <div className="agent-transcript-scroll" data-testid="subagent-transcript-scroll" ref={scrollRef} onScroll={event => {
      const el = event.currentTarget
      followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
    }}>
      {isActive(agent) && <div className={`agent-running-activity ${live?.severity ?? 'active'}`} role="status" aria-live="polite"><span className="agent-spinner" aria-hidden="true" /><span>{live?.text ?? `正在执行 · ${activity}`}</span><button disabled={aborting} onClick={() => onAbort(agent)}>{aborting ? '正在停止' : '停止'}</button></div>}
      <div className="agent-transcript" data-testid="subagent-transcript">
        {transcript.map((message, index) => <article className="message assistant-message" key={`${agent.runId}-transcript-${index}`}><AssistantTranscriptContent message={message} expandSteps documentBasePath={agent.worktree?.path || projectPath} onOpenDocument={onOpenDocument} /></article>)}
      </div>
      <details className="agent-technical-details">
      <summary>技术详情</summary>
      <div className="technical-metadata">
        <span>Agent ID：{agent.agentId}</span>
        <span>Profile：{localizedProfileName(agent.name)}（{agent.name}）</span>
        <span>Provider / Model：{providerLabel(agent)} · {model}</span>
        {agent.sessionId && <span>Session：{agent.sessionId}</span>}
        <DetailMetrics agent={agent} now={now} pricing={pricingFor([agent])} />
        <button onClick={() => void onCheck(agent)}>手动检查</button>
      </div>
      <p className="agent-task">{visibleAgentText(agent.task)}</p>
      {agent.closeout && <p className="agent-closeout">收尾 · {agent.closeout}</p>}
      {agent.worktree && <div className="worktree-meta">
        <span className={`worktree-status ${agent.worktree.lifecycle}`}>{worktreeText(agent.worktree)}</span>
        {agent.worktree.branch && <code>{agent.worktree.branch}</code>}
        {agent.worktree.error && <small>{agent.worktree.error}</small>}
        {reviewable && retainedWorktreeDispositionAvailable && <span className="worktree-actions"><button onClick={() => void onWorktree(agent.agentId, 'merge')}>合并到主分支</button><button onClick={() => void onWorktree(agent.agentId, 'discard')}>丢弃 worktree</button></span>}
      </div>}
      {!isActive(agent) && <span className="agent-finished-at">结束于 {completedAt(agent.endedAt)} · {duration(agent, now)}</span>}
      </details>
    </div>
  </div>
}

function DetailMetrics({ agent, now, pricing }: { agent: Agent; now: number; pricing: Pricing }) {
  const context = formatTokens(agent.contextTokens)
  const contextLimit = formatTokens(agent.contextWindowTokens)
  const input = formatTokens(agent.inputTokens)
  const output = formatTokens(agent.outputTokens)
  const cache = formatTokens(agent.cacheTokens)
  return <div className="detail-metrics" aria-label="模型上下文统计">
    <span title="运行耗时">{duration(agent, now)}</span>
    {agent.cost && agent.cost > 0 ? <span title="累计费用">{spend(agent.cost, pricing)}</span> : null}
    {context && <span title="上下文占用">ctx {context}{contextLimit ? `/${contextLimit}` : ''}</span>}
    {input && <span title="累计输入 tokens">in {input}</span>}
    {output && <span title="累计输出 tokens">out {output}</span>}
    {cache && <span title="缓存命中 tokens">cache {cache}</span>}
  </div>
}

function LogRow({ log }: { log: Log }) {
  const visibleText = visibleAgentText(log.text)
  if (log.itemType === 'thinking') {
    return <ActivityCard kind="thinking" label="Thinking" summary={preview(visibleText, '思考过程')} meta="思考"><pre className="agent-card-pre thinking-copy">{visibleText}</pre></ActivityCard>
  }
  if (log.itemType === 'tool') {
    const argsSummary = toolArgsSummary(log.name ?? 'tool', log.text)
    const displayName = toolNames[log.name ?? ''] ?? log.name ?? '工具'
    return <ActivityCard kind="tool" label="工具" summary={`${displayName}${argsSummary !== '…' ? ` · ${argsSummary}` : ''}`} meta="调用参数"><pre className="agent-card-pre">{log.text || '（无参数）'}</pre></ActivityCard>
  }
  if (log.itemType === 'toolResult') {
    const diff = diffSummary(visibleText)
    if (diff) {
      return <ActivityCard kind="diff" label="Diff" summary={`${diff.files} 个文件 · +${diff.additions} −${diff.deletions}`} meta="工具结果"><div className="agent-diff">{renderDiff(visibleText)}</div></ActivityCard>
    }
    return <ActivityCard kind="result" label="结果" error={Boolean(log.isError)} summary={preview(visibleText, log.isError ? '工具调用失败' : '工具结果')} meta={log.isError ? '错误' : '工具结果'}><pre className="agent-card-pre">{visibleText || '（无输出）'}</pre></ActivityCard>
  }
  return <article className="agent-log-row text">
    <span className="agent-log-kind">日志</span>
    <p className="agent-log-text">{visibleText}</p>
  </article>
}

/** Internal isolation policy can be echoed by a model, but is never user-facing work output. */
export function visibleAgentText(text: string): string {
  return text.replace(/\[PipiUI subagent isolation sentinel:[\s\S]*?This sentinel is not a skill instruction[^\]]*\]/gi, '').trim()
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
