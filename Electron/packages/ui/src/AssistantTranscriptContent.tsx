import { memo } from 'react'
import { Streamdown, type ControlsConfig } from 'streamdown'
import { code } from '@streamdown/code'
import { ActivityCard } from './ActivityCard'
import { parseSubagentNotice } from './subagent-notice'
import { toolArgsSummary, toolDisplaySummary, formatToolInput } from './tool-summary'
import { formatCompactTokens } from './session-stats-format'
import { DocumentReferenceCards } from './DocumentReferenceCards'
import { LiveSubagentCard } from './LiveSubagentCard'
import { useLiveSubagentBindings } from './LiveSubagentBinding'
import type { ChatMessage, TranscriptActivity, TranscriptTool } from './transcript-model'

export type { TranscriptActivity, TranscriptTool } from './transcript-model'
export type AssistantTranscriptMessage = Pick<ChatMessage, 'content' | 'thinking' | 'tools' | 'activities' | 'streaming'>

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
const staticMarkdownPlugins = { code }
const streamdownControls: ControlsConfig = { table: { copy: false, download: false, fullscreen: false }, code: { copy: true, download: false }, mermaid: false }
export const TranscriptMarkdown = memo(function TranscriptMarkdown({ content, streaming }: { content: string; streaming?: boolean }) { return <div className="markdown"><Streamdown mode={streaming ? 'streaming' : 'static'} isAnimating={streaming} plugins={streaming ? undefined : staticMarkdownPlugins} shikiTheme={['github-light', 'github-dark']} controls={streamdownControls}>{content}</Streamdown></div> })

const TranscriptToolCard = memo(function TranscriptToolCard({ tool, streaming }: { tool: TranscriptTool; streaming?: boolean }) {
  const argsSummary = toolArgsSummary(tool.name, tool.input)
  const subagentNotice = tool.name === 'subagent' && tool.finished && tool.result && !tool.error ? parseSubagentNotice(tool.result) : null
  const summary = tool.name === 'subagent'
    ? `子任务${argsSummary !== '…' ? ` · ${argsSummary}` : subagentNotice ? ` · ${subagentNotice.name}` : ''}`
    : toolDisplaySummary(tool.name, tool.input)
  const completedElapsed = elapsed(tool.startedAt, tool.finishedAt ?? tool.startedAt)
  const meta = tool.error ? `失败 · ${completedElapsed}` : subagentNotice ? `${subagentNotice.ok ? '成功' : '失败'} · ${subagentNotice.cost} · ${completedElapsed}` : tool.dispatched ? `已派发 · ${completedElapsed}` : tool.finished ? `完成 · ${completedElapsed}` : `运行中 · ${elapsed(tool.startedAt)}`
  return <ActivityCard kind="tool" summary={summary} meta={meta} error={Boolean(tool.error || (subagentNotice && !subagentNotice.ok))} defaultExpanded={tool.name === 'subagent' ? (Boolean(streaming) || !tool.finished || Boolean(tool.dispatched)) : Boolean(streaming || !tool.finished)}>
    {tool.images && tool.images.length > 0 && <div className="tool-images">{tool.images.map((img, i) => <img key={i} className="tool-screenshot" src={`data:${img.mimeType};base64,${img.data}`} alt="工具截图" loading="lazy" />)}</div>}
    {tool.input && <div className="tool-io"><div className="tool-io-label">输入</div><pre>{formatToolInput(tool.name, tool.input)}</pre></div>}
    {tool.result && <div className="tool-io"><div className="tool-io-label">输出</div><div className="tool-result">{tool.result}</div></div>}
  </ActivityCard>
})

const ActiveToolCard = memo(function ActiveToolCard({ tool }: { tool: TranscriptTool }) {
  const argsSummary = toolArgsSummary(tool.name, tool.input)
  const summary = `${tool.name}${argsSummary !== '…' ? ` · ${argsSummary}` : ''}`
  return <section className="activity-card activity-card-tool activity-card-active-tool" data-activity-card="tool" data-testid="active-tool"><div className="activity-summary"><span className="activity-status" aria-hidden="true">◌</span><b>{summary}</b><small className="activity-meta">运行中 · {elapsed(tool.startedAt)}</small></div></section>
})

