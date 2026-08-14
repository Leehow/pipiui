export type SubagentSignalKind = 'done' | 'heartbeat' | 'stalled' | 'interrupted-reminder' | 'blocked' | 'unknown'
export type SubagentSignalTone = 'success' | 'running' | 'warning' | 'error' | 'neutral'
export type SubagentSignalDelivery = 'retry' | 'recovered'

export type SubagentSignal = {
  kind: SubagentSignalKind
  tone: SubagentSignalTone
  label: string
  summary: string
  meta: string
  detail: string
  raw: string
  delivery?: SubagentSignalDelivery
  fields: Record<string, string>
}

const WRAPPER_RE = /^\((re-delivery|recovered delivery)[^\n]*\)\s*\n?/i

function parseFields(header: string, prefix: string): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const match of header.slice(prefix.length).trim().matchAll(/([A-Za-z][\w-]*)=(.*?)(?=\s+[A-Za-z][\w-]*=|$)/g)) fields[match[1]] = match[2].trim()
  return fields
}

function lineValue(lines: string[], label: string): string | undefined {
  const line = lines.find(candidate => candidate.startsWith(`${label}:`))
  return line?.slice(label.length + 1).trim() || undefined
}

function detailAfterHeader(lines: string[]): string {
  return lines.slice(1).join('\n').trim()
}

function readableName(fields: Record<string, string>, lines: string[]): string {
  return lineValue(lines, 'Title') || fields.title || fields.name || fields.agentId || '子任务'
}

function compactMeta(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}

/** Parses user-role runtime signals without treating ordinary user text as protocol. */
export function parseSubagentSignal(content: string): SubagentSignal | null {
  const raw = content.replace(/\r\n?/g, '\n')
  let payload = raw
  let delivery: SubagentSignalDelivery | undefined
  let deliveryDetail: string | undefined
  const wrapper = payload.match(WRAPPER_RE)
  if (wrapper) {
    delivery = wrapper[1].toLowerCase().startsWith('recovered') ? 'recovered' : 'retry'
    deliveryDetail = wrapper[0].trim()
    payload = payload.slice(wrapper[0].length)
  }
  if (!payload.startsWith('[subagent-')) {
    if (!delivery) return null
    return { kind: 'unknown', tone: 'neutral', label: '子任务', summary: '子任务送达通知', meta: delivery === 'retry' ? '重投' : '恢复送达', detail: raw, raw, delivery, fields: {} }
  }

  const lines = payload.split('\n')
  const header = lines[0]
  const family = header.match(/^\[subagent-([^\]]+)\]/)?.[1]?.toLowerCase()
  const kind: SubagentSignalKind = family === 'done' || family === 'heartbeat' || family === 'stalled' || family === 'interrupted-reminder' || family === 'blocked' ? family : 'unknown'
  const prefix = family ? `[subagent-${family}]` : '[subagent-'
  const fields = parseFields(header, prefix)
  if (kind === 'blocked') fields.title = header.match(/\btitle=(.*?)\s+is held:/)?.[1]?.trim() || fields.title
  const deliveryMeta = delivery === 'retry' ? '重投' : delivery === 'recovered' ? '恢复送达' : undefined

  if (kind === 'done') {
    const aborted = fields.aborted === 'true' || /\baborted\b/i.test(fields.state ?? '')
    const ok = fields.ok === 'true' && !aborted
    const verified = fields.verified
    const outcome = aborted ? '已中止' : ok ? '已完成' : '失败'
    const tone: SubagentSignalTone = aborted || (ok && verified === 'fail') ? 'warning' : ok ? 'success' : 'error'
    const body = detailAfterHeader(lines)
    const detail = [deliveryDetail, body].filter(Boolean).join('\n')
    return {
      kind, tone, label: '子任务', summary: `${outcome} · ${readableName(fields, lines)}`,
      meta: compactMeta([
        verified === 'pass' ? '验证通过' : verified === 'fail' ? '验证失败' : verified === 'none' ? '未验证' : undefined,
        fields.cost ? `cost ${fields.cost}` : undefined,
        fields.turns ? `${fields.turns} turns` : undefined,
        fields.resumed === 'true' ? '已续跑' : undefined,
        deliveryMeta,
      ]),
      detail: detail || raw,
      raw, delivery, fields,
    }
  }

  if (kind === 'heartbeat') {
    const vanished = Number(fields.vanished ?? 0)
    const stalled = Number(fields.stalled ?? 0)
    const tone: SubagentSignalTone = vanished > 0 || stalled > 0 ? 'warning' : 'running'
    return {
      kind, tone, label: '子任务', summary: `运行中 ${fields.outstanding ?? '?'}${vanished > 0 ? ` · 失联 ${vanished}` : ''}${stalled > 0 ? ` · 停滞 ${stalled}` : ''}`,
      meta: compactMeta(['心跳', deliveryMeta]), detail: detailAfterHeader(lines) || raw, raw, delivery, fields,
    }
  }

  if (kind === 'stalled') return {
    kind, tone: 'warning', label: '子任务', summary: `停滞 · ${readableName(fields, lines)}`,
    meta: compactMeta([fields.idle ? `空闲 ${fields.idle}` : undefined, deliveryMeta]), detail: detailAfterHeader(lines) || raw, raw, delivery, fields,
  }

  if (kind === 'interrupted-reminder') return {
    kind, tone: fields.state === 'failed' ? 'error' : 'warning', label: '子任务', summary: `待处理 · ${readableName(fields, lines)}`,
    meta: compactMeta([fields.state, fields.idle ? `空闲 ${fields.idle}` : undefined, fields.nudge ? `提醒 ${fields.nudge}` : undefined, deliveryMeta]), detail: detailAfterHeader(lines) || raw, raw, delivery, fields,
  }

  if (kind === 'blocked') return {
    kind, tone: 'warning', label: '子任务', summary: `已阻塞 · ${readableName(fields, lines)}`,
    meta: compactMeta([deliveryMeta]), detail: detailAfterHeader(lines) || header.slice(prefix.length).trim() || raw, raw, delivery, fields,
  }

  return {
    kind, tone: 'neutral', label: '子任务', summary: `子任务通知 · ${family || '未知类型'}`,
    meta: compactMeta([deliveryMeta]), detail: raw, raw, delivery, fields,
  }
}
