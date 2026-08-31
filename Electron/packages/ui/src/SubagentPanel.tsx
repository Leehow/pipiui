import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Diff, Hunk, parseDiff } from 'react-diff-view'
import { ActivityCard } from './ActivityCard'
import { cacheHitRate, formatCompactTokens } from './session-stats-format'
import { toolActivitySummary, toolArgsSummary } from './tool-summary'
import { fileChangeTokenStats, liveTokenLabel } from './file-change-tokens'
import { DismissibleError } from './DismissibleError'
import { ProviderLogo } from './ProviderLogo'
import { providerBrand, type ProviderBrand } from './provider-logo'
import { AssistantTranscriptContent, type AssistantTranscriptMessage, type TranscriptActivity, type TranscriptTool } from './AssistantTranscriptContent'
import genericAgentIcon from './sf-icons/person-2.png'
import type { AgentEvent, AgentState, AgentSummary, CostUnit, PipiHostAPI, WorktreeStatus } from '@pipi/host-api'
import { diagnoseAgentProgress } from './agent-stall-diagnostics'
import { formatFinalizationLine, isTerminalFinalizingPhase, liveRunningProgressLine } from './agent-finalization'
import { staleRunningAgentIDs, statusChannelWarningText } from './subagent-status-check'

type Log = {
  id: number
  itemType: 'text' | 'thinking' | 'tool' | 'toolResult'
  text: string
  name?: string
  isError?: boolean
  /** Stable call identity shared by a tool row and its toolResult row; legacy logs have none. */
  toolCallId?: string
  /** Runtime log_delta key (cumulative snapshot upsert); undefined for terminal `log` batches. */
  contentIndex?: number
  /** Uncapped thinking length when preview `text` is sliced. */
  charCount?: number
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
const AGENT_LOG_RENDER_INTERVAL_MS = 200
const AGENT_LOG_RENDER_LIMIT = 40
const AGENT_FINAL_RESULT_TAIL_CAP = 8_000
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const terminalIcon: Record<AgentState, string> = { running: '◌', stalled: '!', ok: '✓', failed: '×', aborted: '■', interrupted: '⚡' }

function initialRatio() {
  const value = Number(localStorage.getItem(splitKey))
  return Number.isFinite(value) ? clamp(value, .25, .75) : .48
}

function isActive(agent: Pick<Agent, 'state'>) {
  return agent.state === 'running'
}

/**
 * Terminal rows settled this long ago are history material, not active list
 * content. Freshly-completed rows never match, so a record the user just
 * watched finish always stays in the default list.
 */
const AGENT_STALE_TERMINAL_AFTER_MS = 24 * 60 * 60 * 1000

/**
 * Running/stalled rows always stay actionable in the main list; terminal rows
 * whose end time lies far in the past collapse into the 历史 group. A missing
 * end timestamp means undated, not ancient: those stay visible.
 */
function isStaleTerminalRow(agent: Pick<Agent, 'state' | 'endedAt'>, now: number) {
  if (isActive(agent) || agent.state === 'stalled') return false
  return typeof agent.endedAt === 'number'
    && Number.isFinite(agent.endedAt)
    && now - agent.endedAt > AGENT_STALE_TERMINAL_AFTER_MS
}

function stateText(agent: Agent) {
  const closing = formatFinalizationLine(agent.diagnostics)
  if (closing && (agent.state === 'running' || agent.state === 'stalled')) return closing
  return agent.stalled || agent.state === 'stalled'
    ? '卡住'
    : ({ running: '运行中', ok: '已完成', failed: '失败', aborted: '已中止', interrupted: '已中断', stalled: '卡住' }[agent.state])
}

function duration(agent: Pick<Agent, 'startedAt' | 'endedAt'>, now: number) {
  return `${Math.max(0, Math.round(((agent.endedAt ?? now) - agent.startedAt) / 1000))}s`
}

const RUNNING_ELAPSED_TICK_MS = 1_000

function RunningElapsed({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), RUNNING_ELAPSED_TICK_MS)
    return () => window.clearInterval(timer)
  }, [startedAt])
  return <small className="agent-row-time">{duration({ startedAt }, now)}</small>
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
  return formatCompactTokens(value)
}

export function agentDetailUsage(agent: Pick<AgentSummary, 'contextTokens' | 'contextWindowTokens' | 'inputTokens' | 'outputTokens' | 'cacheTokens'>): {
  context?: string
  cache?: string
  io?: string
} {
  const used = agent.contextTokens
  const windowSize = agent.contextWindowTokens
  const context = used && used > 0 && windowSize && windowSize > 0
    ? `${formatCompactTokens(used)}/${formatCompactTokens(windowSize)}`
    : windowSize && windowSize > 0
      ? `?/${formatCompactTokens(windowSize)}`
      : used && used > 0
        ? formatCompactTokens(used)
        : undefined
  const cache = cacheHitRate(agent.cacheTokens ?? 0, agent.inputTokens ?? 0) ?? undefined
  const input = agent.inputTokens ?? 0
  const output = agent.outputTokens ?? 0
  const io = input > 0 || output > 0
    ? `${formatCompactTokens(input)} / ${formatCompactTokens(output)}`
    : undefined
  return { context, cache, io }
}

function agentTokenTotal(agent: Pick<AgentSummary, 'inputTokens' | 'outputTokens' | 'cacheTokens' | 'contextTokens'>) {
  const counted = (agent.inputTokens ?? 0) + (agent.outputTokens ?? 0) + (agent.cacheTokens ?? 0)
  return counted > 0 ? counted : (agent.contextTokens ?? 0)
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
  'long-test': '长时测试'
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
  const taskLabel = agent.task?.trim() ? shortTaskLabel(agent.task) : ''
  if (taskLabel) return taskLabel
  const activity = agent.listSubtitle?.trim()
  if (activity) return localizedTaskSummary(activity)
  const profile = agent.name?.trim()
  return profile ? localizedProfileName(profile) : 'subagent'
}

type LiveAgentStatus = { text: string; severity: 'active' | 'quiet' | 'deadline' }

function liveToolActivityLabel(rawActivity: string, tokenSuffix?: string): string | undefined {
  const match = rawActivity.match(/^([a-z][a-z0-9_-]*)\b/i)
  if (!match) return undefined
  const name = match[1]
  const rest = rawActivity.slice(match[0].length).trim()
  const base = !rest || rest === '…'
    ? name
    : rest.startsWith('{')
      ? (() => {
        const summary = toolArgsSummary(name, rest)
        return summary !== '…' ? `${name} · ${summary}` : name
      })()
      : `${name} · ${rest}`
  return tokenSuffix ? `${base} · ${tokenSuffix}` : base
}

function latestWriteEditTokenLabel(agent: Agent): string | undefined {
  for (let i = agent.logs.length - 1; i >= 0; i -= 1) {
    const log = agent.logs[i]
    if (log.itemType !== 'tool') continue
    const name = (log.name ?? '').trim()
    const stats = fileChangeTokenStats(name, log.text)
    if (!stats) continue
    return liveTokenLabel(stats.payloadChars)
  }
  return undefined
}

const QUIET_STATUS_SECONDS = 30
const POSSIBLY_STUCK_SECONDS = 120

