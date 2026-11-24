import { useState } from 'react'
import { safeQueueError, type QueueFailureDetails, type QueueFailureStage, type LoginRecordStatus } from '@pipi/host-api'

const stages: Record<QueueFailureStage, string> = {
  lease: '获取会话写入权限',
  session: '启动或恢复会话',
  select_model: '本地选择模型（set_model）',
  prepare_message: '准备消息',
  dispatch: '向会话进程发送消息'
}
const logins: Record<LoginRecordStatus, string> = { present: '有记录', absent: '无记录', unknown: '未能读取' }

function reportText(message: string, details?: QueueFailureDetails): string {
  const lines = ['PipiUI 发送失败', `错误　${message}`]
  if (!details) return [...lines, '此条消息未保存失败现场。重试可生成新的诊断信息。'].join('\n')
  lines.push(`阶段　${stages[details.stage]}`)
  if (details.provider && details.modelId) lines.push(`模型　${details.provider}/${details.modelId}`)
  if (details.extensionId) lines.push(`插件　${details.extensionId}${details.extensionVersion ? ' ' + details.extensionVersion : ''}`)
  if (details.mountRequested !== undefined) lines.push(`会话启动参数　${details.mountRequested ? '已包含插件入口' : '未包含插件入口'}`)
  if (details.settingsSecretInjected !== undefined) lines.push(`插件设置密钥　${details.settingsSecretInjected ? '已注入会话' : '未注入会话'}`)
  if (details.appLogin) lines.push(`应用登录记录　${logins[details.appLogin]}`)
  if (details.sessionLogin) lines.push(`会话登录记录　${logins[details.sessionLogin]}`)
  if (details.appVersion) lines.push(`PipiUI 版本　${details.appVersion}`)
  lines.push(`系统　${details.platform}`, `时间（UTC）　${new Date(details.occurredAt).toISOString()}`)
  return lines.join('\n')
}

export function QueueFailureDisclosure({ error, details, index }: { error?: string; details?: QueueFailureDetails; index: number }) {
  const [copyStatus, setCopyStatus] = useState('')
  const message = safeQueueError(error || '未返回错误说明')
  const report = reportText(message, details)
  async function copy() {
    try {
      await navigator.clipboard.writeText(report)
      setCopyStatus('已复制')
    } catch {
      setCopyStatus('复制失败，可选中上方文字复制')
    }
  }
  return (
    <details className="message-queue__failure" onToggle={event => { if (!event.currentTarget.open) setCopyStatus('') }}>
      <summary aria-label={`第 ${index + 1} 条发送失败，更多错误信息`}>
        <span className="message-queue__error" data-testid={`queue-error-${index}`} role="alert">{message}</span>
        <span className="message-queue__more">更多</span>
        <span className="message-queue__less">收起</span>
      </summary>
      <pre>{report}</pre>
      <button type="button" onClick={() => void copy()}>复制诊断信息</button>
      <span role="status">{copyStatus}</span>
    </details>
  )
}
