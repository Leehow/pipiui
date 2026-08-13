import { memo } from 'react'
import { Streamdown, type ControlsConfig } from 'streamdown'
import { code } from '@streamdown/code'
import { ActivityCard } from './ActivityCard'
import { parseSubagentNotice } from './subagent-notice'
import { toolArgsSummary, toolDisplaySummary, formatToolInput } from './tool-summary'
import { formatCompactTokens } from './session-stats-format'
import { DocumentReferenceCards } from './DocumentReferenceCards'

export type TranscriptTool = { id: string; name: string; input: string; result?: string; error?: boolean; startedAt: number; finished?: boolean; images?: { data: string; mimeType: string }[] }
export type AssistantTranscriptMessage = { content: string; thinking?: string; tools?: TranscriptTool[]; streaming?: boolean }

function elapsed(startedAt: number) { return `${Math.max(0, Math.round((Date.now() - startedAt) / 1000))}s` }
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
  const subagentNotice = tool.name === 'subagent' && tool.finished && tool.result ? parseSubagentNotice(tool.result) : null
  const summary = subagentNotice ? `子任务 · ${subagentNotice.name}` : tool.name === 'subagent' ? `子任务${argsSummary !== '…' ? ` · ${argsSummary}` : ''}` : toolDisplaySummary(tool.name, tool.input)
  const meta = subagentNotice ? `${subagentNotice.ok ? '成功' : '失败'} · ${subagentNotice.cost} · ${elapsed(tool.startedAt)}` : tool.finished ? `完成 · ${elapsed(tool.startedAt)}` : `运行中 · ${elapsed(tool.startedAt)}`
  // 进行中的工具卡片默认展开（实时显示输入/输出），完成后折叠——摘要表头已说明
  // 结果，点击可展开查看详情。streaming 覆盖整个回合仍在输出（主对话流式 / subagent
  // 仍在运行）；!tool.finished 覆盖单个工具尚未返回结果。
  return <ActivityCard kind="tool" summary={summary} meta={meta} error={Boolean(tool.error)} defaultExpanded={streaming || !tool.finished}>
    {tool.images && tool.images.length > 0 && <div className="tool-images">{tool.images.map((img, i) => <img key={i} className="tool-screenshot" src={`data:${img.mimeType};base64,${img.data}`} alt="工具截图" loading="lazy" />)}</div>}
    {tool.input && <div className="tool-io"><div className="tool-io-label">输入</div><pre>{formatToolInput(tool.name, tool.input)}</pre></div>}
    {tool.result && <div className="tool-io"><div className="tool-io-label">输出</div><div className="tool-result">{tool.result}</div></div>}
  </ActivityCard>
})
export const AssistantTranscriptContent = memo(function AssistantTranscriptContent({ message, expandSteps, documentBasePath, onOpenDocument }: { message: AssistantTranscriptMessage; expandSteps?: boolean; documentBasePath?: string; onOpenDocument?: (path: string) => void }) {
  const steps = (message.thinking ? 1 : 0) + (message.tools?.length ?? 0)
  const stepsExpanded = expandSteps ?? Boolean(message.streaming)
  return <div className="assistant-transcript-content" data-testid="assistant-transcript-content">
    {steps > 0 && <ActivityCard key={expandSteps ? 'steps' : message.streaming ? 'live' : 'done'} summary={toolRunSummary(steps, message.thinking ? 'Thinking' : null, message.tools ?? [])} running={Boolean(message.streaming)} defaultExpanded={stepsExpanded}>{message.thinking && <ActivityCard key={expandSteps ? 'thinking' : message.streaming ? 'live' : 'done'} kind="thinking" label="Thinking" summary="Thinking" meta={`${formatCompactTokens(Math.round(message.thinking.length / 4))} tokens`} running={Boolean(message.streaming)} defaultExpanded={false}><p>{message.thinking}</p></ActivityCard>}{message.tools?.map(tool => <TranscriptToolCard key={tool.id} tool={tool} streaming={message.streaming} />)}</ActivityCard>}
    {message.content && <><TranscriptMarkdown content={message.content} streaming={message.streaming} />{!message.streaming && <DocumentReferenceCards content={message.content} basePath={documentBasePath} onOpenDocument={onOpenDocument} />}</>}
  </div>
})