function liveAgentStatus(agent: Agent, now: number, activeChildCount = 0): LiveAgentStatus {
	if (activeChildCount > 0) {
		return { severity: 'active', text: `正在协调 · ${activeChildCount} 个子 agent 运行中` }
	}
  const closing = liveRunningProgressLine({
    state: agent.state,
    diagnostics: agent.diagnostics,
    activityActive: agent.activityActive,
    listSubtitle: agent.listSubtitle,
    now,
  })
  if (closing) return { severity: 'active', text: closing }
  const quietSeconds = agent.updatedAt === undefined ? undefined : Math.max(0, Math.floor((now - agent.updatedAt) / 1000))
  const activityActive = agent.activityActive === true
  const rawActivity = activityActive ? visibleAgentText(agent.listSubtitle ?? '').trim() : ''
  const liveName = rawActivity.match(/^([a-z][a-z0-9_-]*)\b/i)?.[1]
  const tokenSuffix = liveName === 'write' || liveName === 'edit' ? latestWriteEditTokenLabel(agent) : undefined
  const toolLabel = activityActive ? liveToolActivityLabel(rawActivity, tokenSuffix) : undefined
  const phase = toolLabel
    ? `最近活动 · ${toolLabel}`
    : '等待模型响应'
  const deadlineSeconds = agent.deadlineAt ? Math.max(0, Math.ceil((agent.deadlineAt - now) / 1000)) : undefined
  if (quietSeconds === undefined) {
    return { text: `${phase} · 等待新的状态事件`, severity: 'active' }
  }
  if (deadlineSeconds === 0) {
    return { text: `正在自动中止 · ${phase} · ${quietSeconds} 秒无新进展`, severity: 'deadline' }
  }
  if (quietSeconds >= POSSIBLY_STUCK_SECONDS) {
    const probe = diagnoseAgentProgress({
      now,
      state: agent.state,
      updatedAt: agent.updatedAt,
      stalled: agent.stalled,
      diagnostics: agent.diagnostics,
    })
    const prefix = probe.kind === 'output-recent' || probe.kind === 'cpu-progress'
      ? '工具仍在推进'
      : probe.kind === 'tool-quiet-alive'
        ? '工具静默未过门槛'
        : probe.kind === 'child-gone' || probe.kind === 'generation-mismatch'
          ? '进程已中断或世代失配'
          : probe.kind === 'seq-stale'
            ? '事件链路无新序号'
            : probe.kind === 'watchdog-stalled'
              ? '可能卡住'
              : '界面暂无新事件'
    return {
      text: `${prefix} · ${phase} · ${quietSeconds} 秒无新进展${deadlineSeconds === undefined ? '' : ` · ${deadlineSeconds} 秒后自动中止`}`,
      severity: 'quiet'
    }
  }
  if (quietSeconds >= QUIET_STATUS_SECONDS) {
    return {
      text: `暂无新状态 · ${phase} · ${quietSeconds} 秒无新进展${deadlineSeconds === undefined ? '' : ` · ${deadlineSeconds} 秒后自动中止`}`,
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
  // Identity comes only from explicit stable fields: the worker role/type the
  // backend establishes on start (or a new run), then the name, then the id.
  // `name` alone is not trusted for display because same-run update events used
  // to overwrite it with the *active tool* (bash/grep/read/…) before the backend
  // kept run identity stable; role-first also covers unknown future tool names
  // and old persisted rows where only `name` was polluted.
  return agent.role?.trim() || agent.name?.trim() || agent.agentId
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

export type CloseoutListItem = { item: string; reason?: string; verify?: string }
export type CloseoutSummary = {
  closeout: string
  integrationVerify?: string
  commit?: string
  committedPaths: string[]
  remainingDirtyPaths: string[]
  cleanedBranches: string[]
  cleanedWorktrees: string[]
  retained: CloseoutListItem[]
  needsFixer: CloseoutListItem[]
  needsUser: CloseoutListItem[]
  docsUpdated: string[]
  residualRisks: CloseoutListItem[]
}

/** Keys the secretary closeout contract (agents/secretary/AGENT.md) emits, one `key=value` per line. */
const closeoutKeySet = new Set(['closeout', 'integration_verify', 'commit', 'committed_paths', 'remaining_dirty_paths', 'cleaned_branches', 'cleaned_worktrees', 'retained', 'needs_fixer', 'needs_user', 'docs_updated', 'residual_risks'])

function closeoutScalarList(raw: string): string[] {
  const text = raw.trim()
  if (!text || text === '[]') return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map(entry => typeof entry === 'string' ? entry : JSON.stringify(entry))
  } catch { /* models may emit non-strict JSON; keep the raw text below */ }
  return [text]
}

function closeoutItemList(raw: string): CloseoutListItem[] {
  const text = raw.trim()
  if (!text || text === '[]') return []
  try {
    const parsed: unknown = JSON.parse(text)
    if (Array.isArray(parsed)) {
      return parsed.map((entry): CloseoutListItem => {
        if (typeof entry === 'string') return { item: entry }
        if (entry && typeof entry === 'object') {
          const record = entry as Record<string, unknown>
          const item = String(record.item ?? record.name ?? '').trim()
          if (!item) return { item: JSON.stringify(entry) }
          const reason = record.reason === undefined || record.reason === null ? undefined : String(record.reason)
          const verify = record.verify === undefined || record.verify === null ? undefined : String(record.verify)
          return reason === undefined && verify === undefined ? { item } : { item, reason, verify }
        }
        return { item: String(entry) }
      }).filter(entry => entry.item)
    }
  } catch { /* keep the raw text below */ }
  return [{ item: text }]
}

/**
 * Recognizes the secretary's terminal closeout summary — the machine-readable
 * `key=value` block its AGENT.md contract requires it to return first — and
 * splits the surrounding prose so the detail view can render a structured
 * card instead of a newline-collapsed wall of contract text.
 */
export function parseCloseoutSummary(text: string): { summary: CloseoutSummary; preamble: string; remainder: string } | null {
  const lines = visibleAgentText(text).split(/\r?\n/)
  // A fenced code block quoting the contract template must not become a card.
  let fenced = false
  const keyFlags = lines.map(line => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced
    if (fenced) return null
    const match = line.match(/^\s*([a-z_]+)\s*=/)
    return match && closeoutKeySet.has(match[1]) ? match[1] : null
  })
  let start = -1
  let end = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (!keyFlags[index]) continue
    let stop = index
    while (stop + 1 < lines.length && keyFlags[stop + 1]) stop += 1
    const blockKeys = new Set(keyFlags.slice(index, stop + 1).filter((key): key is string => Boolean(key)))
    if (blockKeys.size >= 2 && blockKeys.has('closeout')) { start = index; end = stop; break }
    index = stop
  }
  if (start < 0) return null
  const fields = new Map<string, string>()
  for (let cursor = start; cursor <= end; cursor += 1) {
    const match = lines[cursor].match(/^\s*([a-z_]+)\s*=\s*(.*)$/)
    if (match) fields.set(match[1], match[2].trim())
  }
  // The contract template writes `closeout=pass | needs-action | blocked`; a
  // literal echo of the template is not a result. Take the concrete value
  // before any `|`.
  const firstToken = (raw: string | undefined) => raw?.split('|')[0]?.trim() || ''
  const closeout = firstToken(fields.get('closeout'))
  if (!closeout) return null
  const summary: CloseoutSummary = {
    closeout,
    ...(fields.has('integration_verify') ? { integrationVerify: firstToken(fields.get('integration_verify')) } : {}),
    ...(fields.has('commit') ? { commit: firstToken(fields.get('commit')) } : {}),
    committedPaths: closeoutScalarList(fields.get('committed_paths') ?? '[]'),
    remainingDirtyPaths: closeoutScalarList(fields.get('remaining_dirty_paths') ?? '[]'),
    cleanedBranches: closeoutScalarList(fields.get('cleaned_branches') ?? '[]'),
    cleanedWorktrees: closeoutScalarList(fields.get('cleaned_worktrees') ?? '[]'),
    retained: closeoutItemList(fields.get('retained') ?? '[]'),
    needsFixer: closeoutItemList(fields.get('needs_fixer') ?? '[]'),
    needsUser: closeoutItemList(fields.get('needs_user') ?? '[]'),
    docsUpdated: closeoutScalarList(fields.get('docs_updated') ?? '[]'),
    residualRisks: closeoutItemList(fields.get('residual_risks') ?? '[]'),
  }
  return {
    summary,
    preamble: lines.slice(0, start).join('\n').trim(),
    remainder: lines.slice(end + 1).join('\n').trim(),
  }
}

const closeoutStateLabel: Record<string, { text: string; tone: 'ok' | 'warn' | 'error' }> = {
  pass: { text: '收尾通过', tone: 'ok' },
  'needs-action': { text: '需处理', tone: 'warn' },
  blocked: { text: '受阻', tone: 'error' },
}
const closeoutVerifyLabel: Record<string, string> = { pass: '验证通过', fail: '验证失败', none: '无可执行验证' }

function CloseoutPathGroup({ label, paths }: { label: string; paths: string[] }) {
  if (!paths.length) return null
  const list = <ul className="closeout-paths">{paths.map((path, index) => <li key={`${index}-${path}`}><code>{path}</code></li>)}</ul>
  return <div className="closeout-group">
    <span className="closeout-group-label">{label} <b>{paths.length}</b></span>
    {paths.length > 6 ? <details><summary>展开全部</summary>{list}</details> : list}
  </div>
}

function CloseoutItemGroup({ label, entries }: { label: string; entries: CloseoutListItem[] }) {
  if (!entries.length) return null
  return <div className="closeout-group">
    <span className="closeout-group-label">{label} <b>{entries.length}</b></span>
    <ul className="closeout-items">{entries.map((entry, index) => <li key={index}>{entry.item}{entry.reason ? <small> — {entry.reason}</small> : null}{entry.verify ? <small>（验证：{entry.verify}）</small> : null}</li>)}</ul>
  </div>
}

function SecretaryCloseoutCard({ summary }: { summary: CloseoutSummary }) {
  const state = closeoutStateLabel[summary.closeout] ?? { text: summary.closeout, tone: 'warn' as const }
  const commit = summary.commit ?? ''
  const commitMatch = commit.match(/^(created|already-clean):([0-9a-f]+)$/i)
  return <div className={`secretary-closeout ${state.tone}`} data-testid="secretary-closeout-card">
    <div className="secretary-closeout-head">
      <span className={`closeout-state ${state.tone}`}>{state.text}</span>
      {summary.integrationVerify && <span className={`closeout-verify ${summary.integrationVerify}`} title="integration_verify">{closeoutVerifyLabel[summary.integrationVerify] ?? summary.integrationVerify}</span>}
      {commitMatch && <code className="closeout-commit" title={commitMatch[2]}>{commitMatch[1] === 'created' ? '提交' : '已是干净'} {commitMatch[2].slice(0, 10)}</code>}
      {commit.startsWith('blocked:') && <span className="closeout-commit-blocked" title={commit}>提交受阻 · {commit.slice('blocked:'.length)}</span>}
      {commit === 'not-required' && <span className="closeout-commit-na">无需提交</span>}
    </div>
    <CloseoutPathGroup label="提交路径" paths={summary.committedPaths} />
    <CloseoutPathGroup label="保留未提交" paths={summary.remainingDirtyPaths} />
    <CloseoutPathGroup label="已清理分支" paths={summary.cleanedBranches} />
    <CloseoutPathGroup label="已清理工作树" paths={summary.cleanedWorktrees} />
    <CloseoutPathGroup label="已更新文档" paths={summary.docsUpdated} />
    <CloseoutItemGroup label="保留项" entries={summary.retained} />
    <CloseoutItemGroup label="需修复" entries={summary.needsFixer} />
    <CloseoutItemGroup label="需用户决策" entries={summary.needsUser} />
    <CloseoutItemGroup label="残余风险" entries={summary.residualRisks} />
  </div>
}