export const AssistantTranscriptContent = memo(function AssistantTranscriptContent({ message, expandSteps, documentBasePath, onOpenDocument, onOpenSubagents }: { message: AssistantTranscriptMessage; expandSteps?: boolean; documentBasePath?: string; onOpenDocument?: (path: string) => void; onOpenSubagents?: (agentId?: string) => void }) {
  const activities: TranscriptActivity[] = message.activities ?? [
    ...(message.thinking ? [{ type: 'thinking' as const, id: 'thinking', contentIndex: 0, content: message.thinking }] : []),
    ...(message.tools ?? []).map((tool, index) => ({ type: 'tool' as const, contentIndex: index + (message.thinking ? 1 : 0), tool })),
  ]
  const activeTool = message.streaming && !expandSteps ? [...activities].reverse().find((activity): activity is Extract<TranscriptActivity, { type: 'tool' }> => activity.type === 'tool' && !activity.tool.finished && activity.tool.name !== 'subagent') : undefined
  const groupedActivities = activeTool ? activities.filter(activity => activity !== activeTool) : activities
  const tools = groupedActivities.flatMap(activity => activity.type === 'tool' ? [activity.tool] : [])
  const liveByTool = useLiveSubagentBindings(tools)
  const subagentProjections = tools.filter(tool => tool.name === 'subagent').map(tool => liveByTool.get(tool.id)).filter((projection): projection is NonNullable<typeof projection> => Boolean(projection))
  const linkedRunning = subagentProjections.some(projection => projection.runningCount > 0)
  const pendingDispatch = tools.some(tool => tool.name === 'subagent' && Boolean(tool.dispatched) && (liveByTool.get(tool.id)?.roots.length ?? 0) === 0)
  const linkedFailed = subagentProjections.some(projection => projection.failedCount > 0)
  const hasThinking = groupedActivities.some(activity => activity.type === 'thinking')
  const steps = groupedActivities.length
  const failed = tools.some(tool => Boolean(tool.error) || (tool.name === 'subagent' && tool.finished && tool.result ? parseSubagentNotice(tool.result)?.ok === false : false)) || linkedFailed
  const running = Boolean(message.streaming && !activeTool) || linkedRunning || pendingDispatch
  const stepsExpanded = expandSteps ?? (Boolean(message.streaming) || pendingDispatch || linkedRunning)
  return <div className="assistant-transcript-content" data-testid="assistant-transcript-content">
    {steps > 0 && <ActivityCard key={expandSteps ? 'steps' : message.streaming ? 'live' : linkedRunning || pendingDispatch ? 'live-agent' : 'done'} summary={toolRunSummary(steps, hasThinking ? 'Thinking' : null, tools)} running={running} error={failed && !running} meta={failed && !running ? '失败' : undefined} defaultExpanded={stepsExpanded}>{groupedActivities.map((activity, index) => {
      const live = Boolean(message.streaming && index === groupedActivities.length - 1 && !activeTool)
      if (activity.type === 'thinking') return <ActivityCard key={`thinking:${activity.id}`} kind="thinking" label="Thinking" summary="Thinking" meta={`${formatCompactTokens(Math.round(activity.content.length / 4))} tokens`} running={live} defaultExpanded={false}><p>{activity.content}</p></ActivityCard>
      const projection = liveByTool.get(activity.tool.id)
      return activity.tool.name === 'subagent' && projection && projection.totalCount > 0 ? <LiveSubagentCard key={`tool:${activity.tool.id}`} projection={projection} onOpenSubagents={onOpenSubagents} /> : <TranscriptToolCard key={`tool:${activity.tool.id}`} tool={activity.tool} streaming={live || !activity.tool.finished} />
    })}</ActivityCard>}
    {activeTool && <ActiveToolCard key={`active-tool:${activeTool.tool.id}`} tool={activeTool.tool} />}
    {message.content && <><TranscriptMarkdown content={message.content} streaming={message.streaming} />{!message.streaming && <DocumentReferenceCards content={message.content} basePath={documentBasePath} onOpenDocument={onOpenDocument} />}</>}
  </div>
})
