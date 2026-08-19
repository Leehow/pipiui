import { memo, type ReactNode } from 'react'
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
import { ComputerPlanCard } from './ComputerPlanCard'
import { ComputerTaskResultCard, ComputerWorkerResultCard, computerTaskGoalFromInput } from './ComputerTaskResultCard'
import { parseComputerPlanSegment, parseComputerTaskResult, parseComputerWorkerResult } from './computer-task-report'
import type { ChatMessage, TranscriptActivity, TranscriptTool } from './transcript-model'
import { activitiesFromMessage, PENDING_THINKING_ID, planAssistantTranscript } from './transcript-model'

export type { TranscriptActivity, TranscriptTool } from './transcript-model'
export { TranscriptMarkdown } from './TranscriptMarkdown'
export type AssistantTranscriptMessage = Pick<ChatMessage, 'content' | 'thinking' | 'tools' | 'activities' | 'streaming' | 'error'>

function elapsed(startedAt: number, endedAt = Date.now()) { return `${Math.max(0, Math.round((endedAt - startedAt) / 1000))}s` }
function toolRunSummary(steps: number, thinking: string | null, tools: { name: string }[]): string {
  const labels = [thinking, ...tools.map(tool => tool.name)].filter((label): label is string => Boolean(label))
  if (labels.length <= 1) return `${steps} 个步骤${labels.length ? ` · ${labels[0]}` : ''}`
  const counts = new Map<string, number>()
  for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1)
  let primary = tools[0].name
  let primaryCount = 1
  for (const [name, count] of counts) if (count > primaryCount) { primary = name; primaryCount = count }
  const label = primaryCount > 1 ? `${primary} ×${primaryCount}` : primary
  return `${steps} 个步骤 · ${[thinking, label].filter((part): part is string => Boolean(part)).join(' · ')}`
}