function SecretaryCloseoutResult({ parsed }: { parsed: { summary: CloseoutSummary; preamble: string; remainder: string } }) {
  return <>
    {parsed.preamble ? <AssistantTranscriptContent message={{ content: parsed.preamble }} expandSteps={false} /> : null}
    <SecretaryCloseoutCard summary={parsed.summary} />
    {parsed.remainder ? <AssistantTranscriptContent message={{ content: parsed.remainder }} expandSteps={false} /> : null}
  </>
}

function agentTranscript(agent: Agent, finalResult: string): AssistantTranscriptMessage[] {
  // Build ONE unified message — exactly like the main agent transcript — so the
  // subagent detail reuses AssistantTranscriptContent verbatim: one "N 个步骤"
  // card containing all thinking + tools, followed by the text content.
  // When finalResult itself is the secretary closeout contract block, the
  // detail view renders it as a structured card instead.
  const closeoutCard = parseCloseoutSummary(visibleAgentText(finalResult))
  const activities: TranscriptActivity[] = []
  const tools: TranscriptTool[] = []
  let nextIndex = 0
  const activityIndex = (log: Log) => log.contentIndex ?? nextIndex
  const consumed = new Set<number>()
  const nameOf = (log: Log) => (log.name ?? '').trim()
  const takeResult = (tool: Log, toolIndex: number): Log | undefined => {
    // Stable identity wins: a call id binds its own result even among same-name
    // concurrent tools whose results arrive out of order. Legacy rows (no id)
    // keep the contentIndex/adjacency/name fallbacks below.
    if (tool.toolCallId) {
      const byId = agent.logs.findIndex(log => log.itemType === 'toolResult' && log.toolCallId === tool.toolCallId)
      if (byId >= 0) { consumed.add(byId); return agent.logs[byId] }
      return undefined
    }
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
      activities.push({ type: 'thinking', id: `thinking:${log.id}`, contentIndex, content: text, ...(typeof log.charCount === 'number' ? { charCount: log.charCount } : {}) })
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
      // Orphan result: its tool row never reached this panel (mid-run reload or a
      // lost stream frame — the runtime never re-sends already-streamed tool calls).
      // Raw tool output must never become message content: the markdown renderer
      // collapses newlines and turns a 1500-char file slice into a prose wall.
      // Keep it inspectable as a finished result card inside the steps group.
      if (!consumed.has(index) && text) {
        const contentIndex = activityIndex(log)
        const tool: TranscriptTool = { id: `subagent-result-${log.id}`, name: nameOf(log) || 'tool', input: '', result: text, error: log.isError, startedAt: agent.startedAt, finished: true }
        tools.push(tool)
        activities.push({ type: 'tool', contentIndex, tool })
        nextIndex = Math.max(nextIndex, contentIndex + 1)
      }
    } else if (text) {
      // The raw closeout block would duplicate the structured card rendered from
      // finalResult — drop the step copy when the card is coming.
      if (!(closeoutCard && parseCloseoutSummary(text))) {
        const contentIndex = activityIndex(log)
        activities.push({ type: 'text', id: `text:${log.id}`, contentIndex, content: text })
        nextIndex = Math.max(nextIndex, contentIndex + 1)
      }
    }
  }
  const messages: AssistantTranscriptMessage[] = []
  const hasSteps = activities.length > 0
  if (hasSteps) {
    messages.push({
      content: '',
      thinking: activities.find((activity): activity is Extract<TranscriptActivity, { type: 'thinking' }> => activity.type === 'thinking')?.content,
      tools: tools.length > 0 ? tools : undefined,
      activities: hasSteps ? activities : undefined,
      // The worker may keep running through verification/merge closeout after its
      // final prose is complete. Streamdown's streaming parser is only for text
      // that can still grow; reparsing a finished large report during closeout can
      // starve input and delay the already-arrived terminal state in the renderer.
      streaming: isActive(agent) && !isTerminalFinalizingPhase(agent.diagnostics?.finalizationPhase)
    })
  }
  if (finalResult && finalResult.trim() && !activities.some(activity => activity.type === 'text' && activity.content.includes(finalResult.trim()))) {
    messages.push({ content: finalResult })
  }
  if (!messages.length && !isActive(agent)) messages.push({ content: agent.state === 'ok' ? '任务已完成' : agent.state === 'failed' ? '任务失败。请查看技术详情中的完整错误。' : `任务${stateText(agent)}，尚无返回内容。` })
  // Isolation failed on an existing git repo (worktree add / unborn HEAD).
  // Non-git folders never take this path: workers run in the project directory.
  if (agent.worktreeError) messages.unshift({ content: '工人没有启动，这次任务也没有自动交回主管。当前 Git 仓库无法建立隔离工作区。未使用 Git 的文件夹不会建隔离工作区，工人会直接在项目目录运行。请查看技术详情后重试。' })
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

