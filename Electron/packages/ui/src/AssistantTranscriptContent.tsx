import { memo, useState, type ReactNode } from 'react'
import { BUILTIN_EXTENSION_ID } from './builtin-extension-id'
import { getToolRenderer, isLiveProjectedTool, registerToolRenderer, useToolRenderers } from './ui-registries'
import { toToolRenderPayload } from './piui-envelope'
import { ActivityCard } from './ActivityCard'
import { parseSubagentNotice } from './subagent-notice'
import { toolArgsSummary, toolDisplaySummary, formatToolInput } from './tool-summary'
import { fileChangeTokenStats, finishedFileChangeDeltaLabel, liveTokenLabel } from './file-change-tokens'
import { estimateTokens, formatCompactTokens } from './session-stats-format'
import { DocumentReferenceCards } from './DocumentReferenceCards'
import { LiveSubagentCard } from './LiveSubagentCard'
import { useLiveSubagentBindings } from './LiveSubagentBinding'
import { TruncatedText } from './TruncatedText'
import { TranscriptMarkdown } from './TranscriptMarkdown'
import { HostedCodeInterpreterCard } from './HostedCodeInterpreterCard'
import type { ChatMessage, TranscriptActivity, TranscriptTool } from './transcript-model'
import { displaySecretPlaceholders } from './secret-display'
import { activitiesFromMessage, PENDING_THINKING_ID, planAssistantTranscript } from './transcript-model'

export type { TranscriptActivity, TranscriptTool } from './transcript-model'
export { TranscriptMarkdown } from './TranscriptMarkdown'
export type AssistantTranscriptMessage = Pick<ChatMessage, 'content' | 'thinking' | 'tools' | 'activities' | 'streaming' | 'error' | 'citations' | 'fileSources'>

const FILE_SOURCE_FALLBACK = '已上传文件'

function displayFileSourceName(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'))
  const base = (slash >= 0 ? name.slice(slash + 1) : name).replace(/[\u0000-\u001f\u007f]/g, '').trim()
  return base || FILE_SOURCE_FALLBACK
}

function displayFileSourceUrl(url: string | undefined): string | undefined {
  return url && /^https:\/\//i.test(url) ? url : undefined
}

function elapsed(startedAt: number, endedAt = Date.now()) { return `${Math.max(0, Math.round((endedAt - startedAt) / 1000))}s` }
function toolRunSummary(steps: number, thinking: string | null, tools: { name: string }[]): string {
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  const toolLabels = [...counts].map(([name, count]) => count > 1 ? `${name} ×${count}` : name)
  const labels = [thinking, ...toolLabels].filter((label): label is string => Boolean(label))
  if (labels.length === 0) return `${steps} 个步骤`
  return `${steps} 个步骤 · ${labels.join(' · ')}`
}

function toolFailed(tool: TranscriptTool): boolean {
  return Boolean(tool.error) || (tool.name === 'subagent' && tool.finished && tool.result ? parseSubagentNotice(tool.result)?.ok === false : false)
}

function failedToolCount(activities: TranscriptActivity[]): number {
  let count = 0
  for (const activity of activities) if (activity.type === 'tool' && toolFailed(activity.tool)) count += 1
  return count
}