const TranscriptToolCard = memo(function TranscriptToolCard({ tool, streaming }: { tool: TranscriptTool; streaming?: boolean }) {
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
  const meta: ReactNode = delta
    ? <span>{baseMeta} · <span className="tok-add tok-del-wrap">{delta.split(' ').map((part, i) => <span key={i} className={part.startsWith('+') ? 'tok-add' : 'tok-del'}>{i ? ` ${part}` : part}</span>)}</span></span>
    : live ? `${baseMeta} · ${live}` : baseMeta
  return <ActivityCard kind="tool" summary={summary} meta={meta} error={Boolean(tool.error || (subagentNotice && !subagentNotice.ok))} defaultExpanded={tool.name === 'subagent' ? (Boolean(streaming) || !tool.finished || Boolean(tool.dispatched)) : false}>
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
  const activities = activitiesFromMessage(message)
  const stepActivities = activities.filter((activity): activity is Extract<TranscriptActivity, { type: 'thinking' | 'tool' }> => activity.type !== 'text')
  // Lost tool_result/settled: if the model generated text after the last
  // unfinished tool, the tool must have completed — suppress the live indicator.
  const lastUnfinishedToolIndex = activities.reduce((last, a, i) =>
    a.type === 'tool' && !a.tool.finished && a.tool.name !== 'subagent' && a.tool.name !== 'computer_task' ? i : last, -1)
  const textAfterUnfinishedTool = lastUnfinishedToolIndex >= 0 && activities.slice(lastUnfinishedToolIndex + 1).some(a => a.type === 'text' && a.content.trim())
  const activeTool = message.streaming && !textAfterUnfinishedTool ? [...stepActivities].reverse().find((activity): activity is Extract<TranscriptActivity, { type: 'tool' }> => activity.type === 'tool' && !activity.tool.finished && activity.tool.name !== 'subagent' && activity.tool.name !== 'computer_task') : undefined
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
  const liveByTool = useLiveSubagentBindings(tools)
  // `computer_task` children carry the same toolCallId linkage as `subagent`
  // children, so both project into live row cards while running.
  const liveProjectable = (tool: TranscriptTool) => tool.name === 'subagent' || tool.name === 'computer_task'
  const subagentProjections = tools.filter(liveProjectable).map(tool => liveByTool.get(tool.id)).filter((projection): projection is NonNullable<typeof projection> => Boolean(projection))
  const linkedRunning = subagentProjections.some(projection => projection.runningCount > 0)
  const pendingDispatch = tools.some(tool => liveProjectable(tool) && Boolean(tool.dispatched) && (liveByTool.get(tool.id)?.roots.length ?? 0) === 0)
  const linkedFailed = subagentProjections.some(projection => projection.failedCount > 0)
  const failed = tools.some(tool => Boolean(tool.error) || (tool.name === 'subagent' && tool.finished && tool.result ? parseSubagentNotice(tool.result)?.ok === false : false)) || linkedFailed
  const running = Boolean(message.streaming && !activeTool && !textAfterUnfinishedTool) || linkedRunning || pendingDispatch
  const stepsExpanded = expandSteps ?? (Boolean(message.streaming) || pendingDispatch || linkedRunning)
  const lastStepsIndex = segments.reduce((last, segment, index) => segment.type === 'steps' ? index : last, -1)
  const stepGroupCount = segments.filter(segment => segment.type === 'steps').length
  const stepsKey = (index: number) => {
    const base = expandSteps ? 'steps' : message.streaming ? 'live' : linkedRunning || pendingDispatch ? 'live-agent' : 'done'
    return stepGroupCount > 1 ? `${base}:${index}` : base
  }
  return <div className="assistant-transcript-content" data-testid="assistant-transcript-content">
    {segments.map((segment, index) => {
      if (segment.type === 'text') {
        // The Computer Use Leader's plan JSON streams as cumulative text
        // snapshots; a plan-shaped segment renders as a growing plan card
        // instead of a raw JSON markdown dump.
        const plan = parseComputerPlanSegment(segment.content)
        if (plan) return <div key={`text:${segment.id}`} data-transcript-segment="text"><ComputerPlanCard plan={plan} /></div>
        const worker = parseComputerWorkerResult(segment.content)
        if (worker) return <div key={`text:${segment.id}`} data-transcript-segment="text"><ComputerWorkerResultCard result={worker} /></div>
        return <div key={`text:${segment.id}`} data-transcript-segment="text"><TranscriptMarkdown content={segment.content} streaming={message.streaming && index === segments.length - 1} />{!message.streaming && <DocumentReferenceCards content={segment.content} basePath={documentBasePath} onOpenDocument={onOpenDocument} />}</div>
      }
      const groupTools = segment.activities.flatMap(activity => activity.type === 'tool' ? [activity.tool] : [])
      const hasThinking = segment.activities.some(activity => activity.type === 'thinking')
      const groupRunning = running && index === lastStepsIndex
      const groupExpanded = expandSteps ? index === lastStepsIndex && !activeTool : stepsExpanded
      return <ActivityCard key={stepsKey(index)} summary={toolRunSummary(segment.activities.length, hasThinking ? 'Thinking' : null, groupTools)} running={groupRunning} error={failed && !running && index === lastStepsIndex} meta={failed && !running && index === lastStepsIndex ? '失败' : undefined} defaultExpanded={groupExpanded}>{segment.activities.map((activity, activityIndex) => {
        const pendingThinking = activity.type === 'thinking' && activity.id === PENDING_THINKING_ID
        const live = Boolean(message.streaming && index === lastStepsIndex && !activeTool && (
          activity.type === 'thinking'
            ? pendingThinking || activityIndex === segment.activities.length - 1
            : !activity.tool.finished
        ))
        if (activity.type === 'thinking') return <ActivityCard key={`thinking:${activity.id}`} kind="thinking" label="Thinking" summary="Thinking" meta={`${formatCompactTokens(estimateTokens(activity.charCount ?? activity.content.length))} tokens`} running={live} defaultExpanded={live}><p>{activity.content || (live ? '模型正在思考…' : '')}</p></ActivityCard>
        const projection = liveByTool.get(activity.tool.id)
        if (activity.tool.name === 'computer_task' && activity.tool.finished && activity.tool.result) {
          const computerResult = parseComputerTaskResult(activity.tool.result)
          if (computerResult) return <ComputerTaskResultCard
            key={`tool:${activity.tool.id}`}
            result={computerResult}
            goal={computerTaskGoalFromInput(activity.tool.input)}
            raw={activity.tool.result}
            elapsed={elapsed(activity.tool.startedAt, activity.tool.finishedAt ?? activity.tool.startedAt)}
            onOpenSubagents={onOpenSubagents}
          />
        }
        return liveProjectable(activity.tool) && projection && projection.totalCount > 0
          ? <LiveSubagentCard key={`tool:${activity.tool.id}`} projection={projection} onOpenSubagents={onOpenSubagents} title={activity.tool.name === 'computer_task' ? '桌面任务' : undefined} />
          : <TranscriptToolCard key={`tool:${activity.tool.id}`} tool={activity.tool} streaming={live} />
      })}</ActivityCard>
    })}
    {activeTool && <ActiveToolCard key={`active-tool:${activeTool.tool.id}`} tool={activeTool.tool} />}
    {message.error && <div className="assistant-turn-error" data-testid="assistant-turn-error" role="alert">{message.error}</div>}
  </div>
})