export function SubagentPanel({ host, sessionId, projectPath, onOpenDocument, retainedWorktreeDispositionAvailable = false, visible: paneVisible = true, headerSlot, onRunningChange, onRunningCountChange, onAgentStarted, onManualStatusCheck }: { host: PipiHostAPI; sessionId?: string; projectPath?: string; onOpenDocument?: (path: string) => void; retainedWorktreeDispositionAvailable?: boolean; visible?: boolean; headerSlot?: HTMLElement | null; onRunningChange?: (running: boolean) => void; onRunningCountChange?: (count: number) => void; onAgentStarted?: () => void; onManualStatusCheck?: (agentIDs: string[]) => void }) {
  const terminalAvailable = Boolean(host.terminal?.open)
  const [agents, setAgents] = useState<Agent[]>([])
  // Selection is a ROW key (agentId+runId), never the bare agentId: two runs of
  // one slug are distinct rows, and selecting one must select exactly that run.
  const [selectedKey, setSelectedKey] = useState<string>()
  const [page, setPage] = useState(0)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [ratio, setRatio] = useState(initialRatio)
  const [follow, setFollow] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
	const [abortError, setAbortError] = useState('')
	const [abortingIds, setAbortingIds] = useState<Set<string>>(() => new Set())
  const [hiddenClearedKeys, setHiddenClearedKeys] = useState<Set<string>>(() => new Set())
  const [now, setNow] = useState(() => Date.now())
  const listRef = useRef<HTMLDivElement>(null)
  const loadGeneration = useRef(0)
  const logRenderTimers = useRef<Set<number>>(new Set())
  // Agents already running when the panel mounts (initial snapshot or a session
  // switch) are not "new runs": seed the baseline from the snapshot so they
  // never fire onAgentStarted and force-open a pane the user (or the narrow
  // viewport) collapsed. Only running-count increases after hydration reveal.
  const hydratedRef = useRef(false)
  const previousRunningRef = useRef(0)
  const selected = agents.find(agent => agentRowKey(agent) === selectedKey)

  useEffect(() => () => {
    for (const timer of logRenderTimers.current) window.clearTimeout(timer)
    logRenderTimers.current.clear()
  }, [sessionId])

  // Extracted so the full-page load-error state can retry the same loader.
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setLoadError('')
    try {
      // The durable host index survives restarts, but the visible tree belongs to the
      // selected chat. Replacing (rather than accumulating) the snapshot keeps agents
      // from another session out of the panel. The 'history' scope returns every
      // retained run of this session — including an older completed run of the same
      // agentId — so records restored after a restart stay visible instead of being
      // collapsed into one current summary per agentId.
      const snapshot = await host.listAgents(sessionId, 'history')
      if (generation !== loadGeneration.current) return
      if (!hydratedRef.current) {
        previousRunningRef.current = snapshot.filter(isActive).length
        hydratedRef.current = true
      }
      // The session-change effect already cleared the previous chat. Merge the
      // snapshot into any events that arrived while this request was in flight,
      // otherwise a fast START can be erased by a slower empty snapshot.
      setAgents(current => snapshot.reduce((next, agent) => applyAgentEvent(next, { type: 'agent', agent }, sessionId), current))
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
    hydratedRef.current = false
    previousRunningRef.current = 0
    setAgents([])
    setSelectedKey(undefined)
    setHiddenClearedKeys(new Set())
    setPage(0)
		setAbortError('')
		setAbortingIds(new Set())
    void load()
    const off = host.subscribeAgents(event => setAgents(current => sessionScopedEvent(current, event, sessionId)
      ? applyAgentEvent(current, event, sessionId)
      : current))
    return () => {
      loadGeneration.current += 1
      off()
    }
  }, [host, load, sessionId])

  useEffect(() => {
    // Auto-select the newest row; if the current selection no longer exists in
    // this session's tree (e.g. a session switch reloaded a different set),
    // fall back to the newest row or clear the stale key.
    const exists = agents.some(agent => agentRowKey(agent) === selectedKey)
    if (exists) return
    setSelectedKey(agents.length ? agentRowKey(treeOrder(agents).at(-1)!) : undefined)
  }, [agents, selectedKey])

  useEffect(() => {
    localStorage.setItem(splitKey, String(ratio))
  }, [ratio])

  const hasRunning = agents.some(isActive)
  useEffect(() => {
    if (!hasRunning) return
    // Agent events update the activity text immediately. Age quiet/deadline
    // labels on a coarse clock; running elapsed time ticks in RunningElapsed.
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(timer)
  }, [hasRunning])

  useEffect(() => {
    if (!selected) return
    const identity = episodeIdentity(selected)
    // No exact episode identity → no subscription. A blank-keyed subscription
    // would receive every run of the slug and paint them under this row.
    if (!identity) return
    const { agentId, sessionId: logSessionId, runId: logRunId } = identity
    let timer: number | undefined
    let pending: Extract<AgentEvent, { type: 'agent_log' }>[] = []
    const flush = () => {
      if (timer !== undefined) logRenderTimers.current.delete(timer)
      timer = undefined
      if (!pending.length) return
      const batch = pending
      pending = []
      setAgents(current => current.map(agent => {
        // Strict triple match: only the row that owns the subscribed episode
        // receives the batch, and only events carrying that exact identity land.
        // Identity-less rows never receive streamed logs; identity-less events
        // are dropped instead of falling back to the agentId.
        if (!sameEpisode(agent, identity)) return agent
        const matching = batch.filter(event => sameEpisode(event, identity))
        if (!matching.length) return agent
        const logs = matching.reduce((next, event) => applyLogDelta(next, event), agent.logs)
        return logs === agent.logs ? agent : { ...agent, logs }
      }))
    }
    const off = host.subscribeAgentLog(agentId, event => {
      pending.push(event)
      if (timer === undefined) {
        timer = window.setTimeout(flush, AGENT_LOG_RENDER_INTERVAL_MS)
        logRenderTimers.current.add(timer)
      }
    }, logSessionId, logRunId)
    return () => {
      off()
      // Keep an already queued batch alive across a same-agent run switch. The
      // exact-identity check in flush rejects stale old-run frames.
    }
  }, [host, selected?.agentId, selected?.sessionId, selected?.runId])

  // Backfill the selected row's transcript from the host's log cache. The live
  // subscription only delivers events from subscribe-time on, so a row selected
  // (or a renderer reloaded) mid-run starts with a partial transcript — and the
  // runtime never re-sends already-streamed tool calls, so those rows would be
  // lost forever, leaving their toolResults orphaned. The host updates its cache
  // synchronously before relaying each event, so the snapshot is a superset of
  // everything this panel could have received live: merge it in (never skip
  // just because rows exist) instead of the old fill-only-when-empty.
  useEffect(() => {
    const identity = selected ? episodeIdentity(selected) : undefined
    // Only an exact-episode row fetches its cached transcript: a blank-keyed
    // read would return some other run's logs under this row's header.
    if (!identity || !host.getAgentLogs) return
    let cancelled = false
    void host.getAgentLogs(identity.agentId, identity.sessionId, identity.runId).then(entries => {
      if (cancelled || !entries.length) return
      setAgents(current => current.map(agent => {
        if (!sameEpisode(agent, identity)) return agent
        const logs = mergeAgentLogBackfill(agent.logs, entries, identity.agentId)
        return logs === agent.logs ? agent : { ...agent, logs }
      }))
    })
    return () => { cancelled = true }
  }, [host, selected?.agentId, selected?.sessionId, selected?.runId])

  // Explicit agent-history view (scope: 'agent' concatenates every run of this
  // agentId). Distinct from the default current-run transcript and clearly
  // labeled in the detail pane, so a cross-run transcript is never mistaken for
  // the current run's output.
  const [historyLogs, setHistoryLogs] = useState<Log[] | undefined>()
  const [historyError, setHistoryError] = useState('')
  useEffect(() => {
    setHistoryLogs(undefined)
    setHistoryError('')
  }, [selected?.agentId, selected?.sessionId, selected?.runId])
  const showHistory = async (agent: Agent) => {
    if (!host.getAgentLogs) return
    const identity = episodeIdentity(agent)
    // Explicit history stays an exact-episode read too: no blank-keyed scopes.
    if (!identity) return
    setHistoryError('')
    try {
      const entries = await host.getAgentLogs(identity.agentId, identity.sessionId, identity.runId, 'agent')
      let logs: Log[] = []
      for (const entry of entries) logs = applyLogDelta(logs, { type: 'agent_log', agentId: identity.agentId, ...entry })
      setHistoryLogs(logs)
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : '无法加载运行历史')
    }
  }

  useEffect(() => {
    if (follow && agents.length) setPage(0)
  }, [agents.length, follow])

  const summary = useMemo(() => {
    const runningAgents = agents.filter(isActive)
    const runningTokens = runningAgents.reduce((sum, agent) => sum + agentTokenTotal(agent), 0)
    return {
      running: runningAgents.length,
      succeeded: agents.filter(agent => agent.state === 'ok').length,
      failed: agents.filter(agent => agent.state === 'failed').length,
      runningTokens,
    }
  }, [agents])

  useEffect(() => {
    onRunningCountChange?.(summary.running)
    onRunningChange?.(summary.running > 0)
    if (hydratedRef.current && summary.running > previousRunningRef.current) onAgentStarted?.()
    // A session switch clears the list (running temporarily 0) and the reload's
    // snapshot re-merges the pre-existing running agents afterwards. If the
    // baseline decays to 0 during that cleared window, those agents look like a
    // fresh run and onAgentStarted force-opens a pane the user collapsed. Hold
    // the baseline while a snapshot reload is in flight.
    if (!loading) previousRunningRef.current = summary.running
  }, [onAgentStarted, onRunningChange, onRunningCountChange, summary.running, loading])

  useEffect(() => () => {
    onRunningCountChange?.(0)
    onRunningChange?.(false)
  }, [onRunningChange, onRunningCountChange])

  // View layering only: rows explicitly marked as test fixtures and
  // long-settled terminal rows fold into the collapsed 历史 group; the main list
  // keeps active/recent rows. A just-finished real worker never matches either
  // rule, so a record the user watched complete always stays visible.
  // 仅当前视图隐藏（清空）的行在分区前整体过滤；不触碰持久化数据，重载即恢复。
  const presented = agents.filter(agent => !hiddenClearedKeys.has(agentRowKey(agent)))
  const currentAgents: Agent[] = []
  const historyAgents: Agent[] = []
  for (const agent of presented)
    ((agent.testFixture === true || isStaleTerminalRow(agent, now)) ? historyAgents : currentAgents).push(agent)
  const ordered = treeOrder(currentAgents)
  const archiveOrdered = treeOrder(historyAgents)
  const pageCount = Math.max(1, Math.ceil(ordered.length / pageSize))
  const activePage = Math.min(page, pageCount - 1)
  const visibleAgents = ordered.slice(Math.max(0, ordered.length - (activePage + 1) * pageSize), ordered.length - activePage * pageSize)
  const newestKey = ordered.length ? agentRowKey(ordered.at(-1)!) : undefined
  // Rows are episodes: when one semantic agentId owns two displayed runs, its
  // per-row testid must disambiguate them instead of colliding.
  const idOccurrences = new Map<string, number>()
  for (const agent of agents) idOccurrences.set(agent.agentId, (idOccurrences.get(agent.agentId) ?? 0) + 1)
  const rowTestId = (agent: Agent) =>
    (idOccurrences.get(agent.agentId) ?? 0) > 1 ? `${agent.agentId}--${agent.runId ?? 'legacy'}` : agent.agentId

  useEffect(() => {
    if (page !== activePage) setPage(activePage)
  }, [activePage, page])

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el || !follow || !paneVisible) return
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  }, [follow, newestKey, paneVisible, visibleAgents.length])

  const staleAgentIDs = staleRunningAgentIDs(agents, now)
  const requestManualStatusCheck = (agentIDs: string[]) => {
    if (!agentIDs.length) return
    onManualStatusCheck?.(agentIDs)
  }
  const check = async (agent: Agent) => {
    const identity = episodeIdentity(agent)
    // Inert without exact identity: no host probe with synthesized blanks.
    if (!identity) return
    requestManualStatusCheck([agent.agentId])
    // Capture the session this probe belongs to. The user may switch chats while the
    // host read is pending; a response for the old session must never write into the
    // new session's list, and an unmounted panel must not setState at all.
    const session = sessionId
    const generation = loadGeneration.current
    // Exact episode identity: the probe describes the run this row shows, never
    // the host's globally newest row reusing the same semantic slug.
    const update = await host.checkAgent(identity.sessionId, identity.agentId, identity.runId)
    if (generation !== loadGeneration.current || session !== sessionId) return
    // A probe response is an async host read: it may describe a run the live feed
    // already replaced, so it merges with snapshot precedence, never live trust.
    // The merge itself is exact-triple guarded (applyAgentEvent never lets a stale
    // run rewrite a row that a newer run already owns).
    setAgents(current => applyAgentEvent(current, { type: 'agent', agent: update }, session))
  }
  const worktree = async (agent: Agent, action: 'merge' | 'discard') => {
    const identity = episodeIdentity(agent)
    // Inert without exact identity: no disposition request with synthesized blanks.
    if (!identity) return
    // Exact episode identity for worktree disposition: the request and the returned
    // status both bind to the selected row's session+run. The returned status carries
    // its own identity; a row that has since switched runs ignores it (own-run guard),
    // so a slow response for a retired run cannot repaint the current run's badge.
    const status = action === 'merge'
      ? await host.mergeWorktree(identity.sessionId, identity.agentId, identity.runId)
      : await host.discardWorktree(identity.sessionId, identity.agentId, identity.runId)
    setAgents(current => applyAgentEvent(current, { type: 'worktree', status }))
  }
  const openWorktreeTerminal = async (wtPath: string) => {
    if (!host.terminal?.open) return
    try {
      await host.terminal.open({ cwd: wtPath })
    } catch (error) {
      setAbortError(`无法打开终端：${error instanceof Error ? error.message : '打开失败'}`)
    }
  }
	const abort = async (agent: Agent) => {
		const identity = episodeIdentity(agent)
		// Inert without exact identity: no stop request with synthesized blanks —
		// the host would reject the episode, and a slug-only stop could kill a
		// newer run reusing the same semantic id.
		if (!identity || abortingIds.has(agentRowKey(agent))) return
		setAbortError('')
		setAbortingIds(current => new Set(current).add(agentRowKey(agent)))
		try {
			await host.abortAgent(identity.sessionId, identity.agentId, identity.runId)
		} catch (error) {
			setAbortError(`无法停止 ${agentDisplayName(agent)}：${error instanceof Error ? error.message : '停止请求失败'}`)
		} finally {
			setAbortingIds(current => {
				const next = new Set(current)
				next.delete(agentRowKey(agent))
				return next
			})
		}
	}
  const resolve = async (agent: Agent) => {
    const identity = episodeIdentity(agent)
    // Inert without exact identity: no resolve request with synthesized blanks.
    if (!identity) return
    // Exact episode identity: mark the run this row shows. The completion handler
    // re-reads the CURRENT row state and matches the exact triple, so a newer run
    // that arrived while the request was in flight is never marked handled.
    try {
      await host.resolveAgent(identity.sessionId, identity.agentId, identity.runId)
      setAgents(current => current.map(item =>
        sameEpisode(item, identity)
          ? { ...item, handled: true }
          : item))
    } catch (error) {
      setAbortError(`无法标记 ${agentDisplayName(agent)} 已处理：${error instanceof Error ? error.message : '请求失败'}`)
    }
  }
  // 「清空」只隐藏当前视图里本会话的终态行（不改任何持久化数据）:running/stalled
  // 行与仍待用户处理（pendingReview 工作树）的行保留；切换会话或重新加载后隐藏即失效。
  const clearFinished = () => {
    if (!sessionId) return
    setPage(0)
    setHiddenClearedKeys(current => {
      const next = new Set(current)
      for (const agent of agents) {
        if (agent.sessionId && agent.sessionId !== sessionId) continue
        if (isActive(agent) || agent.state === 'stalled') continue
        if (agent.worktree?.lifecycle === 'pendingReview') continue
        next.add(agentRowKey(agent))
      }
      return next
    })
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
    {headerSlot && paneVisible && createPortal(<SubagentHeader total={agents.length} {...summary} clearDisabled={!sessionId} onClear={clearFinished} />, headerSlot)}
    {staleAgentIDs.length > 0 && <div className="subagent-status-channel-warning" data-testid="subagent-status-channel-warning" role="status">
      <p>{statusChannelWarningText(staleAgentIDs)}</p>
      <button type="button" data-testid="subagent-manual-status-check" title="向主会话发出用户主动的状态查询；不会自动重新派发 agent" onClick={() => requestManualStatusCheck(staleAgentIDs)}>手动检查</button>
    </div>}
		{abortError && <div className="subagent-abort-error"><DismissibleError message={abortError} onDismiss={() => setAbortError('')} /></div>}
    {loading
      ? <div className="subagent-loading" role="status"><span className="agent-spinner" aria-hidden="true" />正在加载 subagents…</div>
      : loadError
        ? <div className="subagent-empty" data-testid="subagent-load-error"><b>!</b><strong>未能加载 subagents</strong><DismissibleError message={loadError} onDismiss={() => setLoadError('')} onRetry={() => void load()} /></div>
        : !agents.length
          ? <div className="subagent-empty"><b>♙</b><strong>还没有 subagent</strong><p>让 pi 用 subagent 工具委派任务后，这里会实时显示 agent 树。</p></div>
          : <div className="subagent-split" style={{ gridTemplateRows: `${ratio}fr 6px ${1 - ratio}fr` }}>
            <div ref={listRef} className="agent-list compact" data-density="compact" onScroll={event => setFollow(event.currentTarget.scrollHeight - event.currentTarget.scrollTop - event.currentTarget.clientHeight < 24)}>
              {visibleAgents.map(agent => <AgentRow
                key={agentRowKey(agent)}
                testId={rowTestId(agent)}
                agent={agent}
				childCount={agents.filter(candidate => candidate.parentId === agent.agentId).length}
				activeChildCount={agents.filter(candidate => candidate.parentId === agent.agentId && isActive(candidate)).length}
                selected={agentRowKey(agent) === selectedKey}
				aborting={abortingIds.has(agentRowKey(agent))}
				now={now}
                onSelect={() => setSelectedKey(agentRowKey(agent))}
				onAbort={() => void abort(agent)}
                onResolve={() => void resolve(agent)}
              />)}
              {ordered.length > pageSize && <div className="agent-pager">
                <button disabled={activePage === 0} onClick={() => setPage(value => value - 1)}>较新</button>
                <span>最新第 {activePage + 1}/{pageCount} 页</span>
                <button disabled={(activePage + 1) * pageSize >= ordered.length} onClick={() => setPage(value => value + 1)}>较早</button>
              </div>}
              {archiveOrdered.length > 0 && (
                <div className="agent-archive" data-testid="subagent-archive">
                  <button type="button" className="agent-archive-toggle" data-testid="subagent-archive-toggle" aria-expanded={historyOpen} onClick={() => setHistoryOpen(value => !value)}>
                    {historyOpen ? '▾' : '▸'} 历史（{archiveOrdered.length}）
                  </button>
                  {historyOpen && archiveOrdered.map(agent => <AgentRow
                    key={agentRowKey(agent)}
                    testId={rowTestId(agent)}
                    agent={agent}
                    childCount={agents.filter(candidate => candidate.parentId === agent.agentId).length}
                    activeChildCount={agents.filter(candidate => candidate.parentId === agent.agentId && isActive(candidate)).length}
                    selected={agentRowKey(agent) === selectedKey}
                    aborting={abortingIds.has(agentRowKey(agent))}
                    now={now}
                    onSelect={() => setSelectedKey(agentRowKey(agent))}
                    onAbort={() => void abort(agent)}
                    onResolve={() => void resolve(agent)}
                  />)}
                </div>
              )}
            </div>
            <div className="subagent-divider" aria-label="调整 agent 列表高度" role="separator" onPointerDown={startDrag} />
			<AgentDetail agent={selected} activeChildCount={selected ? agents.filter(candidate => candidate.parentId === selected.agentId && isActive(candidate)).length : 0} aborting={Boolean(selected && abortingIds.has(agentRowKey(selected)))} now={now} projectPath={projectPath} onOpenDocument={onOpenDocument} retainedWorktreeDispositionAvailable={retainedWorktreeDispositionAvailable} terminalAvailable={terminalAvailable} onCheck={check} onWorktree={worktree} onOpenWorktreeTerminal={path => void openWorktreeTerminal(path)} onAbort={agent => void abort(agent)} historyLogs={historyLogs} historyError={historyError} canShowHistory={Boolean(host.getAgentLogs)} onShowHistory={agent => void showHistory(agent)} onHideHistory={() => { setHistoryLogs(undefined); setHistoryError('') }} />
          </div>}
  </section>
}