const TranscriptToolCard = memo(function TranscriptToolCard({ tool }: { tool: TranscriptTool; streaming?: boolean }) {
  const argsSummary = toolArgsSummary(tool.name, tool.input)
  const subagentNotice = tool.name === 'subagent' && tool.finished && tool.result && !tool.error ? parseSubagentNotice(tool.result) : null
  const summary = tool.name === 'subagent'
    ? `子任务${argsSummary !== '…' ? ` · ${argsSummary}` : subagentNotice ? ` · ${subagentNotice.name}` : ''}`
    : toolDisplaySummary(tool.name, tool.input)
  const completedElapsed = elapsed(tool.startedAt, tool.finishedAt ?? tool.startedAt)
  const stats = !tool.error ? fileChangeTokenStats(tool.name, tool.input ?? '') : null
  const delta = stats && tool.finished ? finishedFileChangeDeltaLabel(stats) : undefined
  const live = stats && !tool.finished ? liveTokenLabel(stats.payloadChars) : undefined
  const baseMeta = tool.error ? `失败 · ${completedElapsed}` : subagentNotice ? `${subagentNotice.ok ? '成功' : '失败'} · ${subagentNotice.cost} · ${completedElapsed}` : tool.dispatched ? `已派发 · ${completedElapsed}` : tool.finished ? `完成 · ${completedElapsed}` : `运行中 · ${elapsed(tool.startedAt)}`
  const deltaNode = delta
    ? <span className="tok-delta-wrap">{delta.split(' ').map((part, i) => <span key={i} className={part.startsWith('+') ? 'tok-add' : 'tok-del'}>{i ? ` ${part}` : part}</span>)}</span>
    : null
  const meta: ReactNode = deltaNode
    ? <span>{deltaNode} · {baseMeta}</span>
    : live ? `${baseMeta} · ${live}` : baseMeta
  return <ActivityCard kind="tool" summary={summary} meta={meta} error={Boolean(tool.error || (subagentNotice && !subagentNotice.ok))} defaultExpanded={false}>
    {tool.images && tool.images.length > 0 && <div className="tool-images">{tool.images.map((img, i) => <img key={i} className="tool-screenshot" src={`data:${img.mimeType};base64,${img.data}`} alt="工具截图" loading="lazy" />)}</div>}
    {tool.input && <div className="tool-io"><div className="tool-io-label">输入</div><pre>{formatToolInput(tool.name, tool.input)}</pre></div>}
    {tool.result && <div className="tool-io"><div className="tool-io-label">输出</div><div className="tool-result"><TruncatedText text={tool.result} /></div></div>}
  </ActivityCard>
})

const ActiveToolCard = memo(function ActiveToolCard({ tool }: { tool: TranscriptTool }) {
  const live = liveTokenLabel(fileChangeTokenStats(tool.name, tool.input ?? '')?.payloadChars ?? 0)
  return <section className="activity-card activity-card-tool activity-card-active-tool" data-activity-card="tool" data-testid="active-tool"><div className="activity-summary"><span className="activity-status" aria-hidden="true">◌</span><b>{toolDisplaySummary(tool.name, tool.input)}</b><small className="activity-meta">运行中 · {elapsed(tool.startedAt)}{live ? ` · ${live}` : ''}</small></div></section>
})

