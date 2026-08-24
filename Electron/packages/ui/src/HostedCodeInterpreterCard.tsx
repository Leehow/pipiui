import { memo } from 'react'
import { ActivityCard } from './ActivityCard'
import { TruncatedText } from './TruncatedText'
import { displaySecretPlaceholders } from './secret-display'
import { safeHttpsFileUrl, type TranscriptTool } from './transcript-model'

export type HostedCodeInterpreterPhase = 'queued' | 'in_progress' | 'interpreting' | 'completed' | 'failed'

export type HostedCodeInterpreterFile = {
  filename?: string
  mimeType?: string
  size?: number
  url?: string
}

export type HostedCodeInterpreterPayload = {
  phase?: HostedCodeInterpreterPhase
  code?: string
  outputs?: Array<{ type?: string; text?: string }>
  files?: HostedCodeInterpreterFile[]
  error?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseHostedCodeInterpreterPayload(raw: string): HostedCodeInterpreterPayload {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return {}
    const files = Array.isArray(parsed.files)
      ? parsed.files.flatMap((item): HostedCodeInterpreterFile[] => {
        if (!isRecord(item)) return []
        const filename = typeof item.filename === 'string' ? displaySecretPlaceholders(item.filename) : undefined
        const mimeType = typeof item.mimeType === 'string' ? item.mimeType : undefined
        const size = typeof item.size === 'number' ? item.size : undefined
        const url = typeof item.url === 'string' ? safeHttpsFileUrl(item.url) : undefined
        if (!filename && !mimeType && size === undefined && !url) return []
        return [{ ...(filename ? { filename } : {}), ...(mimeType ? { mimeType } : {}), ...(size !== undefined ? { size } : {}), ...(url ? { url } : {}) }]
      })
      : undefined
    const outputs = Array.isArray(parsed.outputs)
      ? parsed.outputs.flatMap((item) => {
        if (!isRecord(item) || typeof item.text !== 'string') return []
        return [{ type: 'logs', text: displaySecretPlaceholders(item.text) }]
      })
      : undefined
    const phase = parsed.phase
    return {
      ...(phase === 'queued' || phase === 'in_progress' || phase === 'interpreting' || phase === 'completed' || phase === 'failed' ? { phase } : {}),
      ...(typeof parsed.code === 'string' ? { code: displaySecretPlaceholders(parsed.code) } : {}),
      ...(outputs?.length ? { outputs } : {}),
      ...(files?.length ? { files } : {}),
      ...(typeof parsed.error === 'string' ? { error: displaySecretPlaceholders(parsed.error) } : {}),
    }
  } catch {
    return typeof raw === 'string' && raw.trim() ? { code: displaySecretPlaceholders(raw) } : {}
  }
}

export function hostedCodeInterpreterStatusLabel(phase: HostedCodeInterpreterPhase | undefined, finished?: boolean, error?: boolean): string {
  if (error || phase === 'failed') return '失败'
  if (phase === 'completed' || finished) return '成功'
  if (phase === 'queued') return '排队'
  return '运行中'
}

export function isHostedCodeInterpreterRunning(phase: HostedCodeInterpreterPhase | undefined, finished?: boolean): boolean {
  return !finished && phase !== 'completed' && phase !== 'failed'
}

function codeSummary(code: string | undefined): string {
  if (!code?.trim()) return '代码解释器'
  const line = code.trim().split('\n').find(item => item.trim()) ?? code.trim()
  return line.length > 48 ? `${line.slice(0, 48)}…` : line
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`
  return `${Math.round(size / 104857.6) / 10} MB`
}

export const HostedCodeInterpreterCard = memo(function HostedCodeInterpreterCard({
  tool,
  streaming,
}: {
  tool: TranscriptTool
  streaming?: boolean
}) {
  const payload = parseHostedCodeInterpreterPayload(tool.input)
  const failed = Boolean(tool.error) || payload.phase === 'failed'
  const running = isHostedCodeInterpreterRunning(payload.phase, tool.finished) && !failed
  const status = hostedCodeInterpreterStatusLabel(payload.phase, tool.finished, failed)
  const outputLogs = payload.outputs?.map(item => item.text).filter((text): text is string => Boolean(text)) ?? []
  const logs = outputLogs.length ? outputLogs : (!failed && tool.result ? [displaySecretPlaceholders(tool.result)] : [])
  const errorText = failed
    ? (payload.error || (outputLogs.length ? '' : tool.result) || '')
    : ''
  const phase = payload.phase ?? (failed ? 'failed' : tool.finished ? 'completed' : 'in_progress')
  return (
    <div
      data-testid="hosted-code-interpreter-card"
      data-phase={phase}
      aria-busy={running || undefined}
      aria-label={`代码解释器 ${status}`}
    >
    <ActivityCard
      kind="tool"
      summary={`代码解释器 · ${codeSummary(payload.code)}`}
      meta={status}
      running={running}
      error={failed}
      defaultExpanded={running || failed}
    >
      <div>
        {payload.code ? (
          <div className="tool-io">
            <div className="tool-io-label">代码</div>
            <pre>{payload.code}</pre>
          </div>
        ) : null}
        {logs.length > 0 ? (
          <div className="tool-io">
            <div className="tool-io-label">输出</div>
            <div className="tool-result"><TruncatedText text={logs.join('\n')} /></div>
          </div>
        ) : null}
        {errorText ? (
          <div className="tool-io">
            <div className="tool-io-label">错误</div>
            <div className="tool-result"><TruncatedText text={errorText} /></div>
          </div>
        ) : null}
        {payload.files?.length ? (
          <div className="tool-io">
            <div className="tool-io-label">文件</div>
            <ul className="hosted-code-files" data-testid="hosted-code-interpreter-files">
              {payload.files.map((file, index) => {
                const label = [file.filename, file.mimeType, file.size !== undefined ? formatSize(file.size) : undefined].filter(Boolean).join(' · ') || '文件'
                const key = file.url || `${file.filename ?? 'file'}:${file.mimeType ?? ''}:${index}`
                return (
                  <li key={key}>
                    {file.url ? <a href={file.url} target="_blank" rel="noopener noreferrer">{label}</a> : label}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </ActivityCard>
    </div>
  )
})