/**
 * Keep another session's agents out of this panel, and identity-less events
 * out of the tree entirely.
 *
 * Every live event must carry a non-empty {sessionId, agentId, runId}: an
 * event without that triple names no episode, and matching it by agentId
 * alone would let it repaint whichever same-slug row happens to be displayed —
 * the exact cross-run/cross-session misbinding this contract removes. An
 * unscoped panel (no sessionId prop, aggregating hosts) still admits
 * identity-carrying agent events; worktree/log events must additionally name
 * a row already in this tree by the exact triple.
 */
function sessionScopedEvent(current: Agent[], event: AgentEvent, sessionId?: string): boolean {
  if (event.type === 'agent') {
    if (!episodeIdentity(event.agent)) return false
    if (!sessionId) return true
    return event.agent.sessionId === sessionId
  }
  if (event.type === 'worktree') {
    const identity = episodeIdentity(event.status)
    if (!identity) return false
    if (sessionId && event.status.sessionId !== sessionId) return false
    return current.some(agent => sameEpisode(agent, identity))
  }
  const identity = episodeIdentity(event)
  if (!identity) return false
  if (sessionId && event.sessionId !== sessionId) return false
  return current.some(agent => sameEpisode(agent, identity))
}

/**
 * Exact episode identity of an agent row, a worktree status, or a log event:
 * all three fields must be non-empty strings. A carrier without this identity
 * names no episode — it may still be displayed (host snapshot rows) but its
 * controls are inert, it issues no subscriptions or host reads, and events
 * carrying it are ignored. Blank strings are NOT identity: `''` is the absent
 * value a synthesized call would send, and the host would reject the episode.
 */