export const AssistantTranscriptContent = memo(function AssistantTranscriptContent({ message, expandSteps, documentBasePath, onOpenDocument, onOpenSubagents }: { message: AssistantTranscriptMessage; expandSteps?: boolean; documentBasePath?: string; onOpenDocument?: (path: string) => void; onOpenSubagents?: (agentId?: string) => void }) {
  const [errorDismissed, setErrorDismissed] = useState(false)
  const [errorSeen, setErrorSeen] = useState(message.error)
  if (message.error !== errorSeen) {
    setErrorSeen(message.error)
    setErrorDismissed(false)
  }
  const activities = activitiesFromMessage(message)
  const stepActivities = activities.filter((activity): activity is Extract<TranscriptActivity, { type: 'thinking' | 'tool' }> => activity.type !== 'text')
  // Lost tool_result/settled: if the model generated text after the last
  // unfinished tool, the tool must have completed — suppress the live indicator.
  const lastUnfinishedToolIndex = activities.reduce((last, a, i) =>
    a.type === 'tool' && !a.tool.finished && !isLiveProjectedTool(a.tool.name) ? i : last, -1)
  const textAfterUnfinishedTool = lastUnfinishedToolIndex >= 0 && activities.slice(lastUnfinishedToolIndex + 1).some(a => a.type === 'text' && a.content.trim())
  const activeTool = message.streaming && !textAfterUnfinishedTool ? [...stepActivities].reverse().find((activity): activity is Extract<TranscriptActivity, { type: 'tool' }> => activity.type === 'tool' && !activity.tool.finished && !isLiveProjectedTool(activity.tool.name)) : undefined
  const segments: ReturnType<typeof planAssistantTranscript> = []
  for (const segment of planAssistantTranscript(message)) {
    if (segment.type === 'text') {
      segments.push(segment)
      continue
    }
    const grouped = activeTool ? segment.activities.filter(activity => !(activity.type === 'tool' && activity.tool.id === activeTool.tool.id)) : segment.activities
    if (grouped.length) segments.push({ type: 'steps', activities: grouped })
  }
  const tools = segments.flatMap(segment => segment.type === 'steps' ? segment.activities.flatMap(activity => activity.type === 'tool' ? [activity.tool] : []) : [])
  useToolRenderers()
  const liveByTool = useLiveSubagentBindings(tools)
  const liveProjectable = (tool: TranscriptTool) => isLiveProjectedTool(tool.name)
  const subagentProjections = tools.filter(liveProjectable).map(tool => liveByTool.get(tool.id)).filter((projection): projection is NonNullable<typeof projection> => Boolean(projection))
  const linkedRunning = subagentProjections.some(projection => projection.runningCount > 0)
  const pendingDispatch = tools.some(tool => liveProjectable(tool) && Boolean(tool.dispatched) && (liveByTool.get(tool.id)?.roots.length ?? 0) === 0)
  const linkedFailed = subagentProjections.some(projection => projection.failedCount > 0)
  const running = Boolean(message.streaming && !activeTool && !textAfterUnfinishedTool) || linkedRunning || pendingDispatch
  // Main transcript: expand only while this turn is still producing local
  // steps. A dispatched/linked subagent is finished work in the transcript —
  // progress lives on the waiting placeholder and the Subagents pane.
  const stepsExpanded = expandSteps ?? (Boolean(message.streaming) && !pendingDispatch && !linkedRunning)
  const lastStepsIndex = segments.reduce((last, segment, index) => segment.type === 'steps' ? index : last, -1)
  const stepGroupCount = segments.filter(segment => segment.type === 'steps').length
  const stepsKey = (index: number) => {
    const base = expandSteps ? 'steps' : message.streaming ? 'live' : linkedRunning || pendingDispatch ? 'live-agent' : 'done'
    return stepGroupCount > 1 ? `${base}:${index}` : base
  }
  return <div className="assistant-transcript-content" data-testid="assistant-transcript-content">
    {segments.map((segment, index) => {
      if (segment.type === 'text') {
        return <div key={`text:${segment.id}`} data-transcript-segment="text"><TranscriptMarkdown content={displaySecretPlaceholders(segment.content)} streaming={message.streaming && index === segments.length - 1} />{!message.streaming && <DocumentReferenceCards content={displaySecretPlaceholders(segment.content)} basePath={documentBasePath} onOpenDocument={onOpenDocument} />}</div>
      }
      const groupTools = segment.activities.flatMap(activity => activity.type === 'tool' ? [activity.tool] : [])
      const hasThinking = segment.activities.some(activity => activity.type === 'thinking')
      const groupRunning = running && index === lastStepsIndex
      const groupExpanded = expandSteps ? index === lastStepsIndex && !activeTool : stepsExpanded
      const groupFailed = failedToolCount(segment.activities)
      const groupError = !running && (groupFailed > 0 || (linkedFailed && index === lastStepsIndex))
      const groupMeta = !running && groupFailed > 0
        ? `${groupFailed} 失败 · ${segment.activities.length - groupFailed} 成功`
        : !running && linkedFailed && groupFailed === 0 && index === lastStepsIndex ? '失败' : undefined
      return <ActivityCard key={stepsKey(index)} summary={toolRunSummary(segment.activities.length, hasThinking ? 'Thinking' : null, groupTools)} running={groupRunning} error={groupError} meta={groupMeta} defaultExpanded={groupExpanded}>{segment.activities.map((activity, activityIndex) => {
        const pendingThinking = activity.type === 'thinking' && activity.id === PENDING_THINKING_ID
        const live = Boolean(message.streaming && index === lastStepsIndex && !activeTool && (
          activity.type === 'thinking'
            ? pendingThinking || activityIndex === segment.activities.length - 1
            : !activity.tool.finished
        ))
        if (activity.type === 'thinking') return <ActivityCard key={`thinking:${activity.id}`} kind="thinking" label="Thinking" summary="Thinking" meta={`${formatCompactTokens(estimateTokens(activity.charCount ?? activity.content.length))} tokens`} running={live} defaultExpanded={live}><p>{displaySecretPlaceholders(activity.content) || (live ? '模型正在思考…' : '')}</p></ActivityCard>
        const projection = liveByTool.get(activity.tool.id)
        const payload = toToolRenderPayload(activity.tool.result)
        if (!payload.fallback) {
          const custom = getToolRenderer(activity.tool.name)?.render?.({
            tool: activity.tool,
            streaming: live,
            projection,
            onOpenSubagents,
            elapsed,
            content: payload.content,
            // Typed `details` projected from the pi ToolResultMessage win; the
            // `piui:v1` text envelope stays the fallback convention (spec D5).
            details: activity.tool.details ?? payload.details,
            images: activity.tool.images,
          })
          if (custom != null) return custom
        }
        return <TranscriptToolCard key={`tool:${activity.tool.id}`} tool={activity.tool} streaming={live} />
      })}</ActivityCard>
    })}
    {activeTool && <ActiveToolCard key={`active-tool:${activeTool.tool.id}`} tool={activeTool.tool} />}
    {message.citations && message.citations.length > 0 && <nav className="assistant-citations" data-testid="assistant-citations" aria-label="来源">
      <div className="assistant-citations-label">来源</div>
      <ol className="assistant-citations-list">
        {message.citations.map((citation, index) => {
          const label = citation.title?.trim() || citation.url
          return <li key={`${citation.url}:${citation.startIndex ?? ''}:${index}`}><a href={citation.url} target="_blank" rel="noreferrer">{label}</a></li>
        })}
      </ol>
    </nav>}
    {message.fileSources && message.fileSources.length > 0 && <nav className="assistant-file-sources" data-testid="assistant-file-sources" aria-label="附件来源">
      <div className="assistant-file-sources-label">附件来源</div>
      <ol className="assistant-file-sources-list">
        {message.fileSources.map((source, index) => {
          const label = displayFileSourceName(source.name)
          const url = displayFileSourceUrl(source.url)
          return <li key={`${label}:${url ?? ''}:${index}`}>{url ? <a href={url} target="_blank" rel="noreferrer">{label}</a> : <span>{label}</span>}</li>
        })}
      </ol>
    </nav>}
    {message.error && !errorDismissed && <div className="assistant-turn-error" data-testid="assistant-turn-error" role="alert"><span className="assistant-turn-error-message">{message.error}</span><button type="button" className="assistant-turn-error-close" aria-label="关闭错误提示" title="关闭错误提示" data-testid="assistant-turn-error-close" onClick={() => setErrorDismissed(true)}>×</button></div>}
  </div>
})

registerToolRenderer(BUILTIN_EXTENSION_ID, {
  toolName: 'code_interpreter',
  render: ({ tool, streaming }) => <HostedCodeInterpreterCard key={`tool:${tool.id}`} tool={tool} streaming={streaming} />,
})

registerToolRenderer(BUILTIN_EXTENSION_ID, {
  toolName: 'subagent',
  liveProjected: true,
  render: ({ tool, projection, onOpenSubagents }) => {
    if (projection && projection.totalCount > 0) {
      return <LiveSubagentCard key={`tool:${tool.id}`} projection={projection} onOpenSubagents={onOpenSubagents} />
    }
    return null
  },
})