type EpisodeIdentity = { sessionId: string; agentId: string; runId: string }

function episodeIdentity(carrier: { sessionId?: string; agentId: string; runId?: string }): EpisodeIdentity | undefined {
  const { sessionId, agentId, runId } = carrier
  if (!sessionId || !agentId || !runId) return undefined
  return { sessionId, agentId, runId }
}

/**
 * Stable list/React key for one displayed run. Rows are episodes — two runs of
 * the same semantic agentId are two rows, and in aggregate mode the same
 * (agentId, runId) can exist in TWO sessions — so the key is the exact episode
 * triple; legacy identity-less rows fall back to the bare agentId alone.
 */
function agentRowKey(agent: Pick<AgentSummary, 'sessionId' | 'agentId' | 'runId'>): string {
  return agent.runId ? `${agent.sessionId ?? ''}\u0000${agent.agentId}\u0000${agent.runId}` : agent.agentId
}

/** Strict same-episode test: non-empty identity on both sides, equal on all three fields. */
function sameEpisode(carrier: { sessionId?: string; agentId: string; runId?: string }, identity: EpisodeIdentity): boolean {
  const own = episodeIdentity(carrier)
  if (!own) return false
  return own.sessionId === identity.sessionId && own.agentId === identity.agentId && own.runId === identity.runId
}

/**
 * Exact-episode guard for worktree badges. A status belongs to its own run
 * alone: a late closeout from a retired run must not repaint the current run's
 * badge, and a status without non-empty identity cannot be attributed to any
 * episode — an agentId fallback would repaint whichever same-slug row happens
 * to be displayed, so it is ignored instead.
 */
function worktreeStatusOwnsRow(agent: Agent, status: WorktreeStatus): boolean {
  const identity = episodeIdentity(status)
  if (!identity) return false
  return sameEpisode(agent, identity)
}

const TERMINAL_AGENT_STATES: readonly AgentState[] = ['ok', 'failed', 'aborted', 'interrupted']

/**
 * Resolve the transient stall flag for one merged agent event. A terminal state
 * always wins over an inherited stall, and a running event that does not itself
 * carry `stalled: true` is progress that clears the previous stall; only a fresh
 * stall (state `stalled`, or an explicit flag) may re-flag the agent.
 */
export function resolveAgentStalled(state: AgentState, stalled: boolean): boolean {
  if (TERMINAL_AGENT_STATES.includes(state)) return false
  if (state === 'stalled') return true
  return stalled
}

/**
 * Timing guard for merging one agent event/snapshot row into ITS OWN displayed row.
 *
 * Rows are episodes: an event routes by exact {agentId, runId} to the run's own
 * row, and a different run becomes its own row instead of replacing anything —
 * so no cross-run ordering rule is needed anymore (an old run's record stays
 * visible next to its newer sibling). The only precedence left is within one
 * run: once a row reached a terminal verdict, a late running/stalled event for
 * that same run (or an older snapshot row captured before the verdict) must
 * never downgrade it back to live. Terminal→terminal refresh is still allowed.
 */

/**
 * Renderer-lifetime ledger of runs this renderer has explicitly forgotten —
 * cleared by the user via 清空 or retired by a run replacement in an earlier
 * panel generation — keyed `${sessionId}\u0000${agentId}` so chats never
 * pollute each other.
 *
 * It lives OUTSIDE React state because session switches and remounts clear the
 * row list (`setAgents([])`): after that, a stale late event for a cleared run
 * must not reinsert it as a fresh row. A run currently DISPLAYED still accepts
 * its own events (routing is per-episode), so retirement only blocks first-sight
 * reinsertion. Entries are kept for the renderer's life; Set dedupes.
 */
const agentRunLineages = new Map<string, Set<string>>()

const agentRunLineageKey = (sessionId: string | undefined, agentId: string) => `${sessionId ?? ''}\u0000${agentId}`

function retireAgentRun(sessionId: string | undefined, agentId: string, runId: string) {
  const key = agentRunLineageKey(sessionId, agentId)
  let retired = agentRunLineages.get(key)
  if (!retired) {
    retired = new Set()
    agentRunLineages.set(key, retired)
  }
  retired.add(runId)
}

/** Test-only: reset the renderer-lifetime ledger so suites stay independent. */
export function resetAgentRunLineageForTest() {
  agentRunLineages.clear()
}

/** Test-only: total retired runs recorded, to assert the ledger never re-grows. */
export function agentRunLineageSizeForTest(): number {
  let total = 0
  for (const retired of agentRunLineages.values()) total += retired.size
  return total
}

export function agentEventSupersedes(
  previous: Pick<AgentSummary, 'state' | 'runId' | 'createdAt'>,
  incoming: Pick<AgentSummary, 'state' | 'runId' | 'createdAt'>,
): boolean {
  // Different runIds are different episodes entirely: the caller inserts a
  // sibling row instead of merging, whatever the timestamps say.
  if (previous.runId && incoming.runId && previous.runId !== incoming.runId) return false
  const previousTerminal = TERMINAL_AGENT_STATES.includes(previous.state)
  const incomingTerminal = TERMINAL_AGENT_STATES.includes(incoming.state)
  return !(previousTerminal && !incomingTerminal)
}

function applyAgentEvent(current: Agent[], event: AgentEvent, sessionId?: string): Agent[] {
  if (event.type === 'worktree') return current.map(agent => agent.agentId === event.status.agentId && worktreeStatusOwnsRow(agent, event.status) ? { ...agent, worktree: event.status } : agent)
  if (event.type !== 'agent') return current
  const incoming = event.agent
  // Episode routing: match by exact session + run identity, so a second run of
  // one agentId ADDS a row while the older completed run keeps showing beside
  // it, and the same (agentId, runId) in a DIFFERENT session gets its own row
  // too instead of repainting this one. Only legacy identity-less events fall
  // back to a bare-agentId legacy row.
  const index = current.findIndex(agent =>
    agent.agentId === incoming.agentId
    && (incoming.runId ? agent.runId === incoming.runId : !agent.runId)
    && (!incoming.sessionId || !agent.sessionId || agent.sessionId === incoming.sessionId))
  const previous = index < 0 ? undefined : current[index]
  // The forget-ledger is checked only for runs with no displayed row: 清空-deleted
  // or already-replaced runs must not come back from a stale event/snapshot replay.
  const retiredRunIds = agentRunLineages.get(agentRunLineageKey(sessionId ?? incoming.sessionId, incoming.agentId))
  if (!previous && incoming.runId && retiredRunIds?.has(incoming.runId)) return current
  // Within ONE run, a reached verdict must not be reopened by a late running/stalled
  // event or a slower listAgents() snapshot taken before it. See agentEventSupersedes.
  if (previous && !agentEventSupersedes(previous, incoming)) return current
  const active = incoming.state === 'running'
  // Logs belong to THIS episode and stream across its own updates; a sibling run
  // has its own row with its own transcript (loaded via getAgentLogs when shown).
  const logs = previous?.logs ?? []
  const startedCandidates = [incoming.createdAt, previous?.startedAt]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const next: Agent = {
    ...previous,
    ...incoming,
    // Shallow-merge alone would inherit a previous stalled flag when the
    // incoming event omits it; resolve it per event instead (see resolveAgentStalled).
    stalled: resolveAgentStalled(incoming.state, incoming.stalled === true),
    startedAt: startedCandidates.length ? Math.min(...startedCandidates) : Date.now(),
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
  const { itemType, text, name, isError, charCount, toolCallId } = event
  if (event.resetStreamSlots) logs = sealStreamSlots(logs)
  if (event.contentIndex !== undefined) {
    const index = logs.findIndex(log => log.contentIndex === event.contentIndex)
    if (index >= 0) {
      const old = logs[index]
      return logs.map((log, itemIndex) => itemIndex === index
        ? { ...old, itemType, text, name: name || old.name, isError: old.isError, charCount: charCount ?? old.charCount, toolCallId: toolCallId ?? old.toolCallId }
        : log)
    }
    // Skip empty placeholders (delta before the first real chunk) so the panel
    // doesn't flash a blank row.
    if (!text && itemType !== 'tool') return logs
    return appendAgentLogRow(logs, { id: logs.length + 1, itemType, text, name, isError, contentIndex: event.contentIndex, charCount, ...(toolCallId ? { toolCallId } : {}) })
  }
  if (event.resetStreamSlots && !text && itemType !== 'tool') return logs
  // A no-index `kind:"log"` item is a turn boundary: forget live slots so the
  // next message's contentIndex 0 cannot rewrite the previous thinking/text.
  logs = event.resetStreamSlots ? logs : sealStreamSlots(logs)
  const last = logs[logs.length - 1]
  if (last && last.itemType === itemType && text.length > last.text.length && text.startsWith(last.text)) {
    return logs.map(log => log.id === last.id ? { ...log, text, charCount: charCount ?? log.charCount } : log)
  }
  return appendAgentLogRow(logs, { id: logs.length + 1, itemType, text, name, isError, charCount, ...(toolCallId ? { toolCallId } : {}) })
}

/**
 * Identity keys under which one log row can be recognized across the live
 * stream and the host cache. A row may carry overlapping identities: the
 * contentIndex slot key (streamed deltas), the itemType+toolCallId key (call
 * pairing; a missed reset event leaves one copy sealed and the other not), and
 * — for terminal batch rows carrying neither — the exact text. Any shared key
 * means "same row".
 */
function agentLogIdentityKeys(log: Log): string[] {
  const keys: string[] = []
  if (log.contentIndex !== undefined) keys.push(`ci:${log.contentIndex}`)
  if (log.toolCallId) keys.push(`${log.itemType}:${log.toolCallId}`)
  if (log.contentIndex === undefined && !log.toolCallId) keys.push(`x:${log.itemType}:${log.text}`)
  return keys
}

/**
 * Append with cross-channel dedup. The host-cache backfill and the live stream
 * are two writers over one list: a row whose identity key already exists is the
 * same logical row arriving from the other channel (replayed batch, refetch
 * racing a flush), not new content. Whichever writer lands second is a no-op.
 */
function appendAgentLogRow(logs: Log[], row: Log): Log[] {
  const keys = new Set<string>()
  for (const log of logs) for (const key of agentLogIdentityKeys(log)) keys.add(key)
  if (agentLogIdentityKeys(row).some(key => keys.has(key))) return logs
  return [...logs, row]
}

type CachedAgentLogEntry = Awaited<ReturnType<PipiHostAPI['getAgentLogs']>>[number]

/**
 * Merge a getAgentLogs snapshot into the row's live logs. The cache is
 * canonical — complete, order-faithful, sealed exactly as the host relayed —
 * so the result is the replayed snapshot followed by any live rows the
 * snapshot predates. Dedup makes the merge idempotent: re-running it over an
 * already merged list is a no-op, and a refill racing a live flush composes
 * cleanly instead of duplicating or clobbering rows.
 */
function mergeAgentLogBackfill(live: Log[], entries: readonly CachedAgentLogEntry[], agentId: string): Log[] {
  let cached: Log[] = []
  for (const entry of entries) cached = applyLogDelta(cached, { type: 'agent_log', agentId, ...entry })
  if (!cached.length) return live
  const cachedKeys = new Set<string>()
  for (const log of cached) for (const key of agentLogIdentityKeys(log)) cachedKeys.add(key)
  const extras = live.filter(log => !agentLogIdentityKeys(log).some(key => cachedKeys.has(key)))
  return extras.length ? [...cached, ...extras] : cached
}

function SubagentHeader({ total, running, runningTokens, succeeded, failed, clearDisabled, onClear }: {
  total: number
  running: number
  runningTokens: number
  succeeded: number
  failed: number
  /** No session scope (or a delete already in flight): a durable 清空 cannot be issued. */
  clearDisabled?: boolean
  onClear: () => void
}) {
  const finished = Math.max(0, total - running)
  const runningTokensLabel = formatTokens(runningTokens)
  const runningLabel = runningTokensLabel ? `${running} 运行中 · ${runningTokensLabel}` : `${running} 运行中`
  return <header className="subagent-header">
    <div className="subagent-header-left">
      <b>♙ Subagents</b>
      <span>{total} 个</span>
      <i className={`handled-badge${succeeded ? '' : ' is-zero'}`}>{succeeded} 成功</i>
      <i className={`failed-badge${failed ? '' : ' is-zero'}`}>{failed} 失败</i>
    </div>
    <div className="subagent-header-right">
      <i className={`running-badge${running ? '' : ' is-zero'}`} data-testid="subagent-running-badge">{runningLabel}</i>
      <button onClick={onClear} disabled={finished === 0 || clearDisabled} title="仅隐藏当前视图的已完成记录（切换会话或刷新后恢复）">清空</button>
    </div>
  </header>
}

function AgentRow({ agent, testId, childCount, activeChildCount, selected, aborting, now, onSelect, onAbort, onResolve }: {
  agent: Agent
  /** Per-row testid: the bare agentId when unique in this tree, `agentId--runId` when one slug owns several displayed runs. */
  testId?: string
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
  // No non-empty {sessionId, runId} → no exact episode identity: this row can
  // be displayed but never issues controls. Buttons stay rendered (layout) yet
  // disabled, and the handlers are additionally inert as a defense in depth.
  const identity = episodeIdentity(agent)
  const controlsInert = !identity
  const handled = !active && !agent.handled && ['failed', 'aborted', 'interrupted'].includes(agent.state)
  const stalled = agent.stalled || agent.state === 'stalled'
  const closing = liveRunningProgressLine({
    state: agent.state,
    diagnostics: agent.diagnostics,
    activityActive: agent.activityActive,
    listSubtitle: agent.listSubtitle,
    now,
  })
	const live = closing
    ? { severity: 'active' as const, text: closing }
    : active
      ? liveAgentStatus(agent, now, activeChildCount)
      : undefined
  const liveTokens = active ? formatTokens(agentTokenTotal(agent)) : ''

  return <article className={`agent-row ${agent.parentId ? 'agent-child' : 'agent-root'} ${selected ? 'selected' : ''}`} data-testid={`agent-row-${testId ?? agent.agentId}`}>
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
          {stalled && !closing && <em className="stalled-badge">{agent.stalledIdleSec ? `卡住 ${agent.stalledIdleSec}s` : '卡住'}</em>}
          {worktree && <em className={`worktree-badge ${worktree.lifecycle}`}>{worktree.text}</em>}
          {liveTokens && <small className="agent-row-tokens" data-testid={`agent-row-tokens-${agent.agentId}`}>{liveTokens}</small>}
          {active && <RunningElapsed startedAt={agent.startedAt} />}
        </span>
        <small>{subtitle}</small>
        {!active && agent.endedAt && <small className="agent-row-time">{completedAt(agent.endedAt)} · {duration(agent, now)}</small>}
		{live && <small className={`agent-live-state ${live.severity}`}>{live.text}</small>}
      </span>
    </button>
    {active && <button aria-label={`${aborting ? '正在中止' : '中止'} ${agent.name}`} title={controlsInert ? '缺少会话/运行标识，无法精确停止' : aborting ? '正在中止 agent' : '中止 agent'} className="agent-control abort" disabled={aborting || controlsInert} onClick={onAbort}>{aborting ? <span className="agent-spinner" aria-hidden="true" /> : '■'}</button>}
    {handled && <button aria-label={`标记 ${agent.name} 已处理`} title={controlsInert ? '缺少会话/运行标识，无法精确标记' : '标记已处理'} className="agent-control resolve" disabled={controlsInert} onClick={onResolve}>标记已处理</button>}
  </article>
}

function AgentDetail({ agent, activeChildCount, aborting, now, projectPath, onOpenDocument, retainedWorktreeDispositionAvailable, terminalAvailable, onCheck, onWorktree, onOpenWorktreeTerminal, onAbort, historyLogs, historyError, canShowHistory, onShowHistory, onHideHistory }: {
  agent?: Agent
	activeChildCount: number
	aborting: boolean
  now: number
  projectPath?: string
  onOpenDocument?: (path: string) => void
  retainedWorktreeDispositionAvailable: boolean
  terminalAvailable: boolean
  onCheck: (agent: Agent) => void
  onWorktree: (agent: Agent, action: 'merge' | 'discard') => void
  onOpenWorktreeTerminal: (path: string) => void
  onAbort: (agent: Agent) => void
  /** Explicit agent-history view (scope: 'agent'): when set, the transcript renders these cross-run logs instead of the current run's. */
  historyLogs?: Log[]
  historyError: string
  canShowHistory: boolean
  onShowHistory: (agent: Agent) => void
  onHideHistory: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const followRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const output = useMemo(
    () => agent ? latestReadableResult(agent) : '',
    [agent?.logs, agent?.finalResult],
  )
  const latestLog = agent?.logs.at(-1)
  // Summary/usage events arrive independently from logs. Reuse the expensive
  // unified transcript (and its memoized Markdown subtree) until one of the
  // fields that actually changes transcript output changes. The explicit history
  // view substitutes its own cross-run logs for the current run's.
  const sourceLogs = useMemo(() => {
    const logs = historyLogs ?? agent?.logs
    return logs && logs.length > AGENT_LOG_RENDER_LIMIT ? logs.slice(-AGENT_LOG_RENDER_LIMIT) : logs
  }, [historyLogs, agent?.logs])
  const transcript = useMemo(
    () => agent && sourceLogs ? agentTranscript({ ...agent, logs: sourceLogs }, output) : [],
    [sourceLogs, agent?.startedAt, agent?.state, agent?.worktreeError, output],
  )

  useEffect(() => {
    followRef.current = true
    setAtBottom(true)
  }, [agent?.agentId])

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !followRef.current) return
    el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  }, [agent?.agentId, agent?.logs.length, agent?.state, latestLog?.text, latestLog?.itemType, output])

  const returnLatest = useCallback(() => {
    followRef.current = true
    setAtBottom(true)
    const el = scrollRef.current
    if (el) el.scrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
  }, [])

  if (!agent) return <div className="agent-detail empty">选择一个 agent 查看详情</div>
  const reviewable = agent.worktree?.lifecycle === 'pendingReview'
  // Same inert rule as the row: no non-empty {sessionId, runId} → every
  // episode-scoped control in the detail pane is disabled.
  const identity = episodeIdentity(agent)
  const controlsInert = !identity
  const model = agent.model || `${providerLabel(agent)}/${agent.name}`
  const resolvedModel = modelLabel(agent)
  const modelFamilyLabel = modelFamily(agent).family
  const activity = localizedTaskSummary(agent.listSubtitle || agent.title || agent.task)
  const closing = liveRunningProgressLine({
    state: agent.state,
    diagnostics: agent.diagnostics,
    activityActive: agent.activityActive,
    listSubtitle: agent.listSubtitle,
    now,
  })
	const live = closing
    ? { severity: 'active' as const, text: closing }
    : isActive(agent)
      ? liveAgentStatus(agent, now, activeChildCount)
      : undefined
  const detailTitle = detailTaskTitle(agent, output)
  // Runtime terminal events intentionally retain only the last 8k characters.
  // That tail can begin mid-table, mid-code span, or mid-fence; feeding such a
  // fragment to a Markdown parser can take a pathological parse path. Preserve
  // the complete retained tail as readable pre-wrapped text instead.
  const finalResultNeedsPlainText = Boolean(agent.finalResult && agent.finalResult.length >= AGENT_FINAL_RESULT_TAIL_CAP)

  return <div className="agent-detail" style={{ position: 'relative' }}>
    <header className="agent-detail-header">
      <div className="detail-agent-title">
        <div><ModelFamilyIcon agent={agent} /><b>{detailTitle}</b></div>
        <small>{resolvedModel ? `${modelFamilyLabel} · ${resolvedModel}` : modelFamilyLabel}</small>
      </div>
      <AgentDetailUsage agent={agent} />
    </header>
    <p className="agent-closeout">{agent.closeout ? `收尾　${agent.closeout}` : `${stateText(agent)}${agent.worktree ? `　${worktreeText(agent.worktree)}` : ''}`}</p>
    <div className="agent-transcript-scroll" data-testid="subagent-transcript-scroll" ref={scrollRef} onScroll={event => {
      const el = event.currentTarget
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      followRef.current = atBottom
      setAtBottom(atBottom)
    }}>
      {isActive(agent) && <div className={`agent-running-activity ${live?.severity ?? 'active'}`} role="status" aria-live="polite"><span className="agent-spinner" aria-hidden="true" /><span>{live?.text ?? `正在执行 · ${activity}`}</span><button disabled={aborting || controlsInert} title={controlsInert ? '缺少会话/运行标识，无法精确停止' : undefined} onClick={() => onAbort(agent)}>{aborting ? '正在停止' : '停止'}</button></div>}
      <div className="agent-transcript" data-testid="subagent-transcript">
        {/* Run-scope label + explicit history toggle. The current run is the default
            view; the cross-run history is a separate, clearly labeled view and is
            only offered for finished agents so it never freezes a live follow. */}
        {canShowHistory && !controlsInert && !isActive(agent) && (
          historyLogs
            ? <div className="agent-log-scope" data-testid="agent-log-scope"><span>全部运行历史（跨 run 拼接）</span><button type="button" onClick={onHideHistory}>仅看当前运行</button></div>
            : <div className="agent-log-scope" data-testid="agent-log-scope"><span>当前运行记录</span><button type="button" onClick={() => onShowHistory(agent)}>查看全部运行历史</button></div>
        )}
        {historyError && <div className="agent-log-scope agent-log-scope-error" data-testid="agent-log-scope-error" role="alert">{historyError}</div>}
        {/* Step groups default collapsed here — explicit false also suppresses the
            streaming auto-expand — so the boss expands each group manually. */}
        {transcript.map((message, index) => {
          const closeout = message.content ? parseCloseoutSummary(message.content) : null
          return <article className="message assistant-message" key={`${agent.runId}-transcript-${index}`}>
            {closeout
              ? <SecretaryCloseoutResult parsed={closeout} />
              : finalResultNeedsPlainText && message.content === output
                ? <pre className="agent-final-result" data-testid="subagent-final-result-plain">{message.content}</pre>
                : <AssistantTranscriptContent message={message} expandSteps={false} documentBasePath={agent.worktree?.path || projectPath} onOpenDocument={onOpenDocument} />}
          </article>
        })}
      </div>
      <details className="agent-technical-details">
      <summary>技术详情</summary>
      <div className="technical-metadata">
        <span>Agent ID：{agent.agentId}</span>
        <span>Profile：{localizedProfileName(agent.name)}（{agent.name}）</span>
        <span>Provider / Model：{providerLabel(agent)} · {model}</span>
        {agent.sessionId && <span>Session：{agent.sessionId}</span>}
        <DetailMetrics agent={agent} now={now} pricing={pricingFor([agent])} />
        {agent.activityEndedAt && agent.activityActive === false && <span>上一工具已结束于 {completedAt(agent.activityEndedAt)}</span>}
        <AgentStallDiagnostics agent={agent} now={now} />
        <button type="button" data-testid="subagent-detail-status-check" title="向主会话发出用户主动的状态查询；不会自动重新派发 agent" disabled={controlsInert} onClick={() => void onCheck(agent)}>手动检查</button>
      </div>
      <p className="agent-task">{visibleAgentText(agent.task)}</p>
      {agent.closeout && <p className="agent-closeout">收尾 · {agent.closeout}</p>}
      {agent.worktree && <div className="worktree-meta">
        <span className={`worktree-status ${agent.worktree.lifecycle}`}>{worktreeText(agent.worktree)}</span>
        {agent.worktree.branch && <code>{agent.worktree.branch}</code>}
        {agent.worktree.error && <small>{agent.worktree.error}</small>}
        {agent.worktree.path && terminalAvailable && <button className="worktree-terminal-btn" title={`在终端中打开 ${agent.worktree.path}`} onClick={() => onOpenWorktreeTerminal(agent.worktree!.path!)}>⌘ 终端</button>}
        {reviewable && retainedWorktreeDispositionAvailable && <span className="worktree-actions"><button disabled={controlsInert} onClick={() => void onWorktree(agent, 'merge')}>合并到主分支</button><button disabled={controlsInert} onClick={() => void onWorktree(agent, 'discard')}>丢弃 worktree</button></span>}
        {agent.worktree.lifecycle === 'active' && retainedWorktreeDispositionAvailable && <span className="worktree-actions"><button disabled={controlsInert} onClick={() => void onWorktree(agent, 'discard')}>关闭 worktree</button></span>}
      </div>}
      {!isActive(agent) && <span className="agent-finished-at">结束于 {completedAt(agent.endedAt)} · {duration(agent, now)}</span>}
      </details>
    </div>
    {agent && !atBottom && <button className="return-latest" aria-label="回到最新" title="回到最新" onClick={returnLatest}><svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>}
  </div>
}

function AgentDetailUsage({ agent }: { agent: Agent }) {
  const usage = agentDetailUsage(agent)
  if (!usage.context && !usage.cache && !usage.io) return null
  return <dl className="agent-detail-usage" data-testid="agent-detail-usage" aria-label="当前 subagent 用量">
    {(usage.context || usage.cache) && <div className="agent-detail-usage-row" data-testid="agent-detail-usage-context">
      {usage.context && <div><dt>上下文</dt><dd title="当前上下文 / 最大窗口">{usage.context}</dd></div>}
      {usage.cache && <div><dt>缓存</dt><dd title="缓存命中">{usage.cache}</dd></div>}
    </div>}
    {usage.io && <div className="agent-detail-usage-row"><div><dt>入/出</dt><dd title="输入 / 输出 tokens">{usage.io}</dd></div></div>}
  </dl>
}

function AgentStallDiagnostics({ agent, now }: { agent: Agent; now: number }) {
  const view = diagnoseAgentProgress({
    now,
    state: agent.state,
    updatedAt: agent.updatedAt,
    stalled: agent.stalled,
    diagnostics: agent.diagnostics,
  })
  return <div className="agent-stall-diagnostics" data-testid="agent-stall-diagnostics">
    <p data-testid="agent-stall-conclusion">{view.conclusion}</p>
    {view.fields.filter(field => field.label !== '诊断结论').map(field => (
      <span key={field.label}>{field.label}：{field.value}</span>
    ))}
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
